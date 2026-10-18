# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Real API contracts for project-scoped VC custody and publisher-owned bounties."""

from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.utils import timezone

from plane.db.models import Issue, Project, ProjectMember
from plane.lab.models import Allocation, Bounty, BountyFunding, Ledger, Stage, VCGrant
from plane.lab.vc import stage_reserved, wallet
from .test_bounties import action
from .test_bounty_quotes import decide, quote_list, submit_quote

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def setup(lab, budget="1000"):
    client = lab["client"](lab["lead"])
    response = client.post(
        lab["base"] + "stages/",
        {
            "project_id": str(lab["project"].id),
            "name": "成员 VC 预算",
            "budget": budget,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    return Stage.objects.get(id=response.json()["id"])


def grant(lab, amount="20", target=None, actor=None, **extra):
    return lab["client"](actor or lab["lead"]).post(
        lab["base"] + f"bounties/quotas/{lab['project'].id}/",
        {
            "user_id": str((target or lab["member"]).id),
            "amount": amount,
            "request_key": str(uuid.uuid4()),
            "reason": "分配项目任务额度",
            **extra,
        },
        format="json",
    )


def issue(lab, title="成员发布的任务"):
    return Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name=title
    )


def body(lab, task, budget="10", **extra):
    return {
        "project_id": str(lab["project"].id),
        "issue_id": str(task.id),
        "budget": budget,
        "deliverable": "提交可复现的数据",
        "criteria": "结果完整可验证",
        "reviewer_id": str(lab["reviewer"].id),
        "independent_reviewer_id": str(lab["independent"].id),
        "request_key": str(uuid.uuid4()),
        **extra,
    }


def post(lab, data, actor=None):
    return lab["client"](actor or lab["member"]).post(lab["base"] + "bounties/", data, format="json")


def historical_award(lab, stage, person, vc="8"):
    """An existing, settled contribution; no synthetic wallet credit/backfill is required."""
    task = issue(lab, "历史已完成悬赏")
    bounty = Bounty.objects.create(
        stage=stage,
        issue=task,
        issue_id_snapshot=task.id,
        title=task.name,
        deliverable="历史成果",
        criteria="历史验收",
        budget=vc,
        reserved=vc,
        status="done",
        publisher=lab["lead"],
        reviewer=lab["reviewer"],
        published_at=timezone.now(),
    )
    allocation = Allocation.objects.create(
        bounty=bounty,
        user=person,
        user_id_snapshot=person.id,
        user_name=person.display_name,
        deliverable="历史交付",
        planned=vc,
        approved=True,
        confirmed=True,
        closed=True,
    )
    return Ledger.objects.create(
        bounty=bounty,
        allocation=allocation,
        delta=vc,
        actor=lab["reviewer"],
        actor_name=lab["reviewer"].display_name,
        reason="独立验收通过",
        task_snapshot={"title": task.name, "project": lab["project"].name},
        participant_snapshot={"id": str(person.id), "name": person.display_name},
        request_key=uuid.uuid4(),
    )


def test_only_current_project_administrators_can_allocate_and_read_member_balances(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab, actor=lab["member"]).status_code == 403
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=15)
    assert grant(lab).status_code == 403  # Project lead field alone grants no allocation authority.
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(role=20)
    assert grant(lab, actor=lab["reviewer"]).status_code == 201
    url = lab["base"] + f"bounties/quotas/{lab['project'].id}/"
    assert lab["client"](lab["member"]).get(url).status_code == 403
    response = lab["client"](lab["reviewer"]).get(url)
    assert response.status_code == 200
    member = next(row for row in response.json()["members"] if row["id"] == str(lab["member"].id))
    assert member["wallet"]["project_available"] == "20.00"
    assert member["reclaimable"] == "20.00"


def test_member_publication_combines_grant_and_existing_earned_vc_without_double_charging(laboratory):
    lab = laboratory
    stage = setup(lab)
    historical_award(lab, stage, lab["member"])
    assert grant(lab, "12").status_code == 201
    response = post(lab, body(lab, issue(lab), "20", project_vc="12", earned_vc="8"))
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(id=response.json()["id"])
    assert bounty.member_funded and bounty.publisher == lab["member"]
    assert bounty.funding.project_committed == 12 and bounty.funding.earned_committed == 8
    assert stage_reserved(stage) == 20  # 12 assigned + 8 historical principal, not another 20.
    assert wallet(lab["member"].id, lab["project"])["available"] == "0.00"
    assert Ledger.objects.count() == 1
    detail = lab["client"](lab["member"]).get(lab["base"] + f"bounties/{bounty.id}/detail/").json()
    assert detail["is_lead"] and detail["funding"] == {"project_vc": "12.00", "earned_vc": "8.00"}
    assert not lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty.id}/detail/").json()["is_lead"]
    flow = lab["client"](lab["member"]).get(lab["base"] + f"bounties/{bounty.id}/workflow/").json()
    assert "冻结悬赏 VC" in [row["label"] for row in flow["history"]]


@pytest.mark.parametrize(
    "sources",
    [
        {"project_vc": "11", "earned_vc": "0"},
        {"project_vc": "5", "earned_vc": "5"},
        {"project_vc": "-1", "earned_vc": "11"},
        {"project_vc": "9.999", "earned_vc": "0.001"},
        {"project_vc": "NaN", "earned_vc": "10"},
    ],
)
def test_invalid_or_unfunded_payment_never_creates_a_bounty(laboratory, sources):
    lab = laboratory
    setup(lab)
    assert grant(lab, "10").status_code == 201
    assert post(lab, body(lab, issue(lab), "10", **sources)).status_code == 400
    assert not BountyFunding.objects.exists() and not Bounty.objects.exists()
    assert wallet(lab["member"].id, lab["project"])["project_available"] == "10.00"


def test_original_stage_id_route_cannot_bypass_personal_balance_even_for_admin(laboratory):
    lab = laboratory
    stage = setup(lab)
    data = body(lab, issue(lab))
    del data["project_id"]
    data["stage_id"] = str(stage.id)
    assert post(lab, data, lab["lead"]).status_code == 400
    assert post(lab, data).status_code == 400
    assert not Bounty.objects.exists()


def test_cancel_and_reclaim_return_only_unspent_project_quota(laboratory):
    lab = laboratory
    stage = setup(lab)
    historical_award(lab, stage, lab["member"])
    assert grant(lab, "12").status_code == 201
    response = post(lab, body(lab, issue(lab), "20"))
    bounty = response.json()["id"]
    assert grant(lab, "1", kind="reclaim").status_code == 400
    assert action(lab, lab["lead"], bounty, "cancel", {"reason": "越权"}).status_code == 403
    assert action(lab, lab["member"], bounty, "cancel", {"reason": "需求调整"}).status_code == 200
    balance = wallet(lab["member"].id, lab["project"])
    assert (balance["project_available"], balance["earned_available"]) == ("12.00", "8.00")
    assert grant(lab, "12", kind="reclaim").status_code == 201
    assert grant(lab, "1", kind="reclaim").status_code == 400
    assert stage_reserved(stage) == 8 and Ledger.objects.count() == 1


def test_only_publisher_can_approve_quotes_start_and_manage_materials(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab).status_code == 201
    response = post(lab, body(lab, issue(lab), "20"))
    bounty = response.json()["id"]
    assert submit_quote(lab, bounty, lab["member"]).status_code == 400
    assert submit_quote(lab, bounty, lab["lead"]).status_code == 201
    assert quote_list(lab, bounty, lab["lead"])["quotes"][0]["can_approve"] is False
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert decide(lab, bounty, quote, user=lab["lead"]).status_code in (403, 404)
    assert decide(lab, bounty, quote, user=lab["member"]).status_code == 200
    assert action(lab, lab["lead"], bounty, "start").status_code == 403
    assert action(lab, lab["member"], bounty, "start").status_code == 200
    assert action(lab, lab["lead"], bounty, "submit", {"evidence": "可复现结果"}).status_code == 200
    allocation = Allocation.objects.get(bounty_id=bounty, user=lab["lead"])
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {
                "request_key": str(uuid.uuid4()),
                "result": "pass",
                "reason": "验收通过",
                "targets": {str(allocation.id): "20"},
            },
        ).status_code
        == 200
    )
    assert wallet(lab["lead"].id, lab["project"])["earned_available"] == "20.00"
    assert wallet(lab["member"].id, lab["project"])["available"] == "0.00"
    # As project administrator, this recipient now publishes from the project pool.
    second = post(lab, body(lab, issue(lab, "再发布"), "20"), lab["lead"])
    assert second.status_code == 201, second.content
    assert BountyFunding.objects.get(bounty_id=second.json()["id"]).source == "project"
    assert wallet(lab["lead"].id, lab["project"])["earned_available"] == "20.00"


def test_earned_vc_and_project_quota_cannot_be_spent_in_another_project(laboratory):
    lab = laboratory
    stage = setup(lab)
    historical_award(lab, stage, lab["member"], "8")
    assert grant(lab, "12").status_code == 201
    other = Project.objects.create(
        workspace=lab["workspace"], name="其他项目", identifier="OT", project_lead=lab["lead"]
    )
    for person in (lab["lead"], lab["member"]):
        ProjectMember.objects.create(
            workspace=lab["workspace"], project=other, member=person, role=20 if person == lab["lead"] else 15
        )
    Stage.objects.create(
        workspace=lab["workspace"],
        project=other,
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=other.id,
        project_name=other.name,
        name="另一预算",
        budget=1000,
        frozen_at=timezone.now(),
    )
    assert wallet(lab["member"].id, other)["available"] == "0.00"
    response = post(lab, body(lab, issue(lab), project_id=str(other.id)))
    assert response.status_code == 400 and not BountyFunding.objects.exists()
    assert wallet(lab["member"].id, lab["project"])["available"] == "20.00"


def test_grants_and_publications_are_idempotent_and_grants_are_append_only(laboratory):
    lab = laboratory
    setup(lab)
    key = str(uuid.uuid4())
    first = grant(lab, request_key=key)
    assert first.status_code == 201
    assert grant(lab, request_key=key).status_code == 200
    assert grant(lab, "21", request_key=key).status_code == 400
    assert VCGrant.objects.count() == 1
    row = VCGrant.objects.get()
    with pytest.raises(IntegrityError), transaction.atomic():
        VCGrant.objects.filter(id=row.id).update(delta=999)
    with pytest.raises(IntegrityError), transaction.atomic():
        row.delete()
    data = body(lab, issue(lab), "10")
    first, repeated = post(lab, data), post(lab, data)
    assert first.status_code == repeated.status_code == 201
    assert first.json() == repeated.json() and BountyFunding.objects.count() == 1
    assert post(lab, {**data, "budget": "11"}).status_code == 400
    assert wallet(lab["member"].id, lab["project"])["available"] == "10.00"


def test_parallel_publications_cannot_spend_the_same_personal_vc_twice(laboratory):
    lab = laboratory
    stage = setup(lab)
    assert grant(lab, "15").status_code == 201
    requests = [body(lab, issue(lab, f"并行{i}"), "10") for i in range(2)]

    def run(data):
        close_old_connections()
        try:
            return post(lab, data).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(run, requests))
    assert sorted(statuses) == [201, 400]
    assert BountyFunding.objects.count() == 1 and stage_reserved(stage) == 15
    assert wallet(lab["member"].id, lab["project"])["available"] == "5.00"


def test_parallel_admin_grants_cannot_overallocate_project_budget(laboratory):
    lab = laboratory
    stage = setup(lab, "25")

    def run(person):
        close_old_connections()
        try:
            return grant(lab, "20", target=person).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(run, [lab["member"], lab["independent"]]))
    assert sorted(statuses) == [201, 400] and stage_reserved(stage) == 20


def test_negotiated_topup_uses_publishers_balance_and_stale_snapshot_cannot_spend(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab, "30").status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20")).json()["id"]
    assert submit_quote(lab, bounty, lab["lead"], kind="negotiated", vc="25", basis="额外分析").status_code == 201
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert quote["adjustment"]["source_available"] == "10.00"
    assert grant(lab, "1", kind="reclaim").status_code == 201
    assert decide(lab, bounty, quote, user=lab["member"]).status_code == 409
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert decide(lab, bounty, quote, user=lab["member"]).status_code == 200
    assert BountyFunding.objects.get(bounty_id=bounty).project_committed == 25
    assert wallet(lab["member"].id, lab["project"])["available"] == "4.00"


def test_major_topup_does_not_freeze_or_grant_access_until_independent_review(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab, "50").status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20")).json()["id"]
    assert submit_quote(lab, bounty, lab["lead"], kind="negotiated", vc="40", basis="扩大交付").status_code == 201
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    response = decide(lab, bounty, quote, user=lab["member"], reviewer_id=str(lab["independent"].id))
    assert response.status_code == 200 and response.json()["status"] == "pending_review"
    assert wallet(lab["member"].id, lab["project"])["available"] == "30.00"
    assert not Allocation.objects.filter(bounty_id=bounty).exists()
    assert grant(lab, "15", kind="reclaim").status_code == 201
    pending = quote_list(lab, bounty, lab["independent"])["quotes"][0]
    assert decide(lab, bounty, pending, "review", user=lab["independent"], decision="approve").status_code == 409
    assert BountyFunding.objects.get(bounty_id=bounty).project_committed == 20
    assert not Allocation.objects.filter(bounty_id=bounty).exists()


def test_historical_earned_vc_is_available_without_duplicate_migration_credits(laboratory):
    lab = laboratory
    stage = setup(lab)
    historical_award(lab, stage, lab["member"], "8")
    for _ in range(2):
        rows = lab["client"](lab["member"]).get(lab["base"] + "bounties/budgets/").json()
        assert rows[0]["wallet"]["earned_available"] == "8.00"
        assert rows[0]["can_allocate"] is False
    response = post(lab, body(lab, issue(lab), "8", project_vc="0", earned_vc="8"))
    assert response.status_code == 201 and Ledger.objects.count() == 1 and not VCGrant.objects.exists()


def test_reversal_of_spent_earnings_creates_debt_instead_of_spendable_vc(laboratory):
    lab = laboratory
    stage = setup(lab)
    original = historical_award(lab, stage, lab["member"], "8")
    bounty = post(lab, body(lab, issue(lab), "8")).json()["id"]
    response = lab["client"](lab["lead"]).post(
        lab["base"] + f"ledger/{original.id}/reverse/",
        {
            "request_key": str(uuid.uuid4()),
            "reason": "历史贡献更正",
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    balance = wallet(lab["member"].id, lab["project"])
    assert balance["earned_debt"] == "8.00" and balance["available"] == "0.00"
    assert post(lab, body(lab, issue(lab))).status_code == 400
    assert action(lab, lab["member"], bounty, "cancel", {"reason": "取消未执行任务"}).status_code == 200
    balance = wallet(lab["member"].id, lab["project"])
    assert balance["earned_debt"] == "0.00" and balance["available"] == "0.00"


def award(lab, bounty, vc="20", result="pass"):
    assert submit_quote(lab, bounty, lab["lead"]).status_code == 201
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert decide(lab, bounty, quote, user=lab["member"]).status_code == 200
    assert action(lab, lab["member"], bounty, "start").status_code == 200
    assert action(lab, lab["lead"], bounty, "submit", {"evidence": "可核验数据"}).status_code == 200
    allocation = Allocation.objects.get(bounty_id=bounty, user=lab["lead"])
    response = action(
        lab,
        lab["reviewer"],
        bounty,
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": result,
            "reason": "独立验收",
            "targets": {str(allocation.id): vc},
        },
    )
    assert response.status_code == 200, response.content
    return Ledger.objects.get(allocation=allocation)


def test_partial_award_and_cancel_refund_the_correct_sources_and_conserve_project_vc(laboratory):
    lab = laboratory
    stage = setup(lab)
    historical_award(lab, stage, lab["member"])
    assert grant(lab, "12").status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20", project_vc="12", earned_vc="8")).json()["id"]
    entry = award(lab, bounty, "10", "partial")
    assert action(lab, lab["member"], bounty, "cancel", {"reason": "结束未完成部分"}).status_code == 200
    balance = wallet(lab["member"].id, lab["project"])
    assert (balance["project_available"], balance["earned_available"]) == ("2.00", "8.00")
    assert wallet(lab["lead"].id, lab["project"])["earned_available"] == "10.00"
    assert stage_reserved(stage) == 20
    response = lab["client"](lab["member"]).post(
        lab["base"] + f"ledger/{entry.id}/reverse/",
        {
            "request_key": str(uuid.uuid4()),
            "reason": "更正部分验收",
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    assert wallet(lab["member"].id, lab["project"])["available"] == "20.00"
    assert wallet(lab["lead"].id, lab["project"])["available"] == "0.00"


def test_reopening_a_completed_corrected_bounty_reserves_the_released_funding_again(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab).status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20")).json()["id"]
    entry = award(lab, bounty)
    response = lab["client"](lab["member"]).post(
        lab["base"] + f"ledger/{entry.id}/reverse/",
        {
            "request_key": str(uuid.uuid4()),
            "reason": "更正后重新验收",
        },
        format="json",
    )
    assert response.status_code == 200
    assert wallet(lab["member"].id, lab["project"])["available"] == "20.00"
    assert action(lab, lab["member"], bounty, "reopen", {"reason": "重新验收"}).status_code == 200
    assert wallet(lab["member"].id, lab["project"])["available"] == "0.00"
    assert Bounty.objects.get(id=bounty).reserved == 20


def test_project_admin_cannot_read_another_publishers_private_quotes_or_manage_materials(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab).status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20")).json()["id"]
    assert (
        submit_quote(lab, bounty, lab["independent"], kind="negotiated", vc="15", basis="私密的个人报价").status_code
        == 201
    )
    assert quote_list(lab, bounty, lab["lead"])["quotes"] == []
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert quote["basis"] == "私密的个人报价"
    url = lab["base"] + f"bounties/{bounty}/materials/?sources=1"
    assert lab["client"](lab["lead"]).get(url).status_code == 403
    assert lab["client"](lab["member"]).get(url).status_code == 200
    assert decide(lab, bounty, quote, user=lab["lead"]).status_code in (403, 404)


def test_revoked_publisher_cannot_spend_more_or_approve_pending_quotes(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab, "30").status_code == 201
    bounty = post(lab, body(lab, issue(lab), "20")).json()["id"]
    assert submit_quote(lab, bounty, lab["lead"]).status_code == 201
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert decide(lab, bounty, quote, user=lab["member"]).status_code in (403, 404)
    assert post(lab, body(lab, issue(lab))).status_code == 403
    assert wallet(lab["member"].id, lab["project"])["available"] == "10.00"
    assert not Allocation.objects.filter(bounty_id=bounty).exists()


def test_older_application_inserts_remain_compatible_with_the_additive_migration(laboratory):
    lab = laboratory
    stage = setup(lab)
    original = historical_award(lab, stage, lab["member"]).bounty
    clone_id, issue_id = uuid.uuid4(), uuid.uuid4()
    # Replay an old application's INSERT column list, which has no member_funded field.
    columns = [field.column for field in Bounty._meta.local_fields if field.name != "member_funded"]
    quote = connection.ops.quote_name
    expressions = [
        "%s" if name in ("id", "issue_id_snapshot") else "NULL" if name == "issue_id" else quote(name)
        for name in columns
    ]
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {quote(Bounty._meta.db_table)} ({', '.join(map(quote, columns))}) "
            f"SELECT {', '.join(expressions)} FROM {quote(Bounty._meta.db_table)} WHERE id = %s",
            [clone_id, issue_id, original.id],
        )
    assert Bounty.objects.get(id=clone_id).member_funded is False
