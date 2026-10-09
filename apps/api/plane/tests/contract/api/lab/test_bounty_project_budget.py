# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Project publication consumes one configured VC budget, independently of cash."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import uuid

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import Issue, Project, ProjectMember, State
from plane.lab.finance_models import FinancialEntry, FinancialOperation, StageBudget
from plane.lab.models import Audit, Bounty, Ledger, Stage
from .test_bounties import action, start
from .test_finance import act

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def configure(lab, budget="100", name="当前项目预算", cash=True, reason=None):
    client = lab["client"](lab["lead"])
    assert (
        client.put(
            lab["base"] + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    result = client.post(
        lab["base"] + "stages/",
        {
            "project_id": str(lab["project"].id),
            "name": name,
            "budget": budget,
            **({"reason": reason} if reason else {}),
        },
        format="json",
    )
    assert result.status_code == 201, result.content
    identifier = result.json()["id"]
    if cash:
        result = act(
            lab,
            "stage",
            {"stage_id": identifier, "E": "1000", "purposes": [{"name": "阶段奖励", "amount": "1000"}]},
        )
        assert result.status_code == 200, result.content
    return identifier


def task(lab, title="发布项目任务"):
    return Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name=title, state=lab["states"]["todo"]
    )


def publication(lab, issue, budget="10", **extra):
    return {
        "project_id": str(lab["project"].id),
        "issue_id": str(issue.id),
        "budget": budget,
        "deliverable": "任务资料与成果",
        "criteria": "可重复核验",
        "reviewer_id": str(lab["reviewer"].id),
        "independent_reviewer_id": str(lab["independent"].id),
        **extra,
    }


def budgets(lab, user=None):
    result = lab["client"](user or lab["lead"]).get(lab["base"] + "bounties/budgets/")
    assert result.status_code == 200, result.content
    return result.json()


def test_project_publication_uses_finance_budget_and_preserves_cash_and_vc_ledger(laboratory):
    lab = laboratory
    identifier = configure(lab, reason="阶段研究用途预算")
    assert Audit.objects.get(action="stage.frozen", object_id=identifier).details["reason"] == "阶段研究用途预算"
    issue = task(lab)
    assert budgets(lab)[0] == {
        "project_id": str(lab["project"].id),
        "project": lab["project"].name,
        "stage_id": identifier,
        "stage_name": "当前项目预算",
        "budget": "100.00",
        "reserved": "0.00",
        "available": "100.00",
        "configured": True,
    }
    facts = (FinancialOperation.objects.count(), FinancialEntry.objects.count(), Ledger.objects.count())
    result = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert result.status_code == 201, result.content
    bounty = Bounty.objects.get(id=result.json()["id"])
    assert str(bounty.stage_id) == identifier and bounty.reserved == Decimal("10")
    assert budgets(lab)[0]["available"] == "90.00"
    assert Stage.objects.get(id=identifier).budget == Decimal("100")
    assert facts == (FinancialOperation.objects.count(), FinancialEntry.objects.count(), Ledger.objects.count())
    entry = Audit.objects.get(action="bounty.published", object_id=bounty.id)
    assert entry.details["stage_id"] == identifier and entry.details["project_id"] == str(lab["project"].id)


def test_project_publication_requires_explicit_vc_budget_and_lead(laboratory):
    lab = laboratory
    issue = task(lab)
    item = budgets(lab)[0]
    assert not item["configured"] and item["stage_id"] is None
    assert item["budget"] is None and item["available"] is None and item["reserved"] is None
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert response.status_code == 400 and "资金与奖励" in str(response.json())
    assert not Bounty.objects.exists() and not StageBudget.objects.exists()
    assert budgets(lab, lab["member"]) == []
    response = lab["client"](lab["member"]).post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert response.status_code == 403 and not Bounty.objects.exists()


def test_project_publication_uses_vc_budget_without_requiring_cash_budget(laboratory):
    lab = laboratory
    identifier = configure(lab, cash=False)
    result = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, task(lab)), format="json")
    assert result.status_code == 201, result.content
    assert str(Bounty.objects.get(id=result.json()["id"]).stage_id) == identifier
    assert budgets(lab)[0]["available"] == "90.00"
    assert not StageBudget.objects.exists() and not FinancialOperation.objects.exists()


def test_project_publication_uses_latest_stage_and_never_pools_or_trusts_stage_id(laboratory):
    lab = laboratory
    previous = configure(lab, budget="100", name="历史预算")
    current = configure(lab, budget="10", name="当前预算", cash=False)
    row = budgets(lab)[0]
    assert row["stage_id"] == current and row["budget"] == "10.00"
    issue = task(lab)
    result = lab["client"](lab["lead"]).post(
        lab["base"] + "bounties/", publication(lab, issue, budget="11", stage_id=previous), format="json"
    )
    assert result.status_code == 400 and not Bounty.objects.exists()
    result = lab["client"](lab["lead"]).post(
        lab["base"] + "bounties/", publication(lab, issue, budget="2", stage_id=previous), format="json"
    )
    assert result.status_code == 201, result.content
    assert str(Bounty.objects.get(id=result.json()["id"]).stage_id) == current
    assert budgets(lab)[0]["available"] == "8.00"
    assert not Bounty.objects.filter(stage_id=previous).exists()


def test_parallel_project_publication_cannot_overspend_configured_vc_budget(laboratory):
    lab = laboratory
    identifier = configure(lab, budget="15")
    issues = [task(lab, f"并行发布{number}") for number in range(2)]

    def publish(issue):
        close_old_connections()
        try:
            return (
                lab["client"](lab["lead"])
                .post(lab["base"] + "bounties/", publication(lab, issue, budget="10"), format="json")
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(publish, issues))
    assert sorted(results) == [201, 400]
    assert Bounty.objects.filter(stage_id=identifier).count() == 1
    assert budgets(lab)[0]["available"] == "5.00"


def test_budget_query_excludes_other_projects_and_legacy_stage_publication_still_works(laboratory):
    lab = laboratory
    identifier = configure(lab, cash=False)
    other = Project.objects.create(
        workspace=lab["workspace"], name="无权管理", identifier="OT", project_lead=lab["member"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["lead"], role=15)
    assert [row["project_id"] for row in budgets(lab)] == [str(lab["project"].id)]
    body = publication(lab, task(lab), stage_id=identifier)
    body.pop("project_id")
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", body, format="json")
    assert response.status_code == 201, response.content
    assert str(Bounty.objects.get(id=response.json()["id"]).stage_id) == identifier


def test_failed_publication_does_not_consume_budget_and_delete_returns_unused_vc(laboratory):
    lab = laboratory
    configure(lab)
    issue = task(lab)
    client = lab["client"](lab["lead"])
    response = client.post(
        lab["base"] + "bounties/", publication(lab, issue, reviewer_id=str(uuid.uuid4()), budget="25"), format="json"
    )
    assert response.status_code == 400 and budgets(lab)[0]["available"] == "100.00"
    response = client.post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert response.status_code == 201, response.content
    identifier = response.json()["id"]
    assert budgets(lab)[0]["available"] == "90.00"
    response = client.delete(lab["base"] + f"bounties/{identifier}/detail/", {"reason": "撤销发布"}, format="json")
    assert response.status_code == 204 and budgets(lab)[0]["available"] == "100.00"
    assert not FinancialEntry.objects.exists() and not Ledger.objects.exists()


def test_duplicate_publication_and_other_project_issue_cannot_consume_budget(laboratory):
    lab = laboratory
    identifier = configure(lab, cash=False)
    issue = task(lab)
    client = lab["client"](lab["lead"])
    for expected in (201, 400):
        response = client.post(lab["base"] + "bounties/", publication(lab, issue), format="json")
        assert response.status_code == expected, response.content
    other = Project.objects.create(workspace=lab["workspace"], name="Other", identifier="OT", project_lead=lab["lead"])
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["lead"], role=20)
    state = State.objects.create(workspace=lab["workspace"], project=other, name="Todo", group="unstarted")
    foreign = Issue.objects.create(workspace=lab["workspace"], project=other, name="其他项目任务", state=state)
    response = client.post(lab["base"] + "bounties/", publication(lab, foreign), format="json")
    assert response.status_code == 400 and Bounty.objects.filter(stage_id=identifier).count() == 1
    assert next(row for row in budgets(lab) if row["project_id"] == str(lab["project"].id))["available"] == "90.00"
    assert not FinancialEntry.objects.exists() and not Ledger.objects.exists()


def test_publishable_task_search_filters_status_parent_and_existing_bounty(laboratory):
    lab = laboratory
    configure(lab, cash=False)
    eligible = task(lab, "可发布顶层工作项")
    published = task(lab, "已有悬赏")
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, published), format="json")
    assert response.status_code == 201, response.content
    Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="正在工作", state=lab["states"]["active"]
    )
    child = task(lab, "子工作项")
    child.parent = eligible
    child.save(update_fields=["parent"])
    archived = task(lab, "归档工作项")
    archived.archived_at = timezone.now()
    archived.save(update_fields=["archived_at"])
    client = lab["client"](lab["lead"])
    response = client.get(lab["base"] + f"tasks/?project_id={lab['project'].id}&publishable=1")
    assert response.status_code == 200, response.content
    assert [row["id"] for row in response.json()] == [str(eligible.id)]
    normal = client.get(lab["base"] + f"tasks/?project_id={lab['project'].id}")
    assert {str(child.id), str(published.id)} <= {row["id"] for row in normal.json()}


@pytest.mark.parametrize("operation", ["cancel", "delete"])
def test_closing_partial_bounty_releases_only_unearned_project_vc(operation, laboratory):
    lab = laboratory
    configure(lab, cash=False)
    client = lab["client"](lab["lead"])
    response = client.post(lab["base"] + "bounties/", publication(lab, task(lab), budget="20"), format="json")
    assert response.status_code == 201, response.content
    identifier = response.json()["id"]
    allocation = start(lab, identifier)
    assert action(lab, lab["member"], identifier, "submit", {"evidence": "已完成一半成果"}).status_code == 200
    response = action(
        lab,
        lab["reviewer"],
        identifier,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "partial", "reason": "已核验", "targets": {allocation: "10"}},
    )
    assert response.status_code == 200, response.content
    assert budgets(lab)[0]["available"] == "80.00"
    if operation == "cancel":
        response = action(lab, lab["lead"], identifier, "cancel", {"reason": "结束尚未完成部分"})
        assert response.status_code == 200, response.content
    else:
        response = client.delete(lab["base"] + f"bounties/{identifier}/detail/", {"reason": "删除悬赏"}, format="json")
        assert response.status_code == 204, response.content
    assert budgets(lab)[0]["reserved"] == "10.00" and budgets(lab)[0]["available"] == "90.00"
    assert Ledger.objects.get(bounty_id=identifier).delta == Decimal("10")
    assert not FinancialEntry.objects.exists() and not FinancialOperation.objects.exists()
