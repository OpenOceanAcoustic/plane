# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from decimal import Decimal
from datetime import timedelta
import uuid

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from plane.db.models import Issue, IssueAssignee, ProjectMember, State
from plane.lab.models import Bounty, Folder, Ledger, PersonalCategory, PersonalItem, Stage, TimeBlock
from .test_bounty_project_budget import budgets, configure, publication, task
from .test_bounties import action

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_native_work_item_can_publish_with_authoritative_identity_and_one_budget_reservation(laboratory):
    lab = laboratory
    stage = configure(lab, cash=False)
    issue = task(lab, "原生工作项的权威标题")
    task(lab, "另一个待做工作项")
    lead = lab["client"](lab["lead"])
    assert lead.get(lab["base"] + "planner/").status_code == 200
    metadata = lead.get(lab["base"] + f"task-card-metadata/?project_id={lab['project'].id}")
    assert metadata.status_code == 200
    entry = next(row for row in metadata.json()["items"] if row["issue_id"] == str(issue.id))
    assert entry["can_publish_bounty"] and entry["bounty_id"] is None
    assert entry["color"] is None and entry["category_id"] is None
    exact = lead.get(lab["base"] + f"tasks/?project_id={lab['project'].id}&publishable=1&issue_id={issue.id}")
    assert exact.status_code == 200 and [row["id"] for row in exact.json()] == [str(issue.id)]
    assert exact.json()[0]["title"] == issue.name
    assert exact.json()[0]["key"] == f"OA-{issue.sequence_id}"

    existing = set(Issue.objects.values_list("id", flat=True))
    body = publication(lab, issue, title="客户端伪造标题", issue_id_snapshot=str(lab["project"].id))
    response = lead.post(lab["base"] + "bounties/", body, format="json")
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(id=response.json()["id"])
    assert bounty.issue_id == issue.id and bounty.issue_id_snapshot == issue.id and bounty.title == issue.name
    assert set(Issue.objects.values_list("id", flat=True)) == existing
    assert Stage.objects.get(id=stage).budget == Decimal("100") and budgets(lab)[0]["available"] == "90.00"
    assert not Ledger.objects.exists()
    duplicate = lead.post(lab["base"] + "bounties/", body, format="json")
    assert duplicate.status_code == 400 and budgets(lab)[0]["available"] == "90.00"
    entry = lead.get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}").json()["items"][0]
    assert not entry["can_publish_bounty"] and entry["bounty_id"] == str(bounty.id)
    assert lead.get(lab["base"] + f"tasks/?publishable=1&issue_id={issue.id}").json() == []


@pytest.mark.parametrize("budget", ["10", "40"])
def test_started_work_item_upgrade_preserves_native_work_and_requires_bounty_flow(laboratory, budget):
    lab = laboratory
    configure(lab, budget="1000", cash=False)
    issue = task(lab, "已经进行的原工作项")
    today = timezone.now().date()
    Issue.objects.filter(pk=issue.id).update(
        state=lab["states"]["active"],
        priority="high",
        start_date=today,
        target_date=today + timedelta(days=7),
        description_html="<p>原始工作项说明</p>",
    )
    for user in (lab["member"], lab["lead"]):
        IssueAssignee.objects.create(workspace=lab["workspace"], project=lab["project"], issue=issue, assignee=user)
    parallel = task(lab, "另一个进行中的原生工作项")
    Issue.objects.filter(pk=parallel.id).update(state=lab["states"]["active"])
    IssueAssignee.objects.create(
        workspace=lab["workspace"], project=lab["project"], issue=parallel, assignee=lab["member"]
    )
    folder = Folder.objects.create(workspace=lab["workspace"], user=lab["member"], name="已有分类夹")
    category = PersonalCategory.objects.create(
        workspace=lab["workspace"], user=lab["member"], name="自定研究", color="#123456"
    )
    item = PersonalItem.objects.create(
        workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project", folder=folder, category=category
    )
    instant = timezone.now().replace(hour=8, minute=0, second=0, microsecond=0) + timedelta(days=1)
    block = TimeBlock.objects.create(item=item, start=instant, end=instant + timedelta(hours=1), color="#654321")
    issue_fact = Issue.objects.values().get(pk=issue.id)
    assignees = list(IssueAssignee.objects.filter(issue=issue).order_by("id").values())
    item_fact = PersonalItem.objects.values().get(pk=item.id)
    block_fact = TimeBlock.objects.values().get(pk=block.id)
    identities = set(Issue.objects.values_list("id", flat=True))
    lead, member = lab["client"](lab["lead"]), lab["client"](lab["member"])
    metadata = lead.get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}")
    assert any(row["can_publish_bounty"] for row in metadata.json()["items"])
    assert [row["id"] for row in lead.get(lab["base"] + f"tasks/?publishable=1&issue_id={issue.id}").json()] == [
        str(issue.id)
    ]
    response = lead.post(lab["base"] + "bounties/", publication(lab, issue, budget=budget), format="json")
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(pk=response.json()["id"])
    assert bounty.status == ("publication_review" if budget == "40" else "open")
    assert bounty.issue_id == issue.id and bounty.reserved == Decimal(budget) and not bounty.allocations.exists()
    assert Issue.objects.values().get(pk=issue.id) == issue_fact
    assert list(IssueAssignee.objects.filter(issue=issue).order_by("id").values()) == assignees
    assert PersonalItem.objects.values().get(pk=item.id) == item_fact
    assert TimeBlock.objects.values().get(pk=block.id) == block_fact
    assert set(Issue.objects.values_list("id", flat=True)) == identities
    assert budgets(lab)[0]["available"] == f"{1000 - Decimal(budget):.2f}"
    assert (
        lead.post(lab["base"] + "bounties/", publication(lab, issue, budget=budget), format="json").status_code == 400
    )
    assert member.patch(lab["base"] + f"items/{item.id}/", {"status": "done"}, format="json").status_code == 400
    with pytest.raises(IntegrityError, match="lab_bounty_workflow"), transaction.atomic():
        Issue.objects.filter(pk=issue.id).update(state=lab["states"]["done"])
    if bounty.major:
        assert (
            action(
                lab, lab["independent"], bounty.id, "publication-review", {"reason": "复核进行中原工作项的悬赏范围"}
            ).status_code
            == 200
        )
    claim = action(lab, lab["member"], bounty.id, "claim", {"planned": budget, "deliverable": "承接已有工作并提交成果"})
    assert claim.status_code == 200, claim.content
    allocation = claim.json()["id"]
    assert action(lab, lab["lead"], bounty.id, "approve", {"allocation_id": allocation}).status_code == 200
    assert action(lab, lab["lead"], bounty.id, "start").status_code == 400
    assert action(lab, lab["member"], bounty.id, "confirm").status_code == 200
    assert PersonalItem.objects.filter(user=lab["member"], issue=issue).count() == 1
    assert PersonalItem.objects.values().get(pk=item.id) == item_fact
    assert TimeBlock.objects.values().get(pk=block.id) == block_fact
    assert action(lab, lab["lead"], bounty.id, "start").status_code == 200
    assert list(IssueAssignee.objects.filter(issue=issue).order_by("id").values()) == assignees
    assert (
        action(lab, lab["member"], bounty.id, "submit", {"evidence": "已有工作完成后可复核的成果"}).status_code == 200
    )
    acceptance = {
        "request_key": str(uuid.uuid4()),
        "result": "pass",
        "reason": "独立核验通过",
        "targets": {allocation: budget},
    }
    assert action(lab, lab["member"], bounty.id, "accept", acceptance).status_code == 403
    accepted = action(lab, lab["reviewer"], bounty.id, "accept", acceptance)
    assert accepted.status_code == 200, accepted.content
    if bounty.major:
        assert (
            action(
                lab,
                lab["independent"],
                bounty.id,
                "acceptance-review",
                {"acceptance_id": accepted.json()["id"], "reason": "重大任务验收复核通过"},
            ).status_code
            == 200
        )
    bounty.refresh_from_db()
    issue.refresh_from_db()
    assert bounty.status == "done" and issue.state_id == lab["states"]["done"].id
    assert Ledger.objects.get(bounty=bounty).delta == Decimal(budget)
    assert budgets(lab)[0]["available"] == f"{1000 - Decimal(budget):.2f}"


@pytest.mark.parametrize("status,budget", [("todo", "10"), ("active", "10"), ("active", "40")])
def test_native_attributes_can_change_without_bypassing_unstarted_bounty_state_guards(laboratory, status, budget):
    lab = laboratory
    configure(lab, budget="1000", cash=False)
    issue = task(lab, "发布时的原任务标题")
    Issue.objects.filter(pk=issue.id).update(state=lab["states"][status])
    lead = lab["client"](lab["lead"])
    response = lead.post(lab["base"] + "bounties/", publication(lab, issue, budget=budget), format="json")
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(pk=response.json()["id"])
    assert (
        Issue.objects.filter(pk=issue.id).update(state=lab["states"][status], name="更新原任务标题", priority="medium")
        == 1
    )
    issue.refresh_from_db()
    assert issue.state_id == lab["states"][status].id and issue.name == "更新原任务标题" and issue.priority == "medium"
    bounty.refresh_from_db()
    assert bounty.title == "发布时的原任务标题" and bounty.status == (
        "publication_review" if budget == "40" else "open"
    )
    cancelled = State.objects.create(workspace=lab["workspace"], project=lab["project"], name="取消", group="cancelled")
    for state in (lab["states"]["review"], lab["states"]["done"], cancelled):
        with pytest.raises(IntegrityError, match="lab_bounty_workflow"), transaction.atomic():
            Issue.objects.filter(pk=issue.id).update(state=state)
    parent = task(lab, "另一个父工作项")
    with pytest.raises(IntegrityError, match="lab_bounty_workflow"), transaction.atomic():
        Issue.objects.filter(pk=issue.id).update(parent=parent)
    issue.refresh_from_db()
    assert issue.state_id == lab["states"][status].id and issue.parent_id is None
    assert bounty.reserved == Decimal(budget) and not Ledger.objects.exists()


def test_started_native_guard_migration_can_reverse_and_reapply_without_changing_work(laboratory):
    lab = laboratory
    configure(lab, budget="1000", cash=False)
    issue = task(lab, "迁移往返的进行中任务")
    Issue.objects.filter(pk=issue.id).update(state=lab["states"]["active"])
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(pk=response.json()["id"])
    assert Issue.objects.filter(pk=issue.id).update(priority="medium") == 1
    try:
        MigrationExecutor(connection).migrate([("lab", "0011_public_duty_zero_revision")])
        with pytest.raises(IntegrityError, match="lab_bounty_workflow"), transaction.atomic():
            Issue.objects.filter(pk=issue.id).update(priority="low")
    finally:
        MigrationExecutor(connection).migrate([("lab", "0012_started_bounty_upgrade_guard")])
    assert Issue.objects.filter(pk=issue.id).update(priority="low") == 1
    issue.refresh_from_db()
    bounty.refresh_from_db()
    assert issue.state_id == lab["states"]["active"].id and bounty.status == "open" and bounty.reserved == Decimal("10")


@pytest.mark.parametrize(
    "invalid", ["completed", "archived", "deleted", "draft", "child", "project_archived", "no_state"]
)
def test_unavailable_native_work_item_cannot_publish_or_reserve_budget(laboratory, invalid):
    lab = laboratory
    configure(lab, cash=False)
    issue = task(lab)
    PersonalItem.objects.create(user=lab["lead"], workspace=lab["workspace"], issue=issue, kind="project")
    changes = {
        "completed": {"state": lab["states"]["done"]},
        "archived": {"archived_at": timezone.now().date()},
        "deleted": {"deleted_at": timezone.now()},
        "draft": {"is_draft": True},
        "child": {"parent": task(lab, "父工作项")},
        "no_state": {"state": None},
    }
    if invalid == "project_archived":
        lab["project"].archived_at = timezone.now()
        lab["project"].save(update_fields=["archived_at"])
    else:
        Issue.objects.filter(id=issue.id).update(**changes[invalid])
    lead = lab["client"](lab["lead"])
    metadata = lead.get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}")
    assert metadata.status_code == 200 and all(not row["can_publish_bounty"] for row in metadata.json()["items"])
    assert lead.get(lab["base"] + f"tasks/?publishable=1&issue_id={issue.id}").json() == []
    identities = set(Issue.all_objects.values_list("id", flat=True))
    result = lead.post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    expected = 404 if invalid in ("archived", "deleted", "draft") else 400
    assert result.status_code == expected, result.content
    assert not Bounty.objects.exists() and budgets(lab)[0]["available"] == "100.00"
    assert set(Issue.all_objects.values_list("id", flat=True)) == identities


@pytest.mark.parametrize("access", ["ordinary", "read_only_lead", "inactive_lead"])
def test_native_publication_capability_and_post_require_active_project_lead(laboratory, access):
    lab = laboratory
    stage = configure(lab, cash=False)
    issue = task(lab)
    user = lab["member"] if access == "ordinary" else lab["lead"]
    if access == "read_only_lead":
        ProjectMember.objects.filter(project=lab["project"], member=user).update(role=5)
    elif access == "inactive_lead":
        ProjectMember.objects.filter(project=lab["project"], member=user).update(is_active=False)
    PersonalItem.objects.create(user=user, workspace=lab["workspace"], issue=issue, kind="project")
    client = lab["client"](user)
    metadata = client.get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}")
    assert metadata.status_code == 200 and all(not row["can_publish_bounty"] for row in metadata.json()["items"])
    assert client.get(lab["base"] + f"tasks/?publishable=1&issue_id={issue.id}").json() == []
    result = client.post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert result.status_code == 403, result.content
    assert not Bounty.objects.exists() and Stage.objects.get(id=stage).budget == Decimal("100")
