# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Project operating costs, payroll, reimbursement and evidence-backed audit adjustments."""

import csv
import json
import re
import uuid
import hashlib
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from io import StringIO

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from plane.db.models import Issue, Project, ProjectMember, WorkspaceMember
from .auth import audit, lock
from .export import csv_cell
from .finance_models import FinancialAccount, FinancialOperation, ProjectCostBudget, CashBatch
from .finance_permissions import project_finance_access, require_project_finance
from .finance_services import available, perform, posting, require_finance_open, finance_removal_state
from .management_models import ProjectManagementRecord, latest_records
from .planning_views import LabView
from .project_budgets import BudgetConflict, CATEGORIES, text_field

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
FINANCE_KINDS = ("funding", "cost", "payroll", "audit", "recovery")


def identifier(value, label="记录ID"):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError(f"{label}无效")


def decimal_value(value, label, positive=False):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", value):
        raise ValidationError(f"{label}须为非负数，最多12位整数及2位小数")
    result = Decimal(value)
    if positive and result <= 0:
        raise ValidationError(f"{label}须大于零")
    return result


def money_text(value):
    if abs(value) > Decimal("999999999999.99"):
        raise ValidationError("计算金额超出上限")
    return f"{value.quantize(CENT, rounding=ROUND_HALF_UP):.2f}"


def day(value, label="日期"):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValidationError(f"{label}无效")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValidationError(f"{label}无效")


def members(project):
    return ProjectMember.objects.filter(
        project=project,
        is_active=True,
        role__gte=15,
        member__is_active=True,
        member_id__in=WorkspaceMember.objects.filter(workspace_id=project.workspace_id, is_active=True).values(
            "member_id"
        ),
    ).select_related("member")


def membership(user, project):
    member = members(project).filter(member=user).first()
    if not member:
        raise PermissionDenied("需要有效项目成员资格")
    return member


def employee(project, value):
    user_id = identifier(value, "成员ID")
    row = get_object_or_404(members(project), member_id=user_id)
    return str(user_id), row.member.display_name


def record_data(row):
    return {
        "id": str(row.object_key),
        "version_id": str(row.id),
        "kind": row.kind,
        "version": row.version,
        "state": row.state,
        "data": row.data,
        "reason": row.reason,
        "actor": row.actor_name,
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "created_at": row.created_at.isoformat(),
    }


def get_previous(project, data, kind=None):
    key = identifier(data.get("record_id"))
    row = latest_records(project.id).filter(object_key=key).first()
    if kind and row and row.kind != kind:
        raise ValidationError("记录类型不匹配")
    expected = data.get("expected_version")
    if type(expected) is not int or expected < 0:
        raise ValidationError("记录版本无效")
    if expected != (row.version if row else 0):
        raise BudgetConflict("记录已有新版本，请刷新后重新编辑")
    return key, row


def append_record(user, project, body, kind, key, previous, state, payload):
    return ProjectManagementRecord.objects.create(
        workspace=project.workspace,
        project=project,
        project_id_snapshot=project.id,
        kind=kind,
        object_key=key,
        version=previous.version + 1 if previous else 1,
        state=state,
        data=payload,
        document_version_id=payload.get("page_version_id") if kind in ("plan", "artifact") else None,
        reason=text_field(body.get("reason"), "操作说明", 2000, required=True),
        actor=user,
        actor_name=user.display_name,
        request_key=identifier(body.get("request_key"), "请求标识"),
        request_snapshot=json.loads(json.dumps(body)),
    )


def recognized_cost(row, rows):
    adjustments = [
        entry
        for entry in rows
        if entry.kind == "audit" and entry.state == "closed" and entry.data["cost_id"] == str(row.object_key)
    ]
    latest = max(
        adjustments, key=lambda entry: (entry.data.get("sequence", 0), entry.created_at, str(entry.id)), default=None
    )
    return Decimal(latest.data["allowed_amount"] if latest else row.data["amount"])


def payroll_for(cost, rows):
    return next(
        (
            row
            for row in rows
            if row.kind == "payroll" and row.state in ("ready", "paid") and str(cost.object_key) in row.data["cost_ids"]
        ),
        None,
    )


def paid_cost(cost, rows):
    if cost.state == "paid":
        return Decimal(cost.data["paid_amount"]), cost.data["payment_operation_id"]
    payroll = payroll_for(cost, rows)
    if payroll and payroll.state == "paid":
        line = next(line for line in payroll.data["lines"] if line["cost_id"] == str(cost.object_key))
        return Decimal(line["amount"]), payroll.data["payment_operation_id"]
    return ZERO, None


def recovered_cost(cost, rows):
    return sum(
        (
            Decimal(row.data["amount"])
            for row in rows
            if row.kind == "recovery" and row.state == "received" and row.data["cost_id"] == str(cost.object_key)
        ),
        ZERO,
    )


def normalize_funding(project, data):
    source_type = data.get("source_type")
    if source_type not in ("external", "internal"):
        raise ValidationError("请选择外部项目或内部项目")
    budget = ProjectCostBudget.objects.filter(project_id_snapshot=project.id).order_by("-version").first()
    return {
        "source_type": source_type,
        "funding_amount": money_text(decimal_value(data.get("funding_amount"), "核定经费")),
        "budget_amount": money_text(decimal_value(data.get("budget_amount"), "核定预算")),
        "basis": text_field(data.get("basis"), "合同／内部决议依据", 4000, required=True),
        "reference": text_field(data.get("reference", ""), "合同／决议编号", 255),
        "budget_version_id": str(budget.id) if budget else None,
    }


def normalize_cost(user, project, data, permissions):
    category = data.get("category")
    if not isinstance(category, str) or category not in CATEGORIES:
        raise ValidationError("费用类别无效")
    user_id, name = employee(project, data.get("user_id"))
    if "record" not in permissions and user_id != str(user.id):
        raise PermissionDenied("只能提交本人的工时和报销")
    issue_id = data.get("issue_id")
    if issue_id:
        issue = get_object_or_404(Issue, id=identifier(issue_id, "工作项ID"), project=project, is_draft=False)
        issue_id = str(issue.id)
    hours = decimal_value(data.get("hours", "0"), "工时")
    rate = decimal_value(data.get("rate", "0"), "工时单价")
    actual = decimal_value(data.get("actual_amount", "0"), "实际费用")
    days = decimal_value(data.get("days", "0"), "出差天数")
    transport = decimal_value(data.get("transport_rate", "0"), "每日交通补助")
    meal = decimal_value(data.get("meal_rate", "0"), "每日餐费补助")
    if category == "labor":
        if not 0 < hours <= 24:
            raise ValidationError("每日劳动工时须大于0且不超过24小时")
        if rate <= 0:
            raise ValidationError("工时单价须大于零")
        actual = days = transport = meal = ZERO
        total = hours * rate
    else:
        hours = rate = ZERO
        if category != "travel":
            days = transport = meal = ZERO
        total = (
            actual
            + (days * transport).quantize(CENT, rounding=ROUND_HALF_UP)
            + (days * meal).quantize(CENT, rounding=ROUND_HALF_UP)
        )
        if total <= 0:
            raise ValidationError("实际费用与补助合计须大于零")
    return {
        "category": category,
        "user_id": user_id,
        "user_name": name,
        "date": day(data.get("date")),
        "issue_id": issue_id or None,
        "work": text_field(data.get("work"), "工作内容／费用事项", 4000, required=True),
        "hours": money_text(hours),
        "rate": money_text(rate),
        "actual_amount": money_text(actual),
        "days": money_text(days),
        "transport_rate": money_text(transport),
        "meal_rate": money_text(meal),
        "transport": money_text(days * transport),
        "meal": money_text(days * meal),
        "amount": money_text(total),
        "evidence": text_field(data.get("evidence", ""), "费用凭证／依据", 4000, required=category != "labor"),
    }


def financial_action(user, project, body, permissions):
    action = body.get("action")
    kind = body.get("kind")
    if not isinstance(kind, str) or kind not in FINANCE_KINDS:
        raise ValidationError("记录类型无效")
    key, previous = get_previous(project, body, kind)
    rows = list(latest_records(project.id))
    data = body.get("data", {})
    if not isinstance(data, dict):
        raise ValidationError("记录内容须为对象")
    if action == "save":
        if kind == "funding":
            require_project_finance(user, project, "record")
            if key != uuid.uuid5(project.id, "funding"):
                raise ValidationError("经费记录标识无效")
            state, data = "confirmed", normalize_funding(project, data)
        elif kind == "cost":
            if previous:
                if previous.state not in ("submitted", "rejected"):
                    raise ValidationError("已核准费用不能改写，请通过审计调整")
                if "record" not in permissions and previous.data["user_id"] != str(user.id):
                    raise PermissionDenied("不能修改其他成员的费用")
            state, data = "submitted", normalize_cost(user, project, data, permissions)
        elif kind == "payroll":
            require_project_finance(user, project, "approve")
            if previous:
                raise ValidationError("工资单不能重建，请取消未付工资单后重新生成")
            user_id, name = employee(project, data.get("user_id"))
            start, end = day(data.get("start"), "开始日期"), day(data.get("end"), "结束日期")
            if start > end:
                raise ValidationError("开始日期不能晚于结束日期")
            costs = [
                row
                for row in rows
                if row.kind == "cost"
                and row.state == "approved"
                and row.data["category"] == "labor"
                and row.data["user_id"] == user_id
                and start <= row.data["date"] <= end
                and not payroll_for(row, rows)
            ]
            if not costs:
                raise ValidationError("所选期间没有可计薪的已核准工时")
            total = sum((recognized_cost(row, rows) for row in costs), ZERO)
            if total <= ZERO:
                raise ValidationError("工资合计须大于零")
            state, data = (
                "ready",
                {
                    "user_id": user_id,
                    "user_name": name,
                    "start": start,
                    "end": end,
                    "cost_ids": [str(row.object_key) for row in costs],
                    "lines": [
                        {
                            "cost_id": str(row.object_key),
                            "version_id": str(row.id),
                            "date": row.data["date"],
                            "work": row.data["work"],
                            "hours": row.data["hours"],
                            "rate": row.data["rate"],
                            "amount": money_text(recognized_cost(row, rows)),
                        }
                        for row in costs
                    ],
                    "hours": money_text(sum((Decimal(row.data["hours"]) for row in costs), ZERO)),
                    "amount": money_text(total),
                },
            )
        elif kind == "audit":
            require_project_finance(user, project, "approve")
            if previous:
                raise ValidationError("审计调整须新增记录")
            cost = next(
                (row for row in rows if row.kind == "cost" and str(row.object_key) == data.get("cost_id")), None
            )
            if not cost or cost.state not in ("approved", "paid"):
                raise ValidationError("请选择已核准或已支付的成本记录")
            payroll = payroll_for(cost, rows)
            if payroll and payroll.state == "ready":
                raise ValidationError("请先取消关联的未付工资单，再调整工时成本")
            amount = decimal_value(data.get("allowed_amount"), "审计认定金额")
            if amount > Decimal(cost.data["amount"]):
                raise ValidationError("审计认定金额不能超过原费用金额")
            paid, operation_id = paid_cost(cost, rows)
            if operation_id and amount > paid - recovered_cost(cost, rows):
                raise ValidationError("认定金额超过已付净额，请先冲正相关追回或新增补发记录")
            original = recognized_cost(cost, rows)
            state, data = (
                "closed",
                {
                    "sequence": 1
                    + max(
                        (
                            entry.data.get("sequence", 0)
                            for entry in rows
                            if entry.kind == "audit" and entry.data["cost_id"] == str(cost.object_key)
                        ),
                        default=0,
                    ),
                    "cost_id": str(cost.object_key),
                    "cost_version_id": str(cost.id),
                    "original_amount": money_text(original),
                    "allowed_amount": money_text(amount),
                    "adjustment": money_text(amount - original),
                    "finding": text_field(data.get("finding"), "审计问题", 4000, required=True),
                    "evidence": text_field(data.get("evidence"), "审计依据", 4000, required=True),
                },
            )
        elif kind == "recovery":
            require_project_finance(user, project, "record")
            if previous:
                raise ValidationError("追回记录须新增")
            cost = next(
                (row for row in rows if row.kind == "cost" and str(row.object_key) == data.get("cost_id")), None
            )
            if not cost:
                raise ValidationError("请选择原成本记录")
            paid, operation_id = paid_cost(cost, rows)
            remaining = max(ZERO, paid - recognized_cost(cost, rows) - recovered_cost(cost, rows))
            amount = decimal_value(data.get("amount"), "本次追回金额", positive=True)
            if amount > remaining or not operation_id:
                raise ValidationError("本次追回金额超过待追回金额")
            original = get_object_or_404(FinancialOperation, id=operation_id, workspace=project.workspace)
            source = get_object_or_404(
                FinancialAccount,
                id=original.payload["account_id"],
                workspace=project.workspace,
                project_id_snapshot=project.id,
                kind="project",
            )
            evidence = text_field(data.get("evidence"), "追回凭证", 4000, required=True)
            reference = text_field(data.get("reference"), "收款流水号", 255, required=True)
            operation = FinancialOperation.objects.create(
                workspace=project.workspace,
                project=project,
                project_id_snapshot=project.id,
                kind="cost-recovery",
                request_key=uuid.uuid5(identifier(body["request_key"]), "recovery-cash"),
                fingerprint=hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest(),
                actor=user,
                actor_name=user.display_name,
                reason=body["reason"],
                evidence=evidence,
                payload={
                    "account_id": str(source.id),
                    "amount": money_text(amount),
                    "cost_id": str(cost.object_key),
                    "reference": reference,
                },
                occurred_at=timezone.now(),
            )
            posting(operation, source, amount)
            state, data = (
                "received",
                {
                    "cost_id": str(cost.object_key),
                    "amount": money_text(amount),
                    "user_id": cost.data["user_id"],
                    "user_name": cost.data["user_name"],
                    "work": cost.data["work"],
                    "payment_operation_id": str(operation.id),
                    "evidence": evidence,
                    "reference": reference,
                },
            )
    elif action == "reverse-recovery" and kind == "recovery":
        require_project_finance(user, project, "record")
        if not previous or previous.state != "received":
            raise ValidationError("只能冲正已登记追回")
        evidence = text_field(data.get("evidence"), "冲正凭证", 4000, required=True)
        row = append_record(user, project, body, kind, key, previous, "cancelled", previous.data)
        perform(
            user,
            project.workspace,
            "reverse",
            {
                "request_key": str(uuid.uuid5(identifier(body["request_key"]), "reverse-recovery")),
                "operation_id": previous.data["payment_operation_id"],
                "evidence": evidence,
                "reason": body["reason"],
            },
        )
        return row
    elif action == "review" and kind == "cost":
        require_project_finance(user, project, "approve")
        if not previous or previous.state != "submitted":
            raise ValidationError("只能审核待核准费用")
        state = data.get("result")
        if state not in ("approved", "rejected"):
            raise ValidationError("审核结果无效")
        if state == "approved" and previous.data["category"] == "labor":
            other_hours = sum(
                (
                    Decimal(entry.data["hours"])
                    for entry in rows
                    if entry.kind == "cost"
                    and entry.object_key != previous.object_key
                    and entry.state == "approved"
                    and entry.data["category"] == "labor"
                    and entry.data["user_id"] == previous.data["user_id"]
                    and entry.data["date"] == previous.data["date"]
                ),
                ZERO,
            )
            if other_hours + Decimal(previous.data["hours"]) > 24:
                raise ValidationError("该成员当日已核准工时合计不能超过24小时")
        data = {**previous.data, "review_note": text_field(data.get("note"), "审核意见", 2000, required=True)}
    elif action == "cancel" and kind in ("cost", "payroll"):
        if not previous:
            raise ValidationError("记录不存在")
        if kind == "payroll":
            require_project_finance(user, project, "approve")
            if previous.state != "ready":
                raise ValidationError("只能取消未付工资单")
        elif previous.state not in ("submitted", "rejected") or (
            "record" not in permissions and previous.data["user_id"] != str(user.id)
        ):
            raise PermissionDenied("只能撤回本人待核准费用")
        state, data = "cancelled", previous.data
    elif action in ("pay", "reverse-payment") and kind in ("cost", "payroll"):
        require_project_finance(user, project, "pay")
        if not previous or kind == "cost" and previous.data["category"] == "labor":
            raise ValidationError("劳务费请先生成工资单后登记支付")
        if action == "pay":
            if previous.state != ("ready" if kind == "payroll" else "approved"):
                raise ValidationError("只能支付已核准且未付的记录")
            source = get_object_or_404(
                FinancialAccount,
                id=identifier(data.get("account_id"), "资金账户ID"),
                workspace=project.workspace,
                project_id_snapshot=project.id,
                kind="project",
            )
            amount = Decimal(previous.data["amount"]) if kind == "payroll" else recognized_cost(previous, rows)
            if amount <= ZERO:
                raise ValidationError("应付金额为零")
            evidence = text_field(data.get("evidence"), "支付凭证", 4000, required=True)
            reference = text_field(data.get("reference"), "支付流水号", 255, required=True)
            payment = perform(
                user,
                project.workspace,
                "expense",
                {
                    "request_key": str(uuid.uuid5(identifier(body["request_key"]), "cash-payment")),
                    "account_id": str(source.id),
                    "amount": money_text(amount),
                    "purpose": ("工资" if kind == "payroll" else "报销")
                    + "："
                    + previous.data["user_name"]
                    + "／"
                    + reference,
                    "evidence": evidence,
                    "reason": body["reason"],
                },
            )
            state, data = (
                "paid",
                {
                    **previous.data,
                    "payment_operation_id": payment["operation_id"],
                    "paid_amount": money_text(amount),
                    "payment_reference": reference,
                    "payment_evidence": evidence,
                },
            )
        else:
            if previous.state != "paid":
                raise ValidationError("只能撤销已登记的支付")
            associated = [
                row
                for row in rows
                if row.kind == "cost"
                and (row.object_key == previous.object_key or str(row.object_key) in previous.data.get("cost_ids", []))
            ]
            if any(recovered_cost(cost, rows) > ZERO for cost in associated):
                raise ValidationError("请先冲正关联的追回记录，再冲正原支付")
            evidence = text_field(data.get("evidence"), "冲正凭证", 4000, required=True)
            state = "cancelled" if kind == "payroll" else "approved"
            data = {k: v for k, v in previous.data.items() if not k.startswith("payment_") and k != "paid_amount"}
            row = append_record(user, project, body, kind, key, previous, state, data)
            perform(
                user,
                project.workspace,
                "reverse",
                {
                    "request_key": str(uuid.uuid5(identifier(body["request_key"]), "reverse-cash-payment")),
                    "operation_id": previous.data["payment_operation_id"],
                    "evidence": evidence,
                    "reason": body["reason"],
                },
            )
            return row
    else:
        raise ValidationError("操作无效")
    return append_record(user, project, body, kind, key, previous, state, data)


@transaction.atomic
def finance_mutation(user, project, body):
    lock(f"finance:{project.workspace_id}")
    project = get_object_or_404(Project.objects.select_for_update(of=("self",), no_key=True), id=project.id)
    membership(user, project)
    permissions, _ = project_finance_access(user, project)
    if not isinstance(body, dict):
        raise ValidationError("请求须为对象")
    if body.get("kind") not in FINANCE_KINDS:
        raise ValidationError("财务记录类型无效")
    request_key = identifier(body.get("request_key"), "请求标识")
    text_field(body.get("reason"), "操作说明", 2000, required=True)
    previous_request = ProjectManagementRecord.objects.filter(
        workspace=project.workspace, request_key=request_key
    ).first()
    if previous_request:
        if (
            previous_request.actor_id != user.id
            or previous_request.project_id_snapshot != project.id
            or previous_request.request_snapshot != body
        ):
            raise BudgetConflict("请求标识已被使用")
        if previous_request.kind != "cost" or previous_request.data.get("user_id") != str(user.id):
            require_project_finance(user, project, "view")
        return previous_request
    require_finance_open(project.workspace, project.id)
    if (
        project.archived_at
        and body.get("kind") not in ("audit", "recovery")
        and body.get("action") != "reverse-payment"
    ):
        raise ValidationError("归档项目仅可审计或冲正已有支付")
    row = financial_action(user, project, body, permissions)
    audit("project-management." + row.kind, row, user, project.workspace, state=row.state, version=row.version)
    return row


def finance_overview(user, project):
    membership(user, project)
    permissions, _ = project_finance_access(user, project)
    rows = list(latest_records(project.id).filter(kind__in=FINANCE_KINDS))
    costs = [row for row in rows if row.kind == "cost" and row.state in ("approved", "paid")]
    visible = (
        rows
        if "view" in permissions
        else [row for row in rows if row.kind in ("cost", "payroll") and row.data.get("user_id") == str(user.id)]
    )
    budget = (
        ProjectCostBudget.objects.filter(project_id_snapshot=project.id).order_by("-version").first()
        if "view" in permissions
        else None
    )
    planned = {key: ZERO for key in CATEGORIES}
    if budget:
        for item in budget.items:
            planned[item["category"]] += Decimal(item["amount"])
    cost_data = []
    for row in visible:
        value = record_data(row)
        if row.kind == "cost":
            value["recognized_amount"] = money_text(recognized_cost(row, rows))
            value["recovery_remaining"] = money_text(
                max(ZERO, paid_cost(row, rows)[0] - recognized_cost(row, rows) - recovered_cost(row, rows))
            )
            payroll = payroll_for(row, rows)
            value["payroll_id"] = str(payroll.object_key) if payroll else None
        cost_data.append(value)
    funding = next((row for row in rows if row.kind == "funding"), None)
    result = {
        "project_id": str(project.id),
        "funding_id": str(uuid.uuid5(project.id, "funding")),
        "can_view_finance": "view" in permissions,
        "can_record": "record" in permissions,
        "can_approve": "approve" in permissions,
        "can_pay": "pay" in permissions,
        "closed": bool(project.archived_at) or project.id in finance_removal_state(project.workspace)["projects"],
        "can_audit": "approve" in permissions
        and project.id not in finance_removal_state(project.workspace)["projects"],
        "can_recover": "record" in permissions
        and project.id not in finance_removal_state(project.workspace)["projects"],
        "records": cost_data,
        "members": [
            {"id": str(row.member_id), "name": row.member.display_name}
            for row in members(project)
            if "record" in permissions or "approve" in permissions or row.member_id == user.id
        ],
        "user_id": str(user.id),
        "accounts": [],
        "summary": None,
        "categories": [],
    }
    if "view" not in permissions:
        return result
    paid = [row for row in rows if row.kind in ("cost", "payroll") and row.state == "paid"]
    total = sum((recognized_cost(row, rows) for row in costs), ZERO)
    actual_budget = Decimal(funding.data["budget_amount"]) if funding else (budget.total if budget else ZERO)
    recovery = sum(
        (max(ZERO, paid_cost(row, rows)[0] - recognized_cost(row, rows) - recovered_cost(row, rows)) for row in costs),
        ZERO,
    )
    result["summary"] = {
        "funding": funding.data["funding_amount"] if funding else "0.00",
        "budget": money_text(actual_budget),
        "cost": money_text(total),
        "remaining": money_text(actual_budget - total),
        "paid": money_text(sum((Decimal(row.data["paid_amount"]) for row in paid), ZERO)),
        "recovery": money_text(recovery),
        "recovered": money_text(
            sum(
                (Decimal(row.data["amount"]) for row in rows if row.kind == "recovery" and row.state == "received"),
                ZERO,
            )
        ),
        "received": money_text(
            sum(
                (
                    batch.gross
                    for batch in CashBatch.objects.filter(
                        operation__workspace=project.workspace,
                        operation__project_id_snapshot=project.id,
                        operation__reversal__isnull=True,
                    )
                ),
                ZERO,
            )
        ),
    }
    for key, label in CATEGORIES.items():
        actual = sum((recognized_cost(row, rows) for row in costs if row.data["category"] == key), ZERO)
        result["categories"].append(
            {
                "category": key,
                "label": label,
                "budget": money_text(planned[key]),
                "cost": money_text(actual),
                "remaining": money_text(planned[key] - actual),
            }
        )
    if "pay" in permissions:
        result["accounts"] = [
            {"id": str(row.id), "label": "项目资金", "available": money_text(available(row))}
            for row in FinancialAccount.objects.filter(
                workspace=project.workspace, project_id_snapshot=project.id, kind="project"
            )
        ]
    return result


class ProjectFinanceManagementView(LabView):
    def get(self, request, slug, pk):
        project = get_object_or_404(Project, workspace=self.workspace, id=pk)
        result = finance_overview(request.user, project)
        history = request.query_params.get("record_id")
        if history:
            key = identifier(history)
            if not any(row["id"] == str(key) for row in result["records"]):
                raise PermissionDenied("无此记录查看权限")
            result["history"] = [
                record_data(row)
                for row in ProjectManagementRecord.objects.filter(
                    workspace=self.workspace, project_id_snapshot=pk, object_key=key
                ).order_by("-version")
            ]
        if request.query_params.get("format") == "csv":
            output = StringIO()
            output.write("\ufeff")
            writer = csv.writer(output)
            writer.writerow(
                [
                    "类型",
                    "版本",
                    "状态",
                    "成员",
                    "日期",
                    "事项",
                    "金额（元）",
                    "认定金额（元）",
                    "审计差额（元）",
                    "工时",
                    "单价（元）",
                    "核定预算（元）",
                    "调整前认定金额（元）",
                    "依据",
                    "登记人",
                ]
            )
            kinds = {
                "funding": "经费核定",
                "cost": "执行成本",
                "payroll": "工资单",
                "audit": "审计调整",
                "recovery": "审计追回",
            }
            states = {
                "submitted": "待核准",
                "approved": "已通过",
                "rejected": "需修改",
                "paid": "已支付",
                "ready": "待支付",
                "cancelled": "已撤回",
                "confirmed": "已核定",
                "closed": "已调整",
                "received": "已追回",
            }
            for row in result["records"]:
                data = row["data"]
                text = [
                    kinds[row["kind"]],
                    row["version"],
                    states[row["state"]],
                    data.get("user_name", ""),
                    data.get("date", data.get("start", "")),
                    data.get("work", data.get("finding", "")),
                ]
                numbers = [
                    data.get("amount", data.get("funding_amount", "")),
                    row.get("recognized_amount", data.get("allowed_amount", "")),
                    data.get("adjustment", ""),
                    data.get("hours", ""),
                    data.get("rate", ""),
                    data.get("budget_amount", ""),
                    data.get("original_amount", ""),
                ]
                writer.writerow(
                    [csv_cell(str(value)) for value in text]
                    + numbers
                    + [csv_cell(data.get("evidence", data.get("basis", ""))), csv_cell(row["actor"])]
                )
            response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = 'attachment; filename="project-finance-report.csv"'
            return response
        return Response(result)

    def post(self, request, slug, pk):
        project = get_object_or_404(Project, workspace=self.workspace, id=pk)
        return Response(record_data(finance_mutation(request.user, project, request.data)), status=201)
