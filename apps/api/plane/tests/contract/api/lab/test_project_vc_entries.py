# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import uuid

import pytest
from django.db import close_old_connections

from plane.db.models import ProjectMember
from plane.lab.models import Audit, Bounty, BountyFunding, Stage, VCBudgetEntry
from plane.lab.vc import stage_budget, stage_reserved, wallet
from .test_member_vc import body, grant, historical_award, issue, post, setup
from .test_bounties import action
from .test_bounty_quotes import decide, quote_list, submit_quote

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def add(lab, value="100", actor=None, **extra):
    return lab["client"](actor or lab["lead"]).post(
        lab["base"] + "stages/",
        {
            "project_id": str(lab["project"].id),
            "name": "追加预算",
            "budget": value,
            "request_key": str(uuid.uuid4()),
            "append": True,
            **extra,
        },
        format="json",
    )


def edit(lab, entry, value, actor=None, **extra):
    return lab["client"](actor or lab["lead"]).patch(
        lab["base"] + f"bounties/budgets/{lab['project'].id}/entries/{entry.id}/",
        {
            "amount": value,
            "expected_revision": entry.revision,
            "reason": "调整项目额度",
            "request_key": str(uuid.uuid4()),
            **extra,
        },
        format="json",
    )


def budget(lab):
    return lab["client"](lab["lead"]).get(lab["base"] + "bounties/budgets/").json()[0]


def test_project_admin_initializes_without_a_project_lead(laboratory):
    lab = laboratory
    lab["project"].project_lead = None
    lab["project"].save()
    assert add(lab).status_code == 201
    assert budget(lab)["budget"] == "100.00"
    overview = lab["client"](lab["lead"]).get(lab["base"] + "finance/overview/").json()
    project = next(row for row in overview["projects"] if row["id"] == str(lab["project"].id))
    assert not project["is_lead"] and project["can_manage_vc"]
    assert post(lab, body(lab, issue(lab)), actor=lab["lead"]).status_code == 201
    assert add(lab, actor=lab["member"]).status_code == 403


def test_non_admin_lead_cannot_add_or_adjust_vc(laboratory):
    lab = laboratory
    setup(lab)
    entry = VCBudgetEntry.objects.get()
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=15)
    assert add(lab).status_code == 403
    assert edit(lab, entry, "900").status_code == 403


def test_installments_accumulate_and_each_can_be_changed(laboratory):
    lab = laboratory
    stage = setup(lab, "100")
    original = VCBudgetEntry.objects.get()
    assert add(lab, "50").json()["id"] == str(stage.id)
    assert Stage.objects.count() == 1 and VCBudgetEntry.objects.count() == 2
    assert budget(lab)["budget"] == "150.00"
    assert edit(lab, original, "125").status_code == 200
    assert budget(lab)["budget"] == "175.00"
    original.refresh_from_db()
    assert edit(lab, original, "0").status_code == 200
    assert budget(lab)["budget"] == "50.00"
    stage.refresh_from_db()
    assert stage.budget == 100  # Frozen cash history stays intact.
    assert Audit.objects.filter(action="vc.budget_adjusted").count() == 2


def test_admin_publishes_from_pool_while_personal_balances_stay_unchanged(laboratory):
    lab = laboratory
    stage = setup(lab)
    assert grant(lab, "40", target=lab["lead"]).status_code == 201
    historical_award(lab, stage, lab["lead"])
    before = wallet(lab["lead"].id, lab["project"])
    response = post(lab, body(lab, issue(lab), "20"), actor=lab["lead"])
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(id=response.json()["id"])
    assert bounty.funding.source == "project" and bounty.funding.project_committed == 20
    assert wallet(lab["lead"].id, lab["project"]) == before
    assert stage_reserved(stage) == 68  # 40 assigned + 8 old award + 20 direct.
    assert budget(lab)["available"] == "932.00"
    assert action(lab, lab["lead"], bounty.id, "cancel", {"reason": "撤销"}).status_code == 200
    assert stage_reserved(stage) == 48 and wallet(lab["lead"].id, lab["project"]) == before


def test_member_still_uses_combined_personal_sources(laboratory):
    lab = laboratory
    stage = setup(lab)
    assert grant(lab, "10").status_code == 201
    historical_award(lab, stage, lab["member"])
    result = post(lab, body(lab, issue(lab), "15", project_vc="10", earned_vc="5"))
    assert result.status_code == 201, result.content
    funding = BountyFunding.objects.get(bounty_id=result.json()["id"])
    assert funding.source == "personal" and funding.project_committed == 10 and funding.earned_committed == 5
    assert wallet(lab["member"].id, lab["project"])["available"] == "3.00"
    assert stage_reserved(stage) == 18


def test_reduction_floor_is_combined_grants_and_direct_bounties(laboratory):
    lab = laboratory
    setup(lab, "100")
    first = VCBudgetEntry.objects.get()
    assert add(lab, "50").status_code == 201
    assert grant(lab, "80").status_code == 201
    response = post(lab, body(lab, issue(lab), "20"), actor=lab["lead"])
    assert response.status_code == 201, response.content
    assert edit(lab, first, "49.99").status_code == 400
    assert edit(lab, first, "50").status_code == 200
    assert budget(lab)["available"] == "0.00"
    first.refresh_from_db()
    assert action(lab, lab["lead"], response.json()["id"], "cancel", {"reason": "退回项目余额"}).status_code == 200
    assert edit(lab, first, "30").status_code == 200
    first.refresh_from_db()
    assert edit(lab, first, "29.99").status_code == 400


def test_budget_add_and_edit_are_idempotent_and_revision_checked(laboratory):
    lab = laboratory
    key = str(uuid.uuid4())
    one = add(lab, request_key=key)
    assert one.status_code == 201
    assert add(lab, request_key=key).json() == one.json()
    assert add(lab, "101", request_key=key).status_code == 400
    assert VCBudgetEntry.objects.count() == 1
    entry = VCBudgetEntry.objects.get()
    key = str(uuid.uuid4())
    assert edit(lab, entry, "80", request_key=key).status_code == 200
    assert edit(lab, entry, "80", request_key=key).status_code == 200
    assert edit(lab, entry, "70").status_code == 400
    assert Audit.objects.filter(action="vc.budget_adjusted").count() == 1


@pytest.mark.parametrize("operation", ["grant", "publish"])
def test_concurrent_reduction_and_issue_never_overcommit(laboratory, operation):
    lab = laboratory
    stage = setup(lab, "100")
    entry = VCBudgetEntry.objects.get()
    task = issue(lab)

    def race(kind):
        close_old_connections()
        try:
            if kind == "reduce":
                return edit(lab, entry, "10").status_code
            if operation == "grant":
                return grant(lab, "90").status_code
            return post(lab, body(lab, task, "90"), actor=lab["lead"]).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, ("reduce", "issue")))
    assert sum(code in (200, 201) for code in results) == 1, results
    assert Decimal(0) <= stage_reserved(stage) <= stage_budget(stage)


def test_direct_project_topup_waits_for_review_and_never_uses_personal_credit(laboratory):
    lab = laboratory
    stage = setup(lab)
    response = post(lab, body(lab, issue(lab), "20"), actor=lab["lead"])
    bounty = response.json()["id"]
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="额外交付范围").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    assert stage_reserved(stage) == 20
    assert decide(lab, bounty, quote, verb="review", user=lab["independent"], decision="approve").status_code == 200
    assert stage_reserved(stage) == 45
    assert wallet(lab["lead"].id, lab["project"])["available"] == "0.00"


def test_pool_total_changes_invalidate_review_even_when_remaining_stays_equal(laboratory):
    lab = laboratory
    stage = setup(lab)
    response = post(lab, body(lab, issue(lab), "20"), actor=lab["lead"])
    bounty = response.json()["id"]
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="额外分析").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    before = budget(lab)["available"]
    assert add(lab, "1000").status_code == 201
    assert grant(lab, "1000", target=lab["reviewer"]).status_code == 201
    assert budget(lab)["available"] == before
    assert decide(lab, bounty, quote, verb="review", user=lab["independent"], decision="approve").status_code == 409
    assert stage_reserved(stage) == 1020
    assert quote_list(lab, bounty)["quotes"][0]["status"] == "pending"


def test_two_installment_reductions_share_one_project_floor(laboratory):
    lab = laboratory
    stage = setup(lab, "100")
    assert add(lab, "100").status_code == 201
    assert grant(lab, "150").status_code == 201
    entries = list(VCBudgetEntry.objects.order_by("created_at"))

    def reduce(entry):
        close_old_connections()
        try:
            return edit(lab, entry, "50").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reduce, entries))
    assert sorted(results) == [200, 400]
    assert stage_budget(stage) == stage_reserved(stage) == 150


def test_migration_preserves_initial_budget_without_issuing_member_credit(laboratory):
    from importlib import import_module
    from types import SimpleNamespace
    from django.apps import apps
    from django.db import connection
    from django.utils import timezone
    from plane.lab.models import Ledger, VCGrant

    lab = laboratory
    stage = Stage.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=lab["project"].id,
        project_name=lab["project"].name,
        name="既有初始额度",
        budget="500",
        frozen_at=timezone.now(),
    )
    migrate = import_module("plane.lab.migrations.0022_project_vc_budget_entries").preserve_existing_budgets
    migrate(apps, SimpleNamespace(connection=connection))
    entry = VCBudgetEntry.objects.get(stage=stage)
    assert entry.amount == entry.initial_amount == stage_budget(stage) == 500
    assert not VCGrant.objects.exists() and not Ledger.objects.exists() and not BountyFunding.objects.exists()
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_name='lab_bountyfunding' AND column_name='source'"
        )
        assert "personal" in cursor.fetchone()[0]
