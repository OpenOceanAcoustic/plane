# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""All cash mutations share a workspace lock, authorization and idempotency boundary."""

import calendar
import hashlib
import json
import re
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from types import SimpleNamespace
from decimal import Decimal, ROUND_DOWN

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import Project, User, WorkspaceMember
from .auth import audit, lock
from .finance_formulas import (
    BUILTINS,
    TEMPLATES,
    decimal_value,
    evaluate,
    money,
    parameter_definitions,
    parse_expression,
)
from .finance_models import (
    CashBatch,
    CommitmentCancellation,
    FinancePolicy,
    FinancialAccount,
    FinancialEntry,
    FinancialOperation,
    OfflinePayment,
    PaymentCommitment,
    RewardForecast,
    RewardFormula,
    RewardSettlement,
    StageBudget,
    PublicDutyAward,
    PublicDutyCommitment,
    PublicDutyPayment,
)
from .models import Allocation, Bounty, Ledger, Stage
from .permissions import require_lead

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
LABELS = {
    "project": "项目资金",
    "execution": "成员执行奖励",
    "history": "历史孵化奖励",
    "risk": "风险准备金",
    "future_pool": "未来项目新增资金",
    "future_research": "未来项目研究支出",
    "future_exploration": "探索奖励",
    "public": "公共贡献池",
    "retained": "未用留存",
    "dispute": "争议预留",
    "withholding": "代扣待缴",
}
PUBLIC_KINDS = {"future_pool", "future_research", "future_exploration", "public"}


def aggregate(rows, field):
    return rows.aggregate(value=Sum(field))["value"] or ZERO


def active_operations(rows):
    return rows.filter(operation__reversal__isnull=True, operation__reverses__isnull=True)


def policy(workspace, create=False):
    row = FinancePolicy.objects.filter(workspace=workspace).first()
    if row:
        return row
    first = (
        WorkspaceMember.objects.filter(workspace=workspace, role=20, is_active=True, member__is_active=True)
        .order_by("created_at", "id")
        .first()
    )
    if not first:
        raise ValidationError("请先指定有效工作区管理员")
    if not create:
        return SimpleNamespace(manager=first.member, manager_id=first.member_id, workspace=workspace, id=None)
    row, _ = FinancePolicy.objects.get_or_create(workspace=workspace, defaults={"manager": first.member})
    return row


def manager_allowed(user, workspace):
    return (
        policy(workspace).manager_id == user.id
        and WorkspaceMember.objects.filter(
            workspace=workspace, member=user, role=20, is_active=True, member__is_active=True
        ).exists()
    )


def require_manager(user, workspace):
    if not manager_allowed(user, workspace):
        raise PermissionDenied("公共资金池由指定工作区管理员管理")


def account(workspace, kind, stage=None, project=None):
    if kind not in LABELS:
        raise ValidationError("资金账户类型无效")
    if kind in PUBLIC_KINDS:
        stage, project = None, None
    elif stage:
        project = stage.project
    if kind in {"execution", "history", "risk", "dispute"} and not stage:
        raise ValidationError("奖励和准备金必须绑定已冻结阶段")
    if kind not in PUBLIC_KINDS | {"withholding"} and not project:
        raise ValidationError("项目资金账户必须绑定项目")
    scope = f"{workspace.id}:{stage.id if stage else project.id if project else 'public'}:{kind}"
    row, _ = FinancialAccount.objects.get_or_create(
        scope_key=scope,
        defaults={
            "workspace": workspace,
            "kind": kind,
            "stage": stage,
            "project": project,
            "project_id_snapshot": project.id if project else None,
        },
    )
    return row


def account_permission(user, row):
    if row.kind in PUBLIC_KINDS or row.kind == "withholding" and row.project_id_snapshot is None:
        require_manager(user, row.workspace)
    else:
        require_lead(user, row.project)


def balance(row):
    return aggregate(row.entries.all(), "delta")


def commitment_paid(row):
    return aggregate(active_operations(row.payments.all()), "gross")


def commitment_cancelled(row):
    return CommitmentCancellation.objects.filter(commitment=row, operation__reversal__isnull=True).exists() or hasattr(
        row.operation, "reversal"
    )


def commitment_remaining(row):
    return ZERO if commitment_cancelled(row) else row.amount - commitment_paid(row)


def committed(row):
    return sum((commitment_remaining(item) for item in row.commitments.select_related("operation")), ZERO) + sum(
        (public_commitment_remaining(item) for item in row.public_commitments.select_related("operation")), ZERO
    )


def available(row):
    return balance(row) - committed(row)


def posting(operation, row, delta, batch=None, reverses=None):
    delta = money(abs(delta)) * (-1 if delta < 0 else 1)
    if delta:
        return FinancialEntry.objects.create(
            operation=operation, account=row, delta=delta, batch=batch, reverses=reverses
        )
    return None


def transfer(operation, source, target, value, batch=None):
    if source.id == target.id or value <= 0 or value > available(source):
        raise ValidationError("可用余额不足，或划拨账户相同")
    posting(operation, source, -value, batch)
    posting(operation, target, value, batch)


def public_commitment_cancelled(row):
    return (
        hasattr(row.operation, "reversal")
        or FinancialOperation.objects.filter(
            workspace=row.account.workspace,
            kind="public-cancel-commit",
            payload__commitment_id=str(row.id),
            reversal__isnull=True,
        ).exists()
    )


def public_commitment_paid(row):
    return aggregate(active_operations(row.payments.all()), "gross")


def public_commitment_remaining(row):
    return ZERO if public_commitment_cancelled(row) else row.amount - public_commitment_paid(row)


def public_award_paid(row):
    return aggregate(
        active_operations(PublicDutyPayment.objects.filter(commitment__award__group_key=row.group_key)), "gross"
    )


def public_award_reserved(row):
    return sum(
        (
            public_commitment_remaining(item)
            for item in PublicDutyCommitment.objects.filter(award__group_key=row.group_key).select_related("operation")
        ),
        ZERO,
    )


def public_latest(workspace):
    result = {}
    for row in PublicDutyAward.objects.filter(workspace=workspace, operation__reversal__isnull=True).order_by(
        "group_key", "-revision"
    ):
        result.setdefault(str(row.group_key), row)
    return list(result.values())


def public_outstanding(workspace):
    return sum((row.amount - public_award_paid(row) for row in public_latest(workspace)), ZERO)


def settlement_latest(budget, kind="execution"):
    rows = (
        active_operations(budget.settlements.filter(kind=kind))
        .select_related("forecast", "operation")
        .order_by("user_id_snapshot", "-revision")
    )
    result = {}
    for row in rows:
        result.setdefault(str(row.user_id_snapshot), row)
    return result


def settlement_payments(row):
    return active_operations(
        OfflinePayment.objects.filter(
            commitment__settlement__budget=row.budget,
            commitment__settlement__user_id_snapshot=row.user_id_snapshot,
            commitment__settlement__kind=row.kind,
        )
    )


def settlement_paid(row):
    return aggregate(settlement_payments(row), "gross")


def settlement_reserved(row):
    rows = PaymentCommitment.objects.filter(
        settlement__budget=row.budget, settlement__user_id_snapshot=row.user_id_snapshot, settlement__kind=row.kind
    ).select_related("operation")
    return sum((commitment_remaining(item) for item in rows), ZERO)


def funded(budget, kind="execution"):
    row = FinancialAccount.objects.filter(stage=budget.stage, kind=kind).first()
    if not row:
        return ZERO
    # Paid and withholding transfers consumed funded rewards; cash balance + historic gross payment
    # restores cumulative reward allowance. Dispute/carryover explicitly reduce it.
    paid = aggregate(
        active_operations(
            OfflinePayment.objects.filter(commitment__settlement__budget=budget, commitment__settlement__kind=kind)
        ),
        "gross",
    )
    return balance(row) + paid


def user_in_workspace(workspace, identifier):
    membership = (
        WorkspaceMember.objects.select_related("member")
        .filter(workspace=workspace, member_id=identifier, is_active=True, member__is_active=True)
        .first()
    )
    if not membership:
        raise ValidationError("成员须是当前实验室有效成员")
    return membership.member


def require_reason(data, key="reason"):
    value = str(data.get(key, "")).strip()
    if not value:
        raise ValidationError(f"请填写{key}依据")
    return value


def require_evidence(data):
    return require_reason(data, "evidence")


def stage_budget(user, workspace, identifier):
    row = get_object_or_404(
        StageBudget.objects.select_related("stage__project", "stage__workspace"),
        stage_id=identifier,
        stage__workspace_id_snapshot=workspace.id,
    )
    require_lead(user, row.stage.project)
    return row


def account_by_id(user, workspace, identifier):
    row = get_object_or_404(
        FinancialAccount.objects.select_related("project", "workspace", "stage"), id=identifier, workspace=workspace
    )
    account_permission(user, row)
    return row


def distribute_member(value, upgraded):
    historical = (value * Decimal("0.1")).quantize(CENT, rounding=ROUND_DOWN) if upgraded else ZERO
    execution = (value * Decimal("0.9")).quantize(CENT, rounding=ROUND_DOWN) if upgraded else value
    return execution, historical


def partition(value):
    future = (value * Decimal("0.15")).quantize(CENT, rounding=ROUND_DOWN)
    public = (value * Decimal("0.1")).quantize(CENT, rounding=ROUND_DOWN)
    risk = (value * Decimal("0.05")).quantize(CENT, rounding=ROUND_DOWN)
    # Fractional-cent remainder stays project cash; never increase a member pool to distribute a tail.
    member = (value * Decimal("0.7")).quantize(CENT, rounding=ROUND_DOWN)
    return future, public, risk, member


def months_before(day, count):
    month_index = day.year * 12 + day.month - 1 - count
    year, month_zero = divmod(month_index, 12)
    return date(year, month_zero + 1, min(day.day, calendar.monthrange(year, month_zero + 1)[1]))


def history_shares(values):
    totals = {}
    for item in values:
        totals[item["funding_source"]] = totals.get(item["funding_source"], ZERO) + Decimal(item["vc"])
    result = []
    for item in values:
        value = dict(item)
        total = totals[value["funding_source"]]
        share = Decimal(value["vc"]) / total if total else ZERO
        if "share" in value and abs(decimal_value(value["share"], "历史份额") - share) > Decimal("0.000000000001"):
            raise ValidationError("历史份额须等于本资金来源冻结有效VC占比")
        value["share"] = str(share)
        result.append(value)
    return result


def workspace_zone(workspace):
    try:
        return ZoneInfo(workspace.timezone or "Asia/Shanghai")
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Shanghai")


def validate_history(values, upgraded, workspace):
    if not isinstance(values, list) or len(values) > 200:
        raise ValidationError("历史资格格式错误")
    if values and not upgraded:
        raise ValidationError("普通项目不能配置历史孵化奖励")
    now = timezone.now().astimezone(workspace_zone(workspace)).date()
    result, seen = [], set()
    for item in values:
        qualified = parse_date(str(item.get("qualified_at", "")))
        try:
            identifier = str(uuid.UUID(str(item.get("user_id"))))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("历史成员ID格式无效")
        source = require_reason(item, "funding_source")
        vc = money(item.get("vc"))
        if not qualified or qualified > now or (identifier, source) in seen:
            raise ValidationError("历史事实日期不能在未来，同一资金来源的成员不能重复")
        value = {
            "user_id": identifier,
            "vc": str(vc),
            "funding_source": source,
            "qualified_at": qualified.isoformat(),
            "basis": require_reason(item, "basis"),
        }
        if item.get("inherited_from"):
            value["inherited_from"] = str(item["inherited_from"]).strip()
            value["source_basis"] = require_reason(item, "source_basis")
        if "share" in item and item["share"] not in (None, ""):
            value["share"] = item["share"]
        result.append(value)
        seen.add((identifier, source))
    return history_shares(result)


def receipt_history_snapshot(budget, source, fact):
    if not budget.upgraded:
        return []
    day = fact.astimezone(workspace_zone(budget.stage.workspace)).date()
    first_source = (
        CashBatch.objects.filter(
            budget__stage__project_id_snapshot=budget.stage.project_id_snapshot,
            budget__upgraded=True,
            source=source,
            operation__reversal__isnull=True,
        )
        .order_by("created_at")
        .first()
    )
    first_project = (
        CashBatch.objects.filter(
            budget__stage__project_id_snapshot=budget.stage.project_id_snapshot,
            budget__upgraded=True,
            operation__reversal__isnull=True,
        )
        .order_by("created_at")
        .first()
    )
    if first_source:
        original = first_source.history_snapshot
    else:
        original = [dict(item) for item in budget.history if item["funding_source"] == source]
        if first_project and first_project.source != source:
            # A separate grant has no automatic historical right; an explicit inheritance basis is required.
            original = [
                item
                for item in original
                if item.get("inherited_from") == first_project.source and item.get("source_basis")
            ]
    # Each installment must itself fall within the qualification's 36 calendar month period.
    # Expired shares remain unallocated; never normalize the surviving shares or dilute the frozen denominator.
    return [
        item
        for item in original
        if parse_date(item["qualified_at"]) <= day <= months_before(parse_date(item["qualified_at"]), -36)
    ]


def create_budget(operation, user, workspace, data):
    stage = get_object_or_404(
        Stage.objects.select_related("project", "workspace"),
        id=data.get("stage_id"),
        workspace_id_snapshot=workspace.id,
    )
    require_lead(user, stage.project)
    if StageBudget.objects.filter(stage=stage).exists():
        raise ValidationError("本阶段现金方案已经冻结；请新建阶段保留旧方案")
    value = money(data.get("E"))
    purposes = data.get("purposes", [])
    if not isinstance(purposes, list) or not purposes or len(purposes) > 100:
        raise ValidationError("请填写预算用途条目")
    purposes = [{"name": require_reason(item, "name"), "amount": str(money(item.get("amount")))} for item in purposes]
    if sum((Decimal(item["amount"]) for item in purposes), ZERO) != value:
        raise ValidationError("用途条目合计必须等于阶段执行预算E")
    members, seen = [], set()
    for item in data.get("members", []):
        member = user_in_workspace(workspace, item.get("user_id"))
        b, r, vc = (
            decimal_value(item.get("b", "0"), "基础份额"),
            decimal_value(item.get("r", "0"), "职责份额"),
            money(item.get("planned_vc", "0")),
        )
        if member.id in seen or not 0 <= b <= 1 or not 0 <= r <= 1:
            raise ValidationError("成员须唯一，基础/职责份额须在0至1之间")
        members.append(
            {"user_id": str(member.id), "name": member.display_name, "b": str(b), "r": str(r), "planned_vc": str(vc)}
        )
        seen.add(member.id)
    if (
        any(sum((Decimal(item[key]) for item in members), ZERO) > 1 for key in ("b", "r"))
        or sum((Decimal(item["planned_vc"]) for item in members), ZERO) > stage.budget
    ):
        raise ValidationError("成员份额合计不能超过100%，计划VC合计不能超过冻结B")
    upgraded = data.get("upgraded", False)
    if not isinstance(upgraded, bool):
        raise ValidationError("upgraded必须为布尔值")
    history = validate_history(data.get("history", []), upgraded, workspace)
    for item in history:
        member = user_in_workspace(workspace, item["user_id"])
        item["name"] = member.display_name
    row = StageBudget.objects.create(
        stage=stage,
        E=value,
        purposes=purposes,
        members=members,
        upgraded=upgraded,
        history=history,
        actor=user,
        actor_name=user.display_name,
        reason=operation.reason,
    )
    for kind in ("execution", "history", "risk", "dispute"):
        account(workspace, kind, stage=stage)
    account(workspace, "project", project=stage.project)
    if not RewardFormula.objects.filter(project_id_snapshot=stage.project_id_snapshot).exists():
        template = TEMPLATES[0]
        RewardFormula.objects.create(
            workspace=workspace,
            project=stage.project,
            project_id_snapshot=stage.project_id_snapshot,
            version=1,
            task_expression=template["task_expression"],
            member_expression=template["member_expression"],
            parameters=[],
            reason="初始可修改模板",
            actor=user,
            actor_name=user.display_name,
        )
    return row, stage


def create_receipt(operation, user, workspace, data):
    budget = stage_budget(user, workspace, data.get("stage_id"))
    require_evidence(data)
    gross, costs, value = money(data.get("gross"), True), money(data.get("costs", "0")), money(data.get("D"))
    if value > gross - costs:
        raise ValidationError("核准D不能超过本次到账扣除实际成本后的余额")
    source = require_reason(data, "source")
    future, public, risk, member = partition(value)
    execution, history = distribute_member(member, budget.upgraded)
    row = CashBatch.objects.create(
        operation=operation,
        budget=budget,
        gross=gross,
        costs=costs,
        D=value,
        source=source,
        risk=risk,
        execution=execution,
        history=history,
        history_snapshot=receipt_history_snapshot(budget, source, operation.occurred_at),
    )
    project_account = account(workspace, "project", project=budget.stage.project)
    posting(operation, project_account, gross, row)
    # Costs used in D are actual expenses here exactly once, never deducted again from the pools.
    posting(operation, project_account, -costs, row)
    for kind, amount in (
        ("future_pool", future),
        ("public", public),
        ("risk", risk),
        ("execution", execution),
        ("history", history),
    ):
        if amount:
            transfer(operation, project_account, account(workspace, kind, stage=budget.stage), amount, row)
    return row, budget.stage


def create_settlement(operation, user, workspace, data):
    budget = stage_budget(user, workspace, data.get("stage_id"))
    member = user_in_workspace(workspace, data.get("user_id"))
    final = money(data.get("amount"))
    basis = require_reason(data, "performance_basis")
    previous = settlement_latest(budget).get(str(member.id))
    latest = settlement_latest(budget)
    total = sum((item.amount for key, item in latest.items() if key != str(member.id)), ZERO) + final
    if total > funded(budget):
        raise ValidationError("累计核准执行奖励超过本阶段真实到账可分配额度")
    if previous and final < settlement_paid(previous) + settlement_reserved(previous):
        raise ValidationError("核准金额不能低于已付和已有付款安排；先取消未支付安排")
    forecast = None
    if data.get("forecast_id"):
        forecast = get_object_or_404(
            RewardForecast, id=data["forecast_id"], budget=budget, kind="member", user_id_snapshot=member.id
        )
    return RewardSettlement.objects.create(
        operation=operation,
        budget=budget,
        user=member,
        user_id_snapshot=member.id,
        user_name=member.display_name,
        amount=final,
        revision=(previous.revision + 1 if previous else 1),
        performance_basis=basis,
        forecast=forecast,
    ), budget.stage


def historical_amounts(budget):
    result = {}
    for batch in budget.batches.filter(operation__reversal__isnull=True):
        historical_account = account(budget.stage.workspace, "history", stage=budget.stage)
        accrued = aggregate(
            historical_account.entries.filter(batch=batch).exclude(operation__kind__in=("payment",)), "delta"
        )
        # Paid entries are excluded: qualification is based on original funded pool, not its cash remainder.
        for item in batch.history_snapshot:
            key = item["user_id"]
            amount = (accrued * Decimal(item["share"])).quantize(CENT, rounding=ROUND_DOWN)
            result[key] = (result.get(key, (ZERO, item))[0] + amount, item)
    historical_account = account(budget.stage.workspace, "history", stage=budget.stage)
    for entry in historical_account.entries.filter(
        operation__kind="opening", operation__reversal__isnull=True, batch__isnull=True
    ).select_related("operation"):
        snapshot = receipt_history_snapshot(
            budget, str(entry.operation.payload.get("source", "")), entry.operation.occurred_at
        )
        for item in snapshot:
            key = item["user_id"]
            amount = (entry.delta * Decimal(item["share"])).quantize(CENT, rounding=ROUND_DOWN)
            result[key] = (result.get(key, (ZERO, item))[0] + amount, item)
    return result


def create_history_settlement(operation, user, workspace, data):
    budget = stage_budget(user, workspace, data.get("stage_id"))
    if not budget.upgraded:
        raise ValidationError("仅升级项目支持历史孵化奖励")
    latest = settlement_latest(budget, "history")
    result = []
    for key, (amount, item) in historical_amounts(budget).items():
        previous = latest.get(key)
        if previous and previous.amount == amount:
            continue
        if previous and amount < settlement_paid(previous) + settlement_reserved(previous):
            raise ValidationError("历史核准金额不能低于已支付和承诺")
        member = User.objects.filter(id=key).first()
        child = FinancialOperation.objects.create(
            workspace=workspace,
            project=budget.stage.project,
            project_id_snapshot=budget.stage.project_id_snapshot,
            stage=budget.stage,
            kind="history-award",
            request_key=uuid.uuid4(),
            fingerprint=operation.fingerprint,
            actor=user,
            actor_name=user.display_name,
            reason=operation.reason,
            evidence=operation.evidence,
            occurred_at=operation.occurred_at,
            payload={"parent_operation_id": str(operation.id), "user_id": key},
        )
        row = RewardSettlement.objects.create(
            operation=child,
            budget=budget,
            user=member,
            user_id_snapshot=key,
            user_name=item.get("name", "历史成员"),
            kind="history",
            revision=(previous.revision + 1 if previous else 1),
            amount=amount,
            performance_basis=item["basis"],
        )
        result.append(str(row.id))
    if sum((value[0] for value in historical_amounts(budget).values()), ZERO) > funded(budget, "history"):
        raise ValidationError("历史奖励超出实际历史资金额度")
    return budget, budget.stage


def create_commit(operation, user, workspace, data):
    settlement = get_object_or_404(
        RewardSettlement.objects.select_related("budget__stage__project", "budget__stage__workspace"),
        id=data.get("settlement_id"),
        budget__stage__workspace_id_snapshot=workspace.id,
    )
    require_lead(user, settlement.budget.stage.project)
    latest = settlement_latest(settlement.budget, settlement.kind).get(str(settlement.user_id_snapshot))
    if not latest or latest.id != settlement.id:
        raise ValidationError("请选择成员最新累计核准记录")
    value = money(data.get("amount"), True)
    cash = account(workspace, settlement.kind, stage=settlement.budget.stage)
    if value > settlement.amount - settlement_paid(settlement) - settlement_reserved(settlement) or value > available(
        cash
    ):
        raise ValidationError("超过未付款未承诺金额，或实际可承诺现金不足")
    return PaymentCommitment.objects.create(
        operation=operation, settlement=settlement, account=cash, amount=value
    ), settlement.budget.stage


def create_payment(operation, user, workspace, data):
    row = get_object_or_404(
        PaymentCommitment.objects.select_related("settlement__budget__stage__project", "account", "operation"),
        id=data.get("commitment_id"),
        account__workspace=workspace,
    )
    require_lead(user, row.settlement.budget.stage.project)
    require_evidence(data)
    gross, withheld = money(data.get("gross"), True), money(data.get("withheld", "0"))
    if gross > commitment_remaining(row) or withheld > gross or gross > balance(row.account):
        raise ValidationError("实付及扣缴不得超过付款安排、账面现金，扣缴不得超过核销金额")
    reference = require_reason(data, "reference")
    payment = OfflinePayment.objects.create(
        operation=operation,
        commitment=row,
        gross=gross,
        withheld=withheld,
        net=gross - withheld,
        reference=reference[:255],
    )
    posting(operation, row.account, -(gross - withheld))
    if withheld:
        # Gross commitment is consumed; withholding remains real cash in its payable account.
        posting(operation, row.account, -withheld)
        posting(operation, account(workspace, "withholding", project=row.account.project), withheld)
    return payment, row.settlement.budget.stage


def release_risk(operation, user, workspace, data):
    batch = get_object_or_404(
        CashBatch.objects.select_related("budget__stage__project", "budget__stage__workspace", "operation"),
        id=data.get("batch_id"),
        budget__stage__workspace_id_snapshot=workspace.id,
        operation__reversal__isnull=True,
    )
    require_lead(user, batch.budget.stage.project)
    require_evidence(data)
    value = money(data.get("amount"), True)
    risk = account(workspace, "risk", stage=batch.budget.stage)
    remaining = aggregate(risk.entries.filter(batch=batch), "delta")
    if value > remaining:
        raise ValidationError("释放金额超过该原批次尚未释放的真实准备金")
    execution, historical = distribute_member(value, batch.budget.upgraded)
    if not execution and not historical:
        raise ValidationError("金额尾差未形成可释放奖励，继续留在原批次准备金")
    for kind, amount in (("execution", execution), ("history", historical)):
        if amount:
            transfer(operation, risk, account(workspace, kind, stage=batch.budget.stage), amount, batch)
    return batch, batch.budget.stage


def external_expense(operation, user, workspace, data, tax=False):
    row = account_by_id(user, workspace, data.get("account_id"))
    value = money(data.get("amount"), True)
    if row.kind not in (
        {"withholding"} if tax else {"project", "retained", "public", "future_research", "future_exploration"}
    ):
        raise ValidationError("该账户须通过核准/付款流程办理，不能直接登记支出")
    require_evidence(data)
    if not tax:
        require_reason(data, "purpose")
    if value > available(row) or row.kind == "public" and balance(row) - value < public_outstanding(workspace):
        raise ValidationError("实际可用现金不足，或不能侵占已核准公共职责奖励")
    posting(operation, row, -value)
    return row, row.stage


def move_reserved(operation, user, workspace, data, action):
    source = account_by_id(user, workspace, data.get("from_account_id"))
    value = money(data.get("amount"), True)
    if action in ("dispute", "carryover"):
        if source.kind != "execution":
            raise ValidationError("只能处理阶段未核准执行奖励")
        budget = StageBudget.objects.get(stage=source.stage)
        allocated = sum((row.amount for row in settlement_latest(budget).values()), ZERO)
        if value > funded(budget) - allocated:
            raise ValidationError("不能预留或结转已核准应付奖励")
        target = account(workspace, "dispute" if action == "dispute" else "retained", stage=source.stage)
    else:
        target = account_by_id(user, workspace, data.get("to_account_id"))
        if source.kind != "dispute" or target.kind != "execution" or source.stage_id != target.stage_id:
            raise ValidationError("争议预留只能释放回原阶段执行账户")
    transfer(operation, source, target, value)
    return source, source.stage


def reverse_operation(operation, user, workspace, data):
    original = get_object_or_404(
        FinancialOperation.objects.select_related("project"), id=data.get("operation_id"), workspace=workspace
    )
    if original.kind == "exploration-allocation":
        require_manager(user, workspace)
    elif original.project_id_snapshot:
        require_lead(user, original.project)
    else:
        require_manager(user, workspace)
    require_evidence(data)
    if (
        original.reverses_id
        or (hasattr(original, "reversal") and original.reversal.id != operation.id)
        or original.kind
        in {
            "stage",
            "manager",
            "history-settlement",
            "history-award",
            "cancel-commit",
            "settlement",
            "commit",
            "public-duty",
            "public-commit",
            "public-cancel-commit",
        }
    ):
        raise ValidationError("该记录不可冲正；核准请追加修订，承诺请取消，冻结方案不可覆盖")
    entries = list(original.entries.select_related("account", "batch"))
    for entry in entries:
        if original.kind == "exploration-allocation":
            # This action is managed by the designated public manager and explicitly targets one approved stage.
            if (
                entry.account.kind not in {"future_exploration", "execution"}
                or entry.account.kind == "execution"
                and entry.account.stage_id != original.stage_id
            ):
                raise PermissionDenied("探索拨款记录的账户范围不一致")
        elif entry.account.kind in PUBLIC_KINDS and original.kind == "receipt":
            if not entry.batch_id or entry.batch.operation_id != original.id:
                raise PermissionDenied("只有原始到账分池记录可以随原批次冲正公共池划入")
        else:
            account_permission(user, entry.account)
    if not entries:
        raise ValidationError("该记录没有可冲正资金流水")
    changes = {}
    for entry in entries:
        changes.setdefault(entry.account_id, [entry.account, ZERO])[1] -= entry.delta
    for row, delta in changes.values():
        if balance(row) + delta < committed(row):
            raise ValidationError("冲正后将透支或侵占已有承诺，请先处理后续资金事项")
        if row.kind == "public" and balance(row) + delta < public_outstanding(workspace):
            raise ValidationError("冲正会侵占已核准公共职责奖励")
        if row.kind in ("execution", "history"):
            budget = StageBudget.objects.get(stage=row.stage)
            final = sum((item.amount for item in settlement_latest(budget, row.kind).values()), ZERO)
            # Reversing a payment also removes paid amount, so do not count its restored cash twice.
            if funded(budget, row.kind) + delta < final:
                raise ValidationError("冲正会使阶段累计核准奖励超过真实资金，请先追加核准调整")
    if original.kind == "public-payment":
        payment = PublicDutyPayment.objects.get(operation=original)
        if public_commitment_cancelled(payment.commitment):
            raise ValidationError("公共付款安排已经取消，不能恢复付款")
    if original.kind == "payment":
        payment = OfflinePayment.objects.get(operation=original)
        if commitment_cancelled(payment.commitment):
            raise ValidationError("付款安排已经取消，不能恢复到该安排；请先核查更正")
    for entry in entries:
        posting(operation, entry.account, -entry.delta, entry.batch, reverses=entry)
    return original, original.stage


def operation_scope(workspace, action, data):
    """Scope is derived from the action's actual resource, never unrelated caller-supplied IDs."""
    stage, project, original = None, None, None
    if action == "reverse":
        original = get_object_or_404(
            FinancialOperation.objects.select_related("stage", "project"),
            id=data.get("operation_id"),
            workspace=workspace,
        )
        if original.reverses_id or hasattr(original, "reversal"):
            raise ValidationError("记录已冲正或是冲正记录")
        return original.stage, original.project, original
    if (
        action in {"stage", "receipt", "settlement", "history-settlement", "exploration-allocation", "stage-allocation"}
        or action == "opening"
        and data.get("stage_id")
    ):
        stage = get_object_or_404(
            Stage.objects.select_related("project"), id=data.get("stage_id"), workspace_id_snapshot=workspace.id
        )
        if action == "opening" and data.get("project_id") and str(stage.project_id_snapshot) != str(data["project_id"]):
            raise ValidationError("期初余额阶段与项目不一致")
    elif action in {"risk-release", "risk-use"}:
        stage = get_object_or_404(
            CashBatch.objects.select_related("budget__stage__project"),
            id=data.get("batch_id"),
            budget__stage__workspace_id_snapshot=workspace.id,
        ).budget.stage
    elif action == "commit":
        stage = get_object_or_404(
            RewardSettlement.objects.select_related("budget__stage__project"),
            id=data.get("settlement_id"),
            budget__stage__workspace_id_snapshot=workspace.id,
        ).budget.stage
    elif action in {"payment", "cancel-commit"}:
        stage = get_object_or_404(
            PaymentCommitment.objects.select_related("settlement__budget__stage__project"),
            id=data.get("commitment_id"),
            account__workspace=workspace,
        ).settlement.budget.stage
    elif action in {"expense", "tax-remit", "transfer", "dispute", "resolve-dispute", "carryover"}:
        identifier = data.get("account_id") if action in {"expense", "tax-remit"} else data.get("from_account_id")
        row = get_object_or_404(
            FinancialAccount.objects.select_related("project", "stage"), id=identifier, workspace=workspace
        )
        stage, project = row.stage, row.project
    elif action == "opening" and data.get("project_id") and data.get("kind") not in PUBLIC_KINDS:
        project = get_object_or_404(Project, id=data["project_id"], workspace=workspace)
    if stage:
        project = stage.project
    return stage, project, original


def operation_result_id(row):
    lookups = {
        "stage": lambda: StageBudget.objects.get(stage=row.stage).id,
        "receipt": lambda: CashBatch.objects.get(operation=row).id,
        "settlement": lambda: RewardSettlement.objects.get(operation=row).id,
        "history-settlement": lambda: StageBudget.objects.get(stage=row.stage).id,
        "commit": lambda: PaymentCommitment.objects.get(operation=row).id,
        "cancel-commit": lambda: CommitmentCancellation.objects.get(operation=row).id,
        "payment": lambda: OfflinePayment.objects.get(operation=row).id,
        "risk-release": lambda: row.payload.get("batch_id"),
        "risk-use": lambda: row.payload.get("batch_id"),
        "public-duty": lambda: PublicDutyAward.objects.get(operation=row).id,
        "public-commit": lambda: PublicDutyCommitment.objects.get(operation=row).id,
        "public-cancel-commit": lambda: row.payload.get("commitment_id"),
        "public-payment": lambda: PublicDutyPayment.objects.get(operation=row).id,
        "reverse": lambda: row.reverses_id,
        "manager": lambda: FinancePolicy.objects.get(workspace=row.workspace).id,
        "expense": lambda: row.payload.get("account_id"),
        "tax-remit": lambda: row.payload.get("account_id"),
        "transfer": lambda: row.payload.get("from_account_id"),
        "dispute": lambda: row.payload.get("from_account_id"),
        "resolve-dispute": lambda: row.payload.get("from_account_id"),
        "carryover": lambda: row.payload.get("from_account_id"),
        "exploration-allocation": lambda: StageBudget.objects.get(stage=row.stage).id,
        "stage-allocation": lambda: StageBudget.objects.get(stage=row.stage).id,
        "opening": lambda: row.entries.first().account_id,
        "future-plan": lambda: FinancialAccount.objects.get(workspace=row.workspace, kind="future_pool").id,
    }
    return str(lookups.get(row.kind, lambda: row.id)())


@transaction.atomic
def perform(user, workspace, action, data):
    lock(f"finance:{workspace.id}")
    policy(workspace, create=True)
    try:
        key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("财务操作须提供UUID request_key防止重复登记")
    payload = json.loads(json.dumps(dict(data), sort_keys=True, default=str))
    fingerprint = hashlib.sha256(
        json.dumps({"action": action, "payload": payload}, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    previous = FinancialOperation.objects.filter(workspace=workspace, request_key=key).first()
    if previous:
        if previous.actor_id != user.id or previous.fingerprint != fingerprint:
            raise ValidationError("幂等请求键已用于其他操作或内容，请勿复用")
        return {"ok": True, "id": operation_result_id(previous), "operation_id": str(previous.id)}
    reason = require_reason(data)
    fact = parse_datetime(str(data.get("occurred_at", ""))) if data.get("occurred_at") else timezone.now()
    if not fact:
        raise ValidationError("事实时间格式无效")
    if timezone.is_naive(fact):
        raise ValidationError("事实时间须包含时区")
    initial_stage, initial_project, original = operation_scope(workspace, action, data)
    operation = FinancialOperation.objects.create(
        workspace=workspace,
        project=initial_project,
        project_id_snapshot=initial_project.id if initial_project else None,
        stage=initial_stage,
        kind=action,
        request_key=key,
        fingerprint=fingerprint,
        actor=user,
        actor_name=user.display_name,
        reason=reason,
        evidence=str(data.get("evidence", "")),
        payload=payload,
        occurred_at=fact,
        reverses=original,
    )
    result, stage = operation, None
    if action == "manager":
        require_manager(user, workspace)
        manager = user_in_workspace(workspace, data.get("user_id"))
        if not WorkspaceMember.objects.filter(workspace=workspace, member=manager, is_active=True, role=20).exists():
            raise ValidationError("公共池管理员须为有效工作区管理员")
        row = policy(workspace)
        row.manager = manager
        row.save(update_fields=["manager"])
        result = row
    elif action == "stage":
        result, stage = create_budget(operation, user, workspace, data)
    elif action == "receipt":
        result, stage = create_receipt(operation, user, workspace, data)
    elif action == "settlement":
        result, stage = create_settlement(operation, user, workspace, data)
    elif action == "history-settlement":
        result, stage = create_history_settlement(operation, user, workspace, data)
    elif action == "commit":
        result, stage = create_commit(operation, user, workspace, data)
    elif action == "cancel-commit":
        row = get_object_or_404(
            PaymentCommitment.objects.select_related("settlement__budget__stage__project", "operation"),
            id=data.get("commitment_id"),
            account__workspace=workspace,
        )
        require_lead(user, row.settlement.budget.stage.project)
        if commitment_cancelled(row) or commitment_remaining(row) <= 0:
            raise ValidationError("该付款安排已核销或取消")
        result = CommitmentCancellation.objects.create(commitment=row, operation=operation)
        stage = row.settlement.budget.stage
    elif action == "payment":
        result, stage = create_payment(operation, user, workspace, data)
    elif action == "risk-release":
        result, stage = release_risk(operation, user, workspace, data)
    elif action == "risk-use":
        batch = get_object_or_404(
            CashBatch.objects.select_related("budget__stage__project", "budget__stage__workspace"),
            id=data.get("batch_id"),
            budget__stage__workspace_id_snapshot=workspace.id,
            operation__reversal__isnull=True,
        )
        require_lead(user, batch.budget.stage.project)
        require_evidence(data)
        require_reason(data, "purpose")
        if data.get("category") not in ("refund", "rework"):
            raise ValidationError("准备金使用须注明退款或返工责任")
        source = account(workspace, "risk", stage=batch.budget.stage)
        value = money(data.get("amount"), True)
        if value > aggregate(source.entries.filter(batch=batch), "delta") or value > available(source):
            raise ValidationError("超过原批次可用真实准备金")
        posting(operation, source, -value, batch)
        result, stage = batch, batch.budget.stage
    elif action == "public-duty":
        require_manager(user, workspace)
        member = user_in_workspace(workspace, data.get("user_id"))
        period = str(data.get("period", ""))
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
            raise ValidationError("公共职责须注明YYYY-MM月份")
        duty = require_reason(data, "duty")
        amount = money(data.get("amount"))
        source = account(workspace, "public")
        previous = None
        if data.get("award_id"):
            previous = get_object_or_404(
                PublicDutyAward, id=data["award_id"], workspace=workspace, user_id_snapshot=member.id, period=period
            )
            latest = next(item for item in public_latest(workspace) if item.group_key == previous.group_key)
            if latest.id != previous.id:
                raise ValidationError("请选择公共职责最新核准记录追加修订")
            if amount < public_award_paid(previous) + public_award_reserved(previous):
                raise ValidationError("公共职责修订金额不得低于已付和已有付款安排")
        if not previous and amount <= 0:
            raise ValidationError("首次公共职责核准须为正数；更正可降为零但须清除未支付安排")
        additional = amount - (previous.amount if previous else ZERO)
        if public_outstanding(workspace) + additional > balance(source):
            raise ValidationError("公共职责核准合计超过公共贡献池真实现金")
        result = PublicDutyAward.objects.create(
            operation=operation,
            workspace=workspace,
            user=member,
            user_id_snapshot=member.id,
            user_name=member.display_name,
            period=period,
            duty=duty,
            amount=amount,
            group_key=previous.group_key if previous else uuid.uuid4(),
            revision=previous.revision + 1 if previous else 1,
        )
    elif action == "public-commit":
        require_manager(user, workspace)
        award = get_object_or_404(
            PublicDutyAward, id=data.get("award_id"), workspace=workspace, operation__reversal__isnull=True
        )
        if next(item for item in public_latest(workspace) if item.group_key == award.group_key).id != award.id:
            raise ValidationError("请选择公共职责最新核准记录")
        amount = money(data.get("amount"), True)
        source = account(workspace, "public")
        if amount > award.amount - public_award_paid(award) - public_award_reserved(award) or amount > available(
            source
        ):
            raise ValidationError("超过公共职责未付款未承诺金额或可用余额")
        result = PublicDutyCommitment.objects.create(operation=operation, award=award, account=source, amount=amount)
    elif action == "public-cancel-commit":
        require_manager(user, workspace)
        row = get_object_or_404(
            PublicDutyCommitment.objects.select_related("operation", "account"),
            id=data.get("commitment_id"),
            account__workspace=workspace,
        )
        # The creating operation itself is already visible; exclude it when detecting previous cancellation.
        prior = (
            FinancialOperation.objects.filter(
                workspace=workspace,
                kind="public-cancel-commit",
                payload__commitment_id=str(row.id),
                reversal__isnull=True,
            )
            .exclude(id=operation.id)
            .exists()
        )
        if prior or hasattr(row.operation, "reversal") or row.amount <= public_commitment_paid(row):
            raise ValidationError("公共职责付款安排已经核销或取消")
        result = row
    elif action == "public-payment":
        require_manager(user, workspace)
        row = get_object_or_404(
            PublicDutyCommitment.objects.select_related("account", "operation"),
            id=data.get("commitment_id"),
            account__workspace=workspace,
        )
        require_evidence(data)
        gross, withheld = money(data.get("gross"), True), money(data.get("withheld", "0"))
        if gross > public_commitment_remaining(row) or gross > balance(row.account) or withheld > gross:
            raise ValidationError("超出公共职责付款安排或可用现金")
        reference = require_reason(data, "reference")
        result = PublicDutyPayment.objects.create(
            operation=operation,
            commitment=row,
            gross=gross,
            withheld=withheld,
            net=gross - withheld,
            reference=reference[:255],
        )
        posting(operation, row.account, -(gross - withheld))
        if withheld:
            posting(operation, row.account, -withheld)
            posting(operation, account(workspace, "withholding"), withheld)
    elif action in ("expense", "tax-remit"):
        result, stage = external_expense(operation, user, workspace, data, action == "tax-remit")
    elif action in ("dispute", "resolve-dispute", "carryover"):
        result, stage = move_reserved(operation, user, workspace, data, action)
    elif action == "transfer":
        source = account_by_id(user, workspace, data.get("from_account_id"))
        target = account_by_id(user, workspace, data.get("to_account_id"))
        restricted = {"execution", "history", "risk", "dispute", "withholding", "future_pool"}
        if source.kind in restricted or target.kind in restricted:
            raise ValidationError("专项账户只能通过对应核准流程办理")
        if source.project_id != target.project_id:
            raise ValidationError("项目和公共资金不得通过普通划拨混用")
        amount = money(data.get("amount"), True)
        if source.kind == "public" and balance(source) - amount < public_outstanding(workspace):
            raise ValidationError("不能划走已核准公共职责奖励")
        transfer(operation, source, target, amount)
        result, stage = source, source.stage
    elif action == "opening":
        require_evidence(data)
        require_reason(data, "source")
        project = None
        if data.get("project_id"):
            project = get_object_or_404(Project, id=data["project_id"], workspace=workspace)
            require_lead(user, project)
        else:
            require_manager(user, workspace)
        if data.get("stage_id"):
            budget = stage_budget(user, workspace, data["stage_id"])
            stage, project = budget.stage, budget.stage.project
        kind = str(data.get("kind", "project"))
        if kind in ("history",) and (not stage or not StageBudget.objects.get(stage=stage).upgraded):
            raise ValidationError("历史余额须绑定已冻结资格的升级阶段")
        if kind in PUBLIC_KINDS:
            require_manager(user, workspace)
        result = account(workspace, kind, stage=stage, project=project)
        opening_amount = money(data.get("amount"), True)
        imported_batch = None
        if kind in {"risk", "history"}:
            frozen = StageBudget.objects.get(stage=stage)
            imported_batch = CashBatch.objects.create(
                operation=operation,
                budget=frozen,
                gross=opening_amount,
                costs=ZERO,
                D=ZERO,
                source=str(data["source"]),
                risk=opening_amount if kind == "risk" else ZERO,
                execution=ZERO,
                history=opening_amount if kind == "history" else ZERO,
                history_snapshot=receipt_history_snapshot(frozen, str(data["source"]), operation.occurred_at),
            )
        posting(operation, result, opening_amount, imported_batch)
    elif action == "stage-allocation":
        budget = stage_budget(user, workspace, data.get("stage_id"))
        source = account_by_id(user, workspace, data.get("from_account_id"))
        if source.kind != "retained" or source.project_id_snapshot != budget.stage.project_id_snapshot:
            raise ValidationError("阶段结转仅允许同一项目的未用留存资金")
        if source.stage_id == budget.stage_id:
            raise ValidationError("留存资金须明确结转到另一个已冻结阶段")
        value = money(data.get("amount"), True)
        target = account(workspace, "execution", stage=budget.stage)
        transfer(operation, source, target, value)
        result, stage = budget, budget.stage
    elif action == "exploration-allocation":
        require_manager(user, workspace)
        budget = get_object_or_404(
            StageBudget.objects.select_related("stage__project", "stage__workspace"),
            stage_id=data.get("stage_id"),
            stage__workspace_id_snapshot=workspace.id,
        )
        if not budget.stage.project or not budget.stage.project.project_lead_id:
            raise ValidationError("探索资金必须绑定有负责人的冻结阶段")
        value = money(data.get("amount"), True)
        source = account(workspace, "future_exploration")
        target = account(workspace, "execution", stage=budget.stage)
        transfer(operation, source, target, value)
        result, stage = budget, budget.stage
    elif action == "future-plan":
        require_manager(user, workspace)
        try:
            year = int(data.get("year"))
        except (ValueError, TypeError):
            raise ValidationError("请填写编列年度")
        source = account(workspace, "future_pool")
        if not 1900 <= year <= 9998:
            raise ValidationError("编列年度超出支持范围")
        zone = workspace_zone(workspace)
        year_start, year_end = datetime(year, 1, 1, tzinfo=zone), datetime(year + 1, 1, 1, tzinfo=zone)
        new_funds = aggregate(
            source.entries.filter(
                operation__kind__in=("receipt", "opening"),
                operation__occurred_at__gte=year_start,
                operation__occurred_at__lt=year_end,
                delta__gt=0,
                operation__reversal__isnull=True,
            ),
            "delta",
        )
        previous_plans = sum(
            (
                entry.delta
                for entry in source.entries.filter(
                    operation__kind="future-plan", operation__reversal__isnull=True
                ).select_related("operation")
                if str(entry.operation.payload.get("year")) == str(year)
            ),
            ZERO,
        )
        value = money(data.get("amount"), True)
        if value != new_funds + previous_plans:
            raise ValidationError("年度编列金额须等于该年尚未编列的新增未来项目资金")
        research = (value * Decimal("0.7")).quantize(CENT, rounding=ROUND_DOWN)
        exploration = (value * Decimal("0.3")).quantize(CENT, rounding=ROUND_DOWN)
        if not research and not exploration:
            raise ValidationError("年度比例尾差未形成可编列金额，继续留存未来项目池")
        for kind, portion in (("future_research", research), ("future_exploration", exploration)):
            if portion:
                transfer(operation, source, account(workspace, kind), portion)
        result = source
    elif action == "reverse":
        result, stage = reverse_operation(operation, user, workspace, data)
    else:
        raise ValidationError("财务操作无效")
    project = operation.project
    audit(
        f"finance.{action}",
        operation,
        user,
        workspace,
        project_id=str(project.id) if project else None,
        stage_id=str(stage.id) if stage else None,
        operation_id=str(operation.id),
        reason=reason,
        occurred_at=fact.isoformat(),
    )
    return {"ok": True, "id": str(result.id), "operation_id": str(operation.id)}


@transaction.atomic
def save_formula(user, project, data):
    require_lead(user, project)
    lock(f"finance:{project.workspace_id}")
    params = parameter_definitions(data.get("parameters", []))
    expressions = {kind: str(data.get(f"{kind}_expression", "")).strip() for kind in ("task", "member")}
    for kind, expression in expressions.items():
        names = BUILTINS | {item["name"] for item in params if item["scope"] in (kind, "stage")}
        parse_expression(expression, names)
    previous = RewardFormula.objects.filter(project_id_snapshot=project.id).order_by("-version").first()
    row = RewardFormula.objects.create(
        workspace=project.workspace,
        project=project,
        project_id_snapshot=project.id,
        version=previous.version + 1 if previous else 1,
        task_expression=expressions["task"],
        member_expression=expressions["member"],
        parameters=params,
        reason=require_reason(data),
        actor=user,
        actor_name=user.display_name,
    )
    audit(
        "finance.formula",
        row,
        user,
        project.workspace,
        project_id=str(project.id),
        version=row.version,
        reason=row.reason,
    )
    return row


def preview_formula(user, project, data):
    require_lead(user, project)
    kind = data.get("kind", "task")
    if kind not in ("task", "member"):
        raise ValidationError("预测类型无效")
    params = parameter_definitions(data.get("parameters", []))
    inputs = data.get("inputs", {})
    if not isinstance(inputs, dict):
        raise ValidationError("样例参数须为对象")
    allowed = BUILTINS | {item["name"] for item in params if item["scope"] in (kind, "stage")}
    if set(inputs) - allowed:
        raise ValidationError("样例包含未定义或作用范围不符的参数")
    actual = {key: str(decimal_value(value, key)) for key, value in inputs.items()}
    for item in params:
        if item["name"] in allowed and "default" in item and item["name"] not in actual:
            actual[item["name"]] = item["default"]
    result = evaluate(str(data.get(f"{kind}_expression", "")), actual, allowed)
    return {"result": str(result), "inputs": actual}


def authorized_participations(user, workspace):
    from .bounty_access import has_project_access, task_granted

    rows = Allocation.objects.filter(
        bounty__stage__workspace_id_snapshot=workspace.id, user=user, approved=True, confirmed=True
    ).select_related("bounty__stage__workspace", "bounty__issue__project", "bounty__stage__project")
    return [row for row in rows if has_project_access(user, row.bounty) or task_granted(user, row.bounty)]


@transaction.atomic
def create_forecast(user, workspace, data):
    lock(f"finance:{workspace.id}")
    budget = get_object_or_404(
        StageBudget.objects.select_related("stage__project", "stage__workspace"),
        stage_id=data.get("stage_id"),
        stage__workspace_id_snapshot=workspace.id,
    )
    kind, basis = data.get("kind"), data.get("basis")
    if kind not in ("task", "member") or basis not in ("budget", "received"):
        raise ValidationError("请选择任务/成员与预算/到账测算口径")
    formula = (
        RewardFormula.objects.filter(project_id_snapshot=budget.stage.project_id_snapshot).order_by("-version").first()
    )
    if not formula:
        raise ValidationError("项目尚未配置预计奖励公式")
    lead = budget.stage.project and budget.stage.project.project_lead_id == user.id
    if lead:
        require_lead(user, budget.stage.project)
    bounty, member = None, None
    if kind == "task":
        bounty = get_object_or_404(Bounty, id=data.get("bounty_id"), stage=budget.stage)
        if not lead:
            raise PermissionDenied("任务公开参考测算由项目负责人保存")
        vc = bounty.budget if basis == "budget" else aggregate(bounty.ledger.all(), "delta")
        b, r = ZERO, ZERO
    else:
        member = user_in_workspace(workspace, data.get("user_id"))
        if not lead and member.id != user.id:
            raise PermissionDenied("只能创建本人的收益测算")
        if not lead:
            from .permissions import collaboration_projects

            valid_stage = budget.stage.project_id_snapshot in set(
                collaboration_projects(user, workspace)
            ) or budget.stage_id in {item.bounty.stage_id for item in authorized_participations(user, workspace)}
            if not valid_stage:
                raise PermissionDenied("当前阶段访问授权已撤回，不能创建新测算")
        shares = next((item for item in budget.members if item["user_id"] == str(member.id)), None)
        if not shares:
            raise ValidationError("该成员缺少冻结基础/职责和计划VC数据")
        vc = (
            Decimal(shares["planned_vc"])
            if basis == "budget"
            else aggregate(
                Ledger.objects.filter(bounty__stage=budget.stage, allocation__user_id_snapshot=member.id), "delta"
            )
        )
        b, r = Decimal(shares["b"]), Decimal(shares["r"])
    inputs = {
        "E": str(budget.E if basis == "budget" else funded(budget)),
        "B": str(budget.stage.budget),
        "VC": str(vc),
        "b": str(b),
        "r": str(r),
    }
    values = data.get("parameters", {})
    if not isinstance(values, dict) or set(values) & BUILTINS:
        raise ValidationError("自定义参数不能覆盖真实E/B/VC/b/r")
    definitions = {item["name"]: item for item in formula.parameters if item["scope"] in (kind, "stage")}
    if set(values) - definitions.keys():
        raise ValidationError("存在未定义或作用范围不符的自定义参数")
    for name, item in definitions.items():
        if name in values:
            inputs[name] = str(decimal_value(values[name], name))
        elif "default" in item:
            inputs[name] = item["default"]
    expression = getattr(formula, f"{kind}_expression")
    result = evaluate(expression, inputs, BUILTINS | definitions.keys())
    row = RewardForecast.objects.create(
        budget=budget,
        formula=formula,
        kind=kind,
        basis=basis,
        bounty=bounty,
        user=member,
        user_id_snapshot=member.id if member else None,
        expression=expression,
        inputs=inputs,
        result=result,
        actor=user,
        actor_name=user.display_name,
    )
    audit(
        "finance.forecast",
        row,
        user,
        workspace,
        project_id=str(budget.stage.project_id_snapshot),
        stage_id=str(budget.stage_id),
        formula_version=formula.version,
        result=str(result),
    )
    return row


def reward_projection_context(bounties, user):
    """Batch source facts once for every hall card, without per-card accounting/grant scans."""
    rows = list(bounties)
    stage_ids = {row.stage_id for row in rows}
    project_ids = {row.stage.project_id_snapshot for row in rows}
    bounty_ids = {row.id for row in rows}
    budgets = {row.stage_id: row for row in StageBudget.objects.filter(stage_id__in=stage_ids)}
    formulas = {}
    for row in RewardFormula.objects.filter(project_id_snapshot__in=project_ids).order_by(
        "project_id_snapshot", "-version"
    ):
        formulas.setdefault(row.project_id_snapshot, row)
    snapshots = {}
    for row in (
        RewardForecast.objects.filter(bounty_id__in=bounty_ids, kind="task")
        .select_related("formula")
        .order_by("-created_at")
    ):
        snapshots.setdefault((row.bounty_id, row.basis), row)
    vc = {
        item["bounty_id"]: item["amount"]
        for item in Ledger.objects.filter(bounty_id__in=bounty_ids).values("bounty_id").annotate(amount=Sum("delta"))
    }
    allowance = {
        item["account__stage_id"]: item["amount"]
        for item in FinancialEntry.objects.filter(account__kind="execution", account__stage_id__in=stage_ids)
        .values("account__stage_id")
        .annotate(amount=Sum("delta"))
    }
    for item in (
        active_operations(
            OfflinePayment.objects.filter(
                commitment__settlement__budget__stage_id__in=stage_ids, commitment__settlement__kind="execution"
            )
        )
        .values("commitment__settlement__budget__stage_id")
        .annotate(amount=Sum("gross"))
    ):
        key = item["commitment__settlement__budget__stage_id"]
        allowance[key] = allowance.get(key, ZERO) + item["amount"]
    authorized = set()
    by_id = {row.id: row for row in rows}
    if rows:
        from .bounty_models import BountyTaskAccess
        from .permissions import readable_issues

        workspace = rows[0].stage.workspace
        native_ids = set(
            readable_issues(user, workspace)
            .filter(id__in=[row.issue_id for row in rows], is_draft=False, deleted_at__isnull=True)
            .values_list("id", flat=True)
        )
        allocations = Allocation.objects.filter(bounty_id__in=bounty_ids, user=user, approved=True, confirmed=True)
        granted = set(
            BountyTaskAccess.objects.filter(
                allocation__in=allocations, revoked_at__isnull=True, requires_project_membership=False
            ).values_list("allocation__bounty_id", flat=True)
        )
        for allocation in allocations:
            bounty = by_id[allocation.bounty_id]
            valid_issue = bounty.issue_id and not bounty.issue.deleted_at and not bounty.issue.is_draft
            if valid_issue and (bounty.issue_id in native_ids or bounty.id in granted):
                authorized.add(bounty.id)
    # Actual lead membership remains required, even if a stale project_lead field survives revocation.
    from plane.db.models import ProjectMember

    lead_projects = set(
        ProjectMember.objects.filter(
            project_id__in=project_ids, member=user, is_active=True, role__gte=15, project__project_lead=user
        ).values_list("project_id", flat=True)
    )
    return {
        "budgets": budgets,
        "formulas": formulas,
        "snapshots": snapshots,
        "vc": vc,
        "funded": allowance,
        "authorized": authorized,
        "leads": lead_projects,
    }


def bounty_reward_projection(bounty, user, context=None):
    """Public summary contains only money result/version, never formula inputs or cash ledgers."""
    context = context if context is not None else reward_projection_context([bounty], user)
    budget = context["budgets"].get(bounty.stage_id)
    formula = context["formulas"].get(bounty.stage.project_id_snapshot)
    empty = {
        "amount": None,
        "formula_version": formula.version if formula else None,
        "error": "负责人尚未冻结阶段预算或配置公式",
    }
    result = {"stage_budget": str(bounty.stage.budget), "reward_estimate": dict(empty), "received_estimate": None}
    if not budget or not formula:
        return result
    definitions = [item for item in formula.parameters if item["scope"] in ("task", "stage")]
    values = {item["name"]: item["default"] for item in definitions if "default" in item}

    def compute(basis):
        inputs = {
            "E": str(budget.E if basis == "budget" else context["funded"].get(bounty.stage_id, ZERO)),
            "B": str(bounty.stage.budget),
            "VC": str(bounty.budget if basis == "budget" else context["vc"].get(bounty.id, ZERO)),
            "b": "0",
            "r": "0",
            **values,
        }
        try:
            amount = evaluate(formula.task_expression, inputs, BUILTINS | {item["name"] for item in definitions})
            return {"amount": str(amount), "formula_version": formula.version}
        except ValidationError as exc:
            return {
                "amount": None,
                "formula_version": formula.version,
                "error": str(exc.detail[0]) if isinstance(exc.detail, list) else str(exc.detail),
            }

    saved = context["snapshots"].get((bounty.id, "budget"))
    result["reward_estimate"] = (
        {"amount": str(saved.result), "formula_version": saved.formula.version, "forecast_id": str(saved.id)}
        if saved
        else compute("budget")
    )
    if bounty.stage.project_id_snapshot in context["leads"] or bounty.id in context["authorized"]:
        saved_received = context["snapshots"].get((bounty.id, "received"))
        result["received_estimate"] = (
            {
                "amount": str(saved_received.result),
                "formula_version": saved_received.formula.version,
                "forecast_id": str(saved_received.id),
            }
            if saved_received
            else compute("received")
        )
    return result
