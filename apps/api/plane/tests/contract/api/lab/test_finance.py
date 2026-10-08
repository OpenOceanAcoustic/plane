# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from django.db import IntegrityError, close_old_connections, transaction
from django.utils import timezone

from plane.db.models import Project, ProjectMember, WorkspaceMember
from plane.lab.finance_formulas import evaluate
from plane.lab.finance_models import (
    CashBatch,
    FinancePolicy,
    FinancialAccount,
    FinancialEntry,
    FinancialOperation,
    PaymentCommitment,
    PublicDutyAward,
    RewardForecast,
    RewardSettlement,
    StageBudget,
)
from plane.lab.finance_services import balance, distribute_member, funded, months_before
from plane.lab.models import Allocation
from .test_bounties import prepare, start

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def act(lab, action, data=None, user=None):
    data = {"request_key": str(uuid.uuid4()), "reason": "有凭据的负责人核准", **(data or {})}
    return lab["client"](user or lab["lead"]).post(lab["base"] + f"finance/{action}/", data, format="json")


def plan(lab, bounty=None, upgraded=False, history=None, E="70000", members=None):
    if bounty is None:
        bounty, _, _ = prepare(lab, budget="20")
    row = Allocation.objects.filter(bounty_id=bounty).first()
    from plane.lab.models import Bounty

    stage_id = str(row.bounty.stage_id if row else Bounty.objects.get(id=bounty).stage_id)
    response = act(
        lab,
        "stage",
        {
            "stage_id": stage_id,
            "E": E,
            "purposes": [{"name": "阶段执行奖励", "amount": E}],
            "members": members
            if members is not None
            else [{"user_id": str(lab["member"].id), "b": "0.5", "r": "0.4", "planned_vc": "100"}],
            "upgraded": upgraded,
            "history": history or [],
        },
    )
    assert response.status_code == 200, response.content
    return stage_id, bounty


def receipt(lab, stage, gross="100000", costs="10000", D="90000", source="首次资助", **extra):
    response = act(
        lab,
        "receipt",
        {
            "stage_id": stage,
            "gross": gross,
            "costs": costs,
            "D": D,
            "source": source,
            "evidence": "bank:receipt-001",
            **extra,
        },
    )
    assert response.status_code == 200, response.content
    return response.json()["id"]


def cash(lab, kind, stage=None):
    rows = FinancialAccount.objects.filter(workspace=lab["workspace"], kind=kind)
    if stage:
        rows = rows.filter(stage_id=stage)
    return rows.get()


def overview(lab, user=None):
    response = lab["client"](user or lab["lead"]).get(lab["base"] + "finance/overview/")
    assert response.status_code == 200, response.content
    return response.json()


def settle(lab, stage, amount="25000", **extra):
    response = act(
        lab,
        "settlement",
        {
            "stage_id": stage,
            "user_id": str(lab["member"].id),
            "amount": amount,
            "performance_basis": "绩效与实际工作贡献核准",
            **extra,
        },
    )
    assert response.status_code == 200, response.content
    return response.json()["id"]


def commit(lab, settlement, amount):
    response = act(lab, "commit", {"settlement_id": settlement, "amount": amount})
    assert response.status_code == 200, response.content
    return response.json()["id"]


def pay(lab, commitment, gross="4000", withheld="400", **extra):
    response = act(
        lab,
        "payment",
        {
            "commitment_id": commitment,
            "gross": gross,
            "withheld": withheld,
            "evidence": "bank:payment-001",
            "reference": "线下转账-001",
            **extra,
        },
    )
    assert response.status_code == 200, response.content
    return response.json()


def test_formula_versions_forecast_snapshots_and_budget_E_are_independent_of_cash(laboratory):
    lab = laboratory
    stage, bounty = plan(lab)
    body = {"stage_id": stage, "kind": "task", "basis": "budget", "bounty_id": bounty}
    forecast = lab["client"](lab["lead"]).post(lab["base"] + "finance/forecast/", body, format="json")
    assert forecast.status_code == 201, forecast.content
    assert forecast.json()["result"] == "280.00"  # E is 70,000 directly, not 70% of it.
    assert forecast.json()["inputs"]["B"] == "1000.00"
    assert not FinancialEntry.objects.exists() and not RewardSettlement.objects.exists()
    endpoint = lab["base"] + f"finance/formulas/{lab['project'].id}/"
    formula = lab["client"](lab["lead"]).post(
        endpoint,
        {
            "task_expression": "min(E, hours * rate)",
            "member_expression": "E * VC / B",
            "parameters": [
                {"name": "hours", "scope": "task", "unit": "小时", "source": "负责人核定工时"},
                {"name": "rate", "scope": "stage", "unit": "元/小时", "source": "阶段约定单价", "default": "150"},
            ],
            "reason": "本项目采用工时单价",
        },
        format="json",
    )
    assert formula.status_code == 201 and formula.json()["version"] == 2
    missing = lab["client"](lab["lead"]).post(lab["base"] + "finance/forecast/", body, format="json")
    assert missing.status_code == 400 and "hours" in str(missing.content)
    new = lab["client"](lab["lead"]).post(
        lab["base"] + "finance/forecast/", {**body, "parameters": {"hours": "3.5"}}, format="json"
    )
    assert new.status_code == 201 and new.json()["result"] == "525.00"
    old = RewardForecast.objects.get(id=forecast.json()["id"])
    assert old.result == Decimal("280") and old.formula.version == 1
    assert len(overview(lab)["forecasts"]) == 2
    with pytest.raises(IntegrityError), transaction.atomic():
        RewardForecast.objects.filter(id=old.id).update(result=999)


@pytest.mark.parametrize(
    "expression,inputs",
    [
        ("__import__('os')", {}),
        ("E.__class__", {"E": "5"}),
        ("E ** 2", {"E": "5"}),
        ("E / B", {"E": "100", "B": "0"}),
        ("hours * rate", {"hours": "2"}),
        ("-1", {}),
        ("max(E, B)", {"E": "NaN", "B": "2"}),
    ],
)
def test_formula_rejects_code_invalid_values_missing_and_zero(expression, inputs):
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        evaluate(expression, inputs, set(inputs) | {"hours", "rate"})


def test_decimal_expression_and_parameter_override_guards(laboratory):
    assert evaluate("0.1 + 0.2", {}) == Decimal("0.30")
    assert evaluate("max(0, (E - 1.50) / B)", {"E": "10", "B": "2"}) == Decimal("4.25")
    lab = laboratory
    stage, bounty = plan(lab)
    override = lab["client"](lab["lead"]).post(
        lab["base"] + "finance/forecast/",
        {"stage_id": stage, "kind": "task", "basis": "budget", "bounty_id": bounty, "parameters": {"E": "999999"}},
        format="json",
    )
    assert override.status_code == 400
    wrong = lab["client"](lab["lead"]).post(
        lab["base"] + f"finance/formulas/{lab['project'].id}/",
        {
            "task_expression": "E",
            "member_expression": "E",
            "parameters": [{"name": "VC", "scope": "stage", "unit": "点", "source": "伪造"}],
            "reason": "错误",
        },
        format="json",
    )
    assert wrong.status_code == 400
    assert (
        lab["client"](lab["member"])
        .post(
            lab["base"] + f"finance/preview/{lab['project'].id}/",
            {"task_expression": "E", "inputs": {"E": "1"}},
            format="json",
        )
        .status_code
        == 403
    )


def test_receipt_partitions_real_funds_and_deducts_costs_once(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage)
    expected = {"execution": "63000", "risk": "4500", "future_pool": "13500", "public": "9000", "project": "0"}
    for kind, amount in expected.items():
        assert balance(cash(lab, kind, stage if kind in {"execution", "risk"} else None)) == Decimal(amount)
    assert sum((balance(row) for row in FinancialAccount.objects.all()), Decimal("0")) == Decimal("90000")
    bad = act(
        lab, "receipt", {"stage_id": stage, "gross": "10", "costs": "8", "D": "3", "source": "bad", "evidence": "proof"}
    )
    assert bad.status_code == 400 and CashBatch.objects.count() == 1
    with pytest.raises(IntegrityError), transaction.atomic():
        FinancialEntry.objects.filter(account__kind="execution").update(delta=1)


def test_cumulative_final_manual_amount_partial_payment_and_installment_do_not_auto_award(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage)
    request = {"stage_id": stage, "kind": "member", "basis": "budget", "user_id": str(lab["member"].id)}
    forecast = lab["client"](lab["lead"]).post(lab["base"] + "finance/forecast/", request, format="json")
    assert forecast.status_code == 201 and forecast.json()["result"] == "27300.00"
    settlement = settle(lab, stage, forecast_id=forecast.json()["id"])
    assert overview(lab)["settlements"][0]["difference"] == "-2300.00"
    too_much = act(
        lab,
        "settlement",
        {
            "stage_id": stage,
            "user_id": str(lab["reviewer"].id),
            "amount": "40000",
            "performance_basis": "不能超过真实总执行池",
        },
    )
    assert too_much.status_code == 400
    obligation = commit(lab, settlement, "10000")
    pay(lab, obligation)
    row = overview(lab)["settlements"][0]
    assert (row["paid"], row["withheld"], row["net_paid"], row["outstanding"], row["committed"]) == (
        "4000.00",
        "400.00",
        "3600.00",
        "21000.00",
        "6000.00",
    )
    assert balance(cash(lab, "withholding")) == Decimal("400")
    receipt(lab, stage, gross="10000", costs="0", D="10000")
    assert RewardSettlement.objects.count() == 1 and overview(lab)["settlements"][0]["amount"] == "25000.00"
    revised = settle(lab, stage, "30000")
    excess = act(lab, "commit", {"settlement_id": revised, "amount": "20000.01"})
    assert excess.status_code == 400
    commit(lab, revised, "20000")
    reduction = act(
        lab,
        "settlement",
        {
            "stage_id": stage,
            "user_id": str(lab["member"].id),
            "amount": "29999",
            "performance_basis": "已有付款安排不得覆写",
        },
    )
    assert reduction.status_code == 400
    assert act(lab, "cancel-commit", {"commitment_id": obligation}).status_code == 200
    settle(lab, stage, "24000")
    remit = act(
        lab, "tax-remit", {"account_id": str(cash(lab, "withholding").id), "amount": "400", "evidence": "tax:001"}
    )
    assert remit.status_code == 200 and balance(cash(lab, "withholding")) == 0


def test_idempotency_conflict_and_payment_reversal_append_entries(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    body = {
        "request_key": str(uuid.uuid4()),
        "stage_id": stage,
        "gross": "1000",
        "costs": "0",
        "D": "1000",
        "source": "首次资助",
        "evidence": "proof",
    }
    first = act(lab, "receipt", body)
    replay = act(lab, "receipt", body)
    assert first.status_code == replay.status_code == 200 and first.json() == replay.json()
    assert act(lab, "receipt", {**body, "D": "900"}).status_code == 400
    final = settle(lab, stage, "500")
    obligation = commit(lab, final, "500")
    payment = pay(lab, obligation, gross="200", withheld="20")
    before = FinancialEntry.objects.count()
    reverse = act(lab, "reverse", {"operation_id": payment["operation_id"], "evidence": "银行证实退回"})
    assert reverse.status_code == 200, reverse.content
    assert FinancialEntry.objects.count() > before
    assert overview(lab)["settlements"][0]["paid"] == "0.00"
    assert overview(lab)["commitments"][0]["remaining"] == "500.00"
    assert balance(cash(lab, "execution", stage)) == Decimal("700")
    assert (
        act(lab, "reverse", {"operation_id": first.json()["operation_id"], "evidence": "不能侵占承诺"}).status_code
        == 400
    )


def test_dispute_carryover_and_pool_reversal_cannot_consume_obligations(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000")
    execution = cash(lab, "execution", stage)
    settle(lab, stage, "500")
    assert act(lab, "dispute", {"from_account_id": str(execution.id), "amount": "200.01"}).status_code == 400
    reserved = act(lab, "dispute", {"from_account_id": str(execution.id), "amount": "150"})
    assert reserved.status_code == 200
    assert funded(StageBudget.objects.get(stage_id=stage)) == Decimal("550")
    assert (
        act(
            lab,
            "resolve-dispute",
            {
                "from_account_id": str(cash(lab, "dispute", stage).id),
                "to_account_id": str(execution.id),
                "amount": "150",
            },
        ).status_code
        == 200
    )
    assert act(lab, "carryover", {"from_account_id": str(execution.id), "amount": "200"}).status_code == 200
    assert balance(cash(lab, "retained", stage)) == Decimal("200")
    assert funded(StageBudget.objects.get(stage_id=stage)) == Decimal("500")


def historical(lab, source="首次资助", qualified=None, vc="100", user=None, **extra):
    return {
        "user_id": str((user or lab["member"]).id),
        "vc": vc,
        "funding_source": source,
        "qualified_at": (qualified or timezone.localdate()).isoformat(),
        "basis": "冻结孵化有效历史VC证据",
        **extra,
    }


def test_upgraded_history_qualification_frozen_by_source_risk_release_no_new_partition(laboratory):
    lab = laboratory
    stage, _ = plan(lab, upgraded=True, history=[historical(lab), historical(lab, vc="100", user=lab["reviewer"])])
    batch = receipt(lab, stage, gross="10000", costs="0", D="10000")
    assert balance(cash(lab, "execution", stage)) == Decimal("6300")
    assert balance(cash(lab, "history", stage)) == Decimal("700")
    assert act(lab, "history-settlement", {"stage_id": stage}).status_code == 200
    assert sorted(row.amount for row in RewardSettlement.objects.filter(kind="history")) == [
        Decimal("350"),
        Decimal("350"),
    ]
    release = act(lab, "risk-release", {"batch_id": batch, "amount": "500", "evidence": "风险期已过"})
    assert release.status_code == 200
    assert balance(cash(lab, "execution", stage)) == Decimal("6750")
    assert balance(cash(lab, "history", stage)) == Decimal("750")
    assert balance(cash(lab, "future_pool")) == Decimal("1500")
    assert balance(cash(lab, "public")) == Decimal("1000")
    assert act(lab, "history-settlement", {"stage_id": stage}).status_code == 200
    latest = overview(lab)["settlements"]
    assert sorted(row["amount"] for row in latest if row["kind"] == "history") == ["375.00", "375.00"]
    assert not RewardSettlement.objects.filter(kind="execution").exists()
    assert act(lab, "risk-release", {"batch_id": batch, "amount": "1", "evidence": "不能多放"}).status_code == 400
    other = receipt(lab, stage, gross="1000", costs="0", D="1000", source="独立新资助")
    assert CashBatch.objects.get(id=other).history_snapshot == []
    assert act(lab, "history-settlement", {"stage_id": stage}).status_code == 200
    assert sorted(row["amount"] for row in overview(lab)["settlements"] if row["kind"] == "history") == [
        "375.00",
        "375.00",
    ]


def test_historical_window_each_installment_expired_shares_stay_unallocated(laboratory):
    lab = laboratory
    today = timezone.localdate()
    old = months_before(today, 36)
    stage, _ = plan(
        lab,
        upgraded=True,
        history=[historical(lab, qualified=old), historical(lab, user=lab["reviewer"], qualified=today)],
    )
    first = receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at=f"{today.isoformat()}T12:00:00+08:00")
    assert len(CashBatch.objects.get(id=first).history_snapshot) == 2
    future = today + timezone.timedelta(days=1)
    second = receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at=f"{future.isoformat()}T12:00:00+08:00")
    snapshot = CashBatch.objects.get(id=second).history_snapshot
    assert len(snapshot) == 1 and Decimal(snapshot[0]["share"]) == Decimal("0.5")
    assert act(lab, "history-settlement", {"stage_id": stage}).status_code == 200
    values = {row["user_id"]: row["amount"] for row in overview(lab)["settlements"]}
    assert values[str(lab["member"].id)] == "35.00" and values[str(lab["reviewer"].id)] == "70.00"
    assert balance(cash(lab, "history", stage)) == Decimal("140")


def test_fractional_cent_tail_and_risk_actual_use_remain_traceable(laboratory):
    assert distribute_member(Decimal("100.05"), True) == (Decimal("90.04"), Decimal("10.00"))
    lab = laboratory
    stage, _ = plan(lab, upgraded=True)
    batch = receipt(lab, stage, gross="142.93", costs="0", D="142.93")
    assert balance(cash(lab, "project")) > 0
    use = act(
        lab,
        "risk-use",
        {
            "batch_id": batch,
            "amount": "2",
            "category": "refund",
            "purpose": "有凭据的责任退款",
            "evidence": "bank:refund",
        },
    )
    assert use.status_code == 200
    assert (
        act(
            lab,
            "risk-use",
            {"batch_id": batch, "amount": "10", "category": "rework", "purpose": "超额", "evidence": "proof"},
        ).status_code
        == 400
    )
    details = overview(lab)["batches"][0]
    assert details["risk_used"] == "2.00" and details["risk_released"] == "0.00"
    assert act(lab, "reverse", {"operation_id": use.json()["operation_id"], "evidence": "退款冲正"}).status_code == 200
    assert overview(lab)["batches"][0]["risk_used"] == "0.00"


def test_public_duty_monthly_awards_partial_payments_withholding_and_future_split(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="10000", costs="0", D="10000")
    assert (
        act(
            lab,
            "public-duty",
            {"user_id": str(lab["member"].id), "period": "2026-10", "duty": "值班维护", "amount": "600"},
            user=lab["member"],
        ).status_code
        == 403
    )
    award = act(
        lab,
        "public-duty",
        {"user_id": str(lab["member"].id), "period": "2026-10", "duty": "值班维护固定职责", "amount": "600"},
    )
    assert award.status_code == 200
    commitment = act(lab, "public-commit", {"award_id": award.json()["id"], "amount": "500"})
    assert commitment.status_code == 200
    payment = act(
        lab,
        "public-payment",
        {
            "commitment_id": commitment.json()["id"],
            "gross": "200",
            "withheld": "20",
            "evidence": "public:payment",
            "reference": "值班-10月-1",
        },
    )
    assert payment.status_code == 200
    data = overview(lab)
    row = data["public_awards"][0]
    assert (row["paid"], row["outstanding"], row["committed"], row["net_paid"]) == (
        "200.00",
        "400.00",
        "300.00",
        "180.00",
    )
    withholding = FinancialAccount.objects.get(workspace=lab["workspace"], kind="withholding", project_id_snapshot=None)
    assert str(withholding.id) in {row["id"] for row in data["accounts"]}
    assert (
        act(
            lab,
            "expense",
            {"account_id": str(cash(lab, "public").id), "amount": "500", "purpose": "不能占应付", "evidence": "proof"},
        ).status_code
        == 400
    )
    assert act(lab, "public-cancel-commit", {"commitment_id": commitment.json()["id"]}).status_code == 200
    revised = act(
        lab,
        "public-duty",
        {
            "award_id": award.json()["id"],
            "user_id": str(lab["member"].id),
            "period": "2026-10",
            "duty": "追加绩效核准",
            "amount": "400",
        },
    )
    assert revised.status_code == 200 and PublicDutyAward.objects.count() == 2
    assert overview(lab)["public_awards"][0]["amount"] == "400.00"
    assert act(lab, "future-plan", {"year": timezone.now().year, "amount": "1499"}).status_code == 400
    assert act(lab, "future-plan", {"year": timezone.now().year, "amount": "1500"}).status_code == 200
    assert balance(cash(lab, "future_research")) == Decimal("1050")
    assert balance(cash(lab, "future_exploration")) == Decimal("450")
    assert act(lab, "exploration-allocation", {"stage_id": stage, "amount": "100"}).status_code == 200
    assert funded(StageBudget.objects.get(stage_id=stage)) == Decimal("7100")
    assert act(lab, "future-plan", {"year": timezone.now().year, "amount": "1500"}).status_code == 400


def test_finance_permissions_private_export_and_public_summary(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage)
    settle(lab, stage)
    member = overview(lab, lab["member"])
    reviewer = overview(lab, lab["reviewer"])
    assert not member["accounts"] and not member["entries"] and not member["operations"]
    assert len(member["settlements"]) == 1 and not reviewer["settlements"]
    assert any(row["kind"] == "public" and row["balance"] == "9000.00" for row in member["public_summary"])
    assert not member["stages"][0]["history"] and len(member["stages"][0]["members"]) == 1
    assert (
        act(
            lab,
            "settlement",
            {"stage_id": stage, "user_id": str(lab["member"].id), "amount": "500", "performance_basis": "自行核准"},
            user=lab["member"],
        ).status_code
        == 403
    )
    csv = lab["client"](lab["lead"]).get(lab["base"] + "finance/entries/?format=csv")
    assert csv.status_code == 200 and "63000.00" in csv.content.decode()
    csv_member = lab["client"](lab["member"]).get(lab["base"] + "finance/entries/?format=csv")
    assert csv_member.status_code == 200 and "63000.00" not in csv_member.content.decode()
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["reviewer"]).update(role=20)
    assert (
        act(
            lab,
            "opening",
            {"kind": "public", "amount": "10", "source": "期初", "evidence": "proof"},
            user=lab["reviewer"],
        ).status_code
        == 403
    )
    assert act(lab, "manager", {"user_id": str(lab["reviewer"].id)}).status_code == 200
    assert (
        act(
            lab,
            "opening",
            {"kind": "public", "amount": "10", "source": "期初", "evidence": "proof"},
            user=lab["reviewer"],
        ).status_code
        == 200
    )
    assert FinancePolicy.objects.get(workspace=lab["workspace"]).manager_id == lab["reviewer"].id


def test_foreign_stage_cannot_spoof_expense_payment_scope_or_reverse_other_project(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    second = Project.objects.create(
        workspace=lab["workspace"], name="Other", identifier="OT", project_lead=lab["reviewer"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=second, member=lab["reviewer"], role=20)
    from plane.lab.models import Stage

    foreign = Stage.objects.create(
        workspace=lab["workspace"],
        project=second,
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=second.id,
        project_name=second.name,
        name="foreign",
        budget=100,
        frozen_at=timezone.now(),
    )
    opening = act(
        lab,
        "opening",
        {
            "project_id": str(lab["project"].id),
            "kind": "project",
            "amount": "100",
            "source": "期初",
            "evidence": "proof",
        },
    )
    assert opening.status_code == 200
    expense = act(
        lab,
        "expense",
        {
            "account_id": str(cash(lab, "project").id),
            "stage_id": str(foreign.id),
            "project_id": str(second.id),
            "amount": "10",
            "purpose": "真实A支出",
            "evidence": "proof",
        },
    )
    assert expense.status_code == 200
    op = FinancialOperation.objects.get(id=expense.json()["operation_id"])
    assert op.project_id == lab["project"].id and op.stage_id is None
    assert (
        act(
            lab, "reverse", {"operation_id": str(op.id), "evidence": "不能跨项目冲正"}, user=lab["reviewer"]
        ).status_code
        == 403
    )
    receipt(lab, stage, gross="1000", costs="0", D="1000")
    obligation = commit(lab, settle(lab, stage, "200"), "200")
    payment = pay(lab, obligation, gross="100", withheld="0", stage_id=str(foreign.id))
    paid_op = FinancialOperation.objects.get(id=payment["operation_id"])
    assert paid_op.stage_id == uuid.UUID(stage) and paid_op.project_id == lab["project"].id


def test_revoked_task_grant_removes_financial_projection_and_new_forecast(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    allocation = start(lab, bounty)
    stage, _ = plan(lab, bounty=bounty)
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).delete()
    from plane.lab.bounty_models import BountyTaskAccess

    grant = BountyTaskAccess.objects.get(allocation_id=allocation)
    grant.requires_project_membership = False
    grant.save(update_fields=["requires_project_membership"])
    client = lab["client"](lab["member"])
    body = {"stage_id": stage, "kind": "member", "basis": "budget", "user_id": str(lab["member"].id)}
    assert client.post(lab["base"] + "finance/forecast/", body, format="json").status_code == 201
    grant.revoked_at = timezone.now()
    grant.save(update_fields=["revoked_at"])
    assert client.post(lab["base"] + "finance/forecast/", body, format="json").status_code == 403
    data = overview(lab, lab["member"])
    assert not data["stages"] and not data["formulas"] and not data["forecasts"]


def test_concurrent_commitment_cannot_double_reserve_unpaid_reward(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000")
    final = settle(lab, stage, "700")

    def reserve(_):
        close_old_connections()
        try:
            return act(lab, "commit", {"settlement_id": final, "amount": "500"}).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(reserve, range(2)))
    assert sorted(outcomes) == [200, 400]
    assert PaymentCommitment.objects.count() == 1


def test_future_funds_year_uses_workspace_timezone_at_midnight(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at="2026-01-01T00:30:00+08:00")
    assert act(lab, "future-plan", {"year": 2025, "amount": "150"}).status_code == 400
    assert act(lab, "future-plan", {"year": 2026, "amount": "150"}).status_code == 200


def test_public_duty_zero_revision_keeps_paid_and_reserved_guards(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="10000", costs="0", D="10000")
    body = {"user_id": str(lab["member"].id), "period": "2026-10", "duty": "可更正职责", "amount": "100"}
    initial = act(lab, "public-duty", body)
    assert initial.status_code == 200
    award_id = initial.json()["id"]
    committed = act(lab, "public-commit", {"award_id": award_id, "amount": "100"})
    assert committed.status_code == 200
    assert act(lab, "public-duty", {**body, "award_id": award_id, "amount": "0"}).status_code == 400
    assert act(lab, "public-cancel-commit", {"commitment_id": committed.json()["id"]}).status_code == 200
    zero = act(lab, "public-duty", {**body, "award_id": award_id, "amount": "0"})
    assert zero.status_code == 200
    rows = overview(lab)["public_awards"]
    assert rows[0]["amount"] == "0.00" and rows[0]["revision"] == 2
    assert PublicDutyAward.objects.get(id=award_id).amount == Decimal("100")


def test_only_lead_can_publish_task_snapshot_and_card_keeps_old_formula(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    start(lab, bounty)
    stage, _ = plan(lab, bounty=bounty)
    body = {"stage_id": stage, "kind": "task", "basis": "budget", "bounty_id": bounty}
    assert lab["client"](lab["member"]).post(lab["base"] + "finance/forecast/", body, format="json").status_code == 403
    saved = lab["client"](lab["lead"]).post(lab["base"] + "finance/forecast/", body, format="json")
    assert saved.status_code == 201
    changed = lab["client"](lab["lead"]).post(
        lab["base"] + f"finance/formulas/{lab['project'].id}/",
        {"task_expression": "E", "member_expression": "E", "parameters": [], "reason": "新公式不改旧参考"},
        format="json",
    )
    assert changed.status_code == 201
    hall = lab["client"](lab["member"]).get(lab["base"] + "bounties/").json()
    card = next(row for row in hall if row["id"] == bounty)
    assert card["reward_estimate"]["amount"] == saved.json()["result"]
    assert card["reward_estimate"]["formula_version"] == 1


def test_finance_overview_and_workflow_gets_do_not_initialize_business_policy(laboratory):
    lab = laboratory
    assert not FinancePolicy.objects.exists()
    data = overview(lab)
    assert data["manager_id"] == str(lab["lead"].id)
    response = lab["client"](lab["lead"]).get(lab["base"] + "finance/workflow/")
    assert response.status_code == 200, response.content
    assert not FinancePolicy.objects.exists() and not FinancialOperation.objects.exists()


def test_retained_stage_allocation_does_not_repeat_partition_or_auto_settle(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000")
    settle(lab, stage, "500")
    assert (
        act(lab, "carryover", {"from_account_id": str(cash(lab, "execution", stage).id), "amount": "200"}).status_code
        == 200
    )
    second = lab["client"](lab["lead"]).post(
        lab["base"] + "stages/",
        {"project_id": str(lab["project"].id), "name": "下一阶段", "budget": "100"},
        format="json",
    )
    assert second.status_code == 201
    target_stage = second.json()["id"]
    frozen = act(
        lab,
        "stage",
        {
            "stage_id": target_stage,
            "E": "300",
            "purposes": [{"name": "下一阶段执行奖励", "amount": "300"}],
            "members": [],
            "history": [],
            "upgraded": False,
        },
    )
    assert frozen.status_code == 200
    source = cash(lab, "retained", stage)
    body = {"from_account_id": str(source.id), "stage_id": target_stage, "amount": "200"}
    wrong_kind = act(lab, "stage-allocation", {**body, "from_account_id": str(cash(lab, "project").id)})
    assert wrong_kind.status_code == 400
    assert act(lab, "stage-allocation", {**body, "stage_id": stage}).status_code == 400
    assert act(lab, "stage-allocation", {**body, "amount": "200.01"}).status_code == 400
    moved = act(lab, "stage-allocation", body)
    assert moved.status_code == 200, moved.content
    assert balance(source) == 0 and balance(cash(lab, "execution", target_stage)) == Decimal("200")
    assert balance(cash(lab, "future_pool")) == Decimal("150")
    assert balance(cash(lab, "public")) == Decimal("100")
    assert balance(cash(lab, "risk", stage)) == Decimal("50")
    assert RewardSettlement.objects.count() == 1
    assert (
        act(
            lab,
            "settlement",
            {
                "stage_id": target_stage,
                "user_id": str(lab["member"].id),
                "amount": "200.01",
                "performance_basis": "超过真实结转",
            },
        ).status_code
        == 400
    )
    op = FinancialOperation.objects.get(id=moved.json()["operation_id"])
    assert op.stage_id == uuid.UUID(target_stage) and op.project_id == lab["project"].id


def test_opening_risk_is_evidenced_batch_and_can_release_without_new_partition(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    opening = act(
        lab,
        "opening",
        {
            "stage_id": stage,
            "kind": "risk",
            "amount": "100",
            "source": "旧批次真实储备金",
            "evidence": "bank:prior-reserve",
        },
    )
    assert opening.status_code == 200
    batch = CashBatch.objects.get(operation_id=opening.json()["operation_id"])
    assert batch.D == 0 and batch.risk == Decimal("100")
    assert (
        act(
            lab,
            "risk-use",
            {
                "batch_id": str(batch.id),
                "amount": "20",
                "category": "rework",
                "purpose": "原责任返工",
                "evidence": "bank:rework",
            },
        ).status_code
        == 200
    )
    assert (
        act(
            lab, "risk-release", {"batch_id": str(batch.id), "amount": "80", "evidence": "真实储备解除风险"}
        ).status_code
        == 200
    )
    assert balance(cash(lab, "execution", stage)) == Decimal("80")
    assert balance(cash(lab, "risk", stage)) == 0
    assert not FinancialAccount.objects.filter(kind__in=["public", "future_pool"]).exists()
    assert not RewardSettlement.objects.exists()


def test_history_opening_snapshot_survives_later_expired_installment(laboratory):
    lab = laboratory
    today = timezone.localdate()
    stage, _ = plan(
        lab,
        upgraded=True,
        history=[
            historical(lab, qualified=months_before(today, 36)),
            historical(lab, user=lab["reviewer"], qualified=today),
        ],
    )
    opening = act(
        lab,
        "opening",
        {
            "stage_id": stage,
            "kind": "history",
            "amount": "100",
            "source": "首次资助",
            "evidence": "prior:historical",
            "occurred_at": f"{today.isoformat()}T12:00:00+08:00",
        },
    )
    assert opening.status_code == 200
    first = CashBatch.objects.get(operation_id=opening.json()["operation_id"])
    assert len(first.history_snapshot) == 2
    next_day = today + timezone.timedelta(days=1)
    receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at=f"{next_day.isoformat()}T12:00:00+08:00")
    first.refresh_from_db()
    assert len(first.history_snapshot) == 2
    assert act(lab, "history-settlement", {"stage_id": stage}).status_code == 200
    values = {row["user_id"]: row["amount"] for row in overview(lab)["settlements"]}
    assert values[str(lab["member"].id)] == "50.00"
    assert values[str(lab["reviewer"].id)] == "85.00"
