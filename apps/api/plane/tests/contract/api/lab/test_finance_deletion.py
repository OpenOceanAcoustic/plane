# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Deletion stops current finance business while preserving immutable source facts."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest

from django.db import close_old_connections

from plane.db.models import Issue, Project, ProjectMember
from plane.lab.finance_models import CashBatch, FinancialEntry, FinancialOperation, StageBudget
from plane.lab.finance_services import balance
from plane.lab.models import Bounty, Ledger, Stage
from .test_bounties import action, start
from .test_bounty_project_budget import budgets, configure, publication, task
from .test_finance import act, cash, commit, overview, pay, receipt, settle

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_receipt_delete_reverses_only_one_installment_and_preserves_source(laboratory):
    lab = laboratory
    stage = configure(lab)
    first = receipt(lab, stage, gross="1000", costs="0", D="1000", source="第一笔")
    second = receipt(lab, stage, gross="2000", costs="0", D="2000", source="第二笔")
    original = CashBatch.objects.get(id=first)
    unchanged = list(FinancialEntry.objects.filter(batch_id=second).values())
    body = {"batch_id": first, "request_key": str(uuid.uuid4()), "reason": "第一笔重复录入"}
    response = act(lab, "receipt-delete", body)
    assert response.status_code == 200, response.content
    again = act(lab, "receipt-delete", body)
    assert again.status_code == 200 and again.json() == response.json()
    assert response.json()["id"] == first
    deletion = FinancialOperation.objects.get(id=response.json()["operation_id"])
    assert deletion.reverses_id == original.operation_id and deletion.kind == "receipt-delete"
    assert deletion.evidence == "" and original.operation.evidence == "bank:receipt-001"
    original.refresh_from_db()
    assert original.gross == Decimal("1000") and original.source == "第一笔"
    assert CashBatch.objects.count() == 2
    assert list(FinancialEntry.objects.filter(batch_id=second).values()) == unchanged
    assert balance(cash(lab, "execution", stage)) == Decimal("1400")
    assert balance(cash(lab, "risk", stage)) == Decimal("100")
    assert balance(cash(lab, "future_pool")) == Decimal("300")
    assert balance(cash(lab, "public")) == Decimal("200")
    batches = {row["id"]: row for row in overview(lab)["batches"]}
    assert batches[first]["reversed"] and not batches[first]["can_delete"]
    assert not batches[second]["reversed"] and batches[second]["can_delete"]
    assert batches[first]["operation_id"] == str(original.operation_id)


def test_stage_and_project_delete_restore_preserve_native_tasks_and_frozen_budget(laboratory):
    lab = laboratory
    stage = configure(lab)
    native = task(lab, "保持原工作项")
    budget = StageBudget.objects.get(stage_id=stage)
    frozen = (budget.E, budget.purposes, budget.members, budget.history)
    response = act(lab, "stage-delete", {"stage_id": stage, "reason": "预算暂不执行"})
    assert response.status_code == 200, response.content
    data = overview(lab)
    row = next(row for row in data["stages"] if row["stage_id"] == stage)
    assert row["deleted"] and row["can_manage"] and row["can_restore"]
    assert not row["can_delete"]
    denied = act(
        lab,
        "receipt",
        {"stage_id": stage, "gross": "100", "costs": "0", "D": "100", "source": "不应到账", "evidence": "bank:never"},
    )
    assert denied.status_code == 400 and "恢复" in str(denied.json())
    assert not CashBatch.objects.exists()
    restored = act(lab, "stage-restore", {"stage_id": stage})
    assert restored.status_code == 200, restored.content
    closed = act(lab, "project-delete", {"project_id": str(lab["project"].id)})
    assert closed.status_code == 200, closed.content
    data = overview(lab)
    project = next(row for row in data["projects"] if row["id"] == str(lab["project"].id))
    assert project["finance_deleted"] and project["deleted"] and project["can_restore"]
    assert next(row for row in data["stages"] if row["stage_id"] == stage)["deleted"]
    assert act(lab, "receipt", {"stage_id": stage}).status_code == 400
    assert act(lab, "project-restore", {"project_id": str(lab["project"].id)}).status_code == 200
    assert not next(row for row in overview(lab)["stages"] if row["stage_id"] == stage)["deleted"]
    budget.refresh_from_db()
    assert (budget.E, budget.purposes, budget.members, budget.history) == frozen
    assert Stage.objects.filter(id=stage).exists()
    assert Project.objects.filter(id=lab["project"].id, deleted_at__isnull=True).exists()
    assert Issue.objects.filter(id=native.id, deleted_at__isnull=True).exists()


def test_delete_requires_actual_project_lead_and_preserves_records_on_refusal(laboratory):
    lab = laboratory
    stage = configure(lab)
    batch = receipt(lab, stage, gross="100", costs="0", D="100")
    before = (FinancialOperation.objects.count(), FinancialEntry.objects.count())
    for action_name, body in (
        ("receipt-delete", {"batch_id": batch}),
        ("stage-delete", {"stage_id": stage}),
        ("project-delete", {"project_id": str(lab["project"].id)}),
    ):
        assert act(lab, action_name, body, user=lab["member"]).status_code == 403
        assert act(lab, action_name, body, user=lab["reviewer"]).status_code == 403
    Project.objects.filter(id=lab["project"].id).update(guest_view_all_features=True)
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=5)
    assert act(lab, "receipt-delete", {"batch_id": batch}).status_code == 403
    assert not overview(lab)["projects"][0]["can_manage"]
    assert before == (FinancialOperation.objects.count(), FinancialEntry.objects.count())
    assert not hasattr(CashBatch.objects.get(id=batch).operation, "reversal")


def test_closed_vc_source_blocks_both_publication_routes_and_restores_same_source(laboratory):
    lab = laboratory
    old = configure(lab, cash=False, name="旧阶段")
    current = configure(lab, cash=False, name="当前阶段")
    issue = task(lab)
    assert act(lab, "stage-delete", {"stage_id": current}).status_code == 200
    source = budgets(lab)[0]
    assert source["stage_id"] == current and source["deleted"] and source["can_restore"]
    assert source["budget"] == "100.00" and not source["can_delete"]
    for body in (publication(lab, issue), {**publication(lab, issue), "stage_id": current}):
        response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", body, format="json")
        assert response.status_code == 400 and "恢复" in str(response.json())
    choices = lab["client"](lab["lead"]).get(lab["base"] + f"tasks/?project_id={lab['project'].id}&publishable=1")
    assert choices.status_code == 200 and choices.json() == []
    assert not Bounty.objects.exists() and Stage.objects.filter(id=old).exists()
    assert act(lab, "stage-restore", {"stage_id": current}).status_code == 200
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, issue), format="json")
    assert response.status_code == 201, response.content
    assert str(Bounty.objects.get(id=response.json()["id"]).stage_id) == current


def test_project_delete_blocks_new_vc_and_financial_configuration_until_restore(laboratory):
    lab = laboratory
    stage = configure(lab, cash=False)
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 200
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "stages/",
        {"project_id": str(lab["project"].id), "name": "新的预算", "budget": "100"},
        format="json",
    )
    assert response.status_code == 400 and "恢复" in str(response.json())
    assert (
        act(lab, "stage", {"stage_id": stage, "E": "100", "purposes": [{"name": "奖励", "amount": "100"}]}).status_code
        == 400
    )
    assert Stage.objects.count() == 1 and not StageBudget.objects.exists()
    assert act(lab, "project-restore", {"project_id": str(lab["project"].id)}).status_code == 200
    assert (
        act(lab, "stage", {"stage_id": stage, "E": "100", "purposes": [{"name": "奖励", "amount": "100"}]}).status_code
        == 200
    )


def test_unfinished_bounty_blocks_budget_deletion_but_earned_vc_history_does_not(laboratory):
    lab = laboratory
    stage = configure(lab, cash=False)
    result = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, task(lab)), format="json")
    assert result.status_code == 201, result.content
    bounty = result.json()["id"]
    for verb, body in (
        ("stage-delete", {"stage_id": stage}),
        ("project-delete", {"project_id": str(lab["project"].id)}),
    ):
        response = act(lab, verb, body)
        assert response.status_code == 400 and "悬赏" in str(response.json())
    allocation = start(lab, bounty, planned="10")
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "可复核成果"}).status_code == 200
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {
                "request_key": str(uuid.uuid4()),
                "result": "pass",
                "reason": "成果通过",
                "targets": {allocation: "10"},
            },
        ).status_code
        == 200
    )
    before = list(Ledger.objects.values())
    assert act(lab, "stage-delete", {"stage_id": stage}).status_code == 200
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 200
    assert list(Ledger.objects.values()) == before
    assert Bounty.objects.get(id=bounty).reserved == Decimal("10")


def test_receipt_delete_cannot_erase_used_batch_risk_even_when_another_batch_has_cash(laboratory):
    lab = laboratory
    stage = configure(lab)
    first = receipt(lab, stage, gross="1000", costs="0", D="1000")
    receipt(lab, stage, gross="10000", costs="0", D="10000")
    released = act(lab, "risk-release", {"batch_id": first, "amount": "20", "evidence": "risk:confirmed"})
    assert released.status_code == 200, released.content
    original = CashBatch.objects.get(id=first)
    before = list(FinancialEntry.objects.values())
    for verb, body in (
        ("receipt-delete", {"batch_id": first}),
        ("reverse", {"operation_id": str(original.operation_id), "evidence": "correction"}),
    ):
        response = act(lab, verb, body)
        assert response.status_code == 400 and "原批次" in str(response.json())
    assert list(FinancialEntry.objects.values()) == before
    assert (
        act(
            lab, "reverse", {"operation_id": released.json()["operation_id"], "evidence": "release:misentry"}
        ).status_code
        == 200
    )
    assert act(lab, "receipt-delete", {"batch_id": first}).status_code == 200


def test_receipt_delete_respects_manual_final_commitment_and_payment(laboratory):
    lab = laboratory
    stage = configure(lab)
    first = receipt(lab, stage, gross="1000", costs="0", D="1000")
    receipt(lab, stage, gross="1000", costs="0", D="1000")
    settlement = settle(lab, stage, amount="1000")
    arrangement = commit(lab, settlement, "1000")
    pay(lab, arrangement, gross="200", withheld="20")
    before = list(FinancialEntry.objects.values())
    refused = act(lab, "receipt-delete", {"batch_id": first})
    assert refused.status_code == 400
    assert list(FinancialEntry.objects.values()) == before
    stage_delete = act(lab, "stage-delete", {"stage_id": stage})
    assert stage_delete.status_code == 400 and "未结清" in str(stage_delete.json())
    assert not overview(lab)["stages"][0]["can_delete"]


def test_receipt_delete_respects_original_year_future_plan(laboratory):
    lab = laboratory
    stage = configure(lab)
    first = receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at="2025-06-01T00:00:00+08:00")
    receipt(lab, stage, gross="10000", costs="0", D="10000", occurred_at="2026-06-01T00:00:00+08:00")
    planned = act(lab, "future-plan", {"year": 2025, "amount": "150"})
    assert planned.status_code == 200, planned.content
    response = act(lab, "receipt-delete", {"batch_id": first})
    assert response.status_code == 400 and "年度" in str(response.json())
    assert (
        act(lab, "reverse", {"operation_id": planned.json()["operation_id"], "evidence": "重新编列"}).status_code == 200
    )
    assert act(lab, "receipt-delete", {"batch_id": first}).status_code == 200


def test_opening_balance_is_not_a_deletable_receipt(laboratory):
    lab = laboratory
    stage = configure(lab)
    opening = act(
        lab,
        "opening",
        {
            "stage_id": stage,
            "project_id": str(lab["project"].id),
            "kind": "risk",
            "amount": "100",
            "source": "历史准备金",
            "evidence": "opening:proof",
        },
    )
    assert opening.status_code == 200, opening.content
    batch = CashBatch.objects.get(operation_id=opening.json()["operation_id"])
    row = overview(lab)["batches"][0]
    assert row["kind"] == "opening" and not row["can_delete"]
    assert act(lab, "receipt-delete", {"batch_id": str(batch.id)}).status_code == 400
    assert balance(cash(lab, "risk", stage)) == Decimal("100")
    assert (
        act(lab, "reverse", {"operation_id": opening.json()["operation_id"], "evidence": "历史余额更正"}).status_code
        == 200
    )


def test_fully_paid_stage_can_be_hidden_after_withholding_is_remitted(laboratory):
    lab = laboratory
    stage = configure(lab)
    batch = receipt(lab, stage, gross="1000", costs="0", D="1000")
    released = act(lab, "risk-release", {"batch_id": batch, "amount": "50", "evidence": "阶段准备金释放"})
    assert released.status_code == 200, released.content
    final = settle(lab, stage, amount="750")
    arrangement = commit(lab, final, "750")
    payment = pay(lab, arrangement, gross="750", withheld="20")
    response = act(lab, "stage-delete", {"stage_id": stage})
    assert response.status_code == 400 and "扣" in str(response.json())
    remitted = act(
        lab, "tax-remit", {"account_id": str(cash(lab, "withholding").id), "amount": "20", "evidence": "税款缴纳凭据"}
    )
    assert remitted.status_code == 200, remitted.content
    before = list(FinancialEntry.objects.values())
    assert act(lab, "stage-delete", {"stage_id": stage}).status_code == 200
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 200
    assert list(FinancialEntry.objects.values()) == before
    data = overview(lab)
    assert data["stages"][0]["deleted"] and data["settlements"][0]["paid"] == "750.00"
    assert data["payments"][0]["id"] == payment["id"]


def test_deleting_empty_stage_does_not_block_another_stage_installment(laboratory):
    lab = laboratory
    empty = configure(lab, name="未使用阶段")
    active = configure(lab, name="正在到账阶段")
    receipt(lab, active, gross="1000", costs="0", D="500")
    assert act(lab, "stage-delete", {"stage_id": empty}).status_code == 200
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 400
    receipt(lab, active, gross="2000", costs="0", D="2000")
    assert CashBatch.objects.count() == 2
    assert balance(cash(lab, "execution", active)) == Decimal("1750")


def test_receipt_and_stage_delete_serialize_on_workspace_finance_lock(laboratory):
    lab = laboratory
    stage = configure(lab)

    def run(verb, body):
        close_old_connections()
        try:
            return act(lab, verb, body).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(run, "stage-delete", {"stage_id": stage})
        incoming = pool.submit(
            run,
            "receipt",
            {
                "stage_id": stage,
                "gross": "100",
                "costs": "0",
                "D": "100",
                "source": "并发到账",
                "evidence": "bank:concurrent",
            },
        )
        results = [deletion.result(), incoming.result()]
    assert sorted(results) == [200, 400]
    deleted = overview(lab)["stages"][0]["deleted"]
    assert deleted == (CashBatch.objects.count() == 0)


def test_deleted_finance_workflow_keeps_history_and_only_offers_restore(laboratory):
    lab = laboratory
    stage = configure(lab)
    batch = receipt(lab, stage, gross="1000", costs="0", D="1000")
    deleted_receipt = act(lab, "receipt-delete", {"batch_id": batch})
    assert deleted_receipt.status_code == 200
    deleted_stage = act(lab, "stage-delete", {"stage_id": stage})
    assert deleted_stage.status_code == 200
    client = lab["client"](lab["lead"])
    url = lab["base"] + f"projects/{lab['project'].id}/workflow/"
    before = (FinancialOperation.objects.count(), FinancialEntry.objects.count())
    graph = client.get(url)
    assert graph.status_code == 200, graph.content
    scoped_actions = [row for row in graph.json()["actions"] if row["body"].get("stage_id") == stage]
    assert {row["action"] for row in scoped_actions} == {"stage-restore"}
    history = {row["id"]: row for row in graph.json()["history"]}
    assert history[deleted_stage.json()["operation_id"]]["label"] == "删除阶段预算"
    assert history[deleted_stage.json()["operation_id"]]["node_id"] == f"stage:{stage}:budget"
    assert history[deleted_receipt.json()["operation_id"]]["label"] == "删除到账记录"
    assert history[deleted_receipt.json()["operation_id"]]["node_id"] == f"batch:{batch}"
    assert (
        act(
            lab, "opening", {"kind": "public", "amount": "100", "source": "独立公共资金", "evidence": "公共池凭据"}
        ).status_code
        == 200
    )
    public_award = act(
        lab, "public-duty", {"user_id": str(lab["member"].id), "period": "2026-10", "duty": "公共职责", "amount": "50"}
    )
    assert public_award.status_code == 200
    assert act(lab, "public-commit", {"award_id": public_award.json()["id"], "amount": "20"}).status_code == 200
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 200
    before = (FinancialOperation.objects.count(), FinancialEntry.objects.count())
    for target in (url, lab["base"] + f"finance/workflow/?project_id={lab['project'].id}"):
        graph = client.get(target)
        assert graph.status_code == 200, graph.content
        assert {row["action"] for row in graph.json()["actions"]} == {"project-restore"}
        assert not any(row["can_manage"] for row in overview(lab)["accounts"] if row["project_id"])
    assert before == (FinancialOperation.objects.count(), FinancialEntry.objects.count())


def test_deleted_vc_only_budget_workflow_has_restore_instead_of_cash_configuration(laboratory):
    lab = laboratory
    stage = configure(lab, cash=False)
    deleted = act(lab, "stage-delete", {"stage_id": stage})
    assert deleted.status_code == 200
    url = lab["base"] + f"projects/{lab['project'].id}/workflow/"
    graph = lab["client"](lab["lead"]).get(url)
    assert graph.status_code == 200, graph.content
    actions = [row for row in graph.json()["actions"] if row["body"].get("stage_id") == stage]
    assert {row["action"] for row in actions} == {"stage-restore"}
    event = next(row for row in graph.json()["history"] if row["id"] == deleted.json()["operation_id"])
    assert event["node_id"] == f"stage:{stage}:cash-budget"
    assert event["label"] == "删除阶段预算"


def test_reversal_cannot_restore_cash_into_a_deleted_source_stage(laboratory):
    lab = laboratory
    source = configure(lab, name="前期留存")
    target = configure(lab, name="后期执行")
    opened = act(
        lab,
        "opening",
        {"stage_id": source, "kind": "retained", "amount": "100", "source": "真实留存", "evidence": "留存凭据"},
    )
    assert opened.status_code == 200
    allocated = act(
        lab,
        "stage-allocation",
        {"stage_id": target, "from_account_id": str(cash(lab, "retained", source).id), "amount": "100"},
    )
    assert allocated.status_code == 200, allocated.content
    assert act(lab, "stage-delete", {"stage_id": source}).status_code == 200
    before = list(FinancialEntry.objects.values())
    response = act(lab, "reverse", {"operation_id": allocated.json()["operation_id"], "evidence": "结转更正"})
    assert response.status_code == 400 and "恢复" in str(response.json())
    assert list(FinancialEntry.objects.values()) == before
    assert balance(cash(lab, "retained", source)) == Decimal("0")
    assert balance(cash(lab, "execution", target)) == Decimal("100")
    event = next(row for row in overview(lab)["operations"] if row["id"] == allocated.json()["operation_id"])
    assert not event["can_manage"]
