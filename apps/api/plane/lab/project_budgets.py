# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Versioned project cost estimates, independent of cash and VC accounts."""

import csv
import re
import uuid
from decimal import Decimal
from io import StringIO

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from plane.db.models import Project
from .auth import audit, lock
from .export import csv_cell
from .finance_models import ProjectCostBudget
from .finance_permissions import project_finance_access, require_project_finance
from .finance_services import finance_removal_state
from .planning_views import LabView

CATEGORIES = {
    "labor": "劳务费",
    "travel": "差旅费",
    "outsourcing": "外协费",
    "equipment": "设备费",
    "other": "其他费用",
}
MAX_AMOUNT = Decimal("999999999999.99")


class BudgetConflict(APIException):
    status_code = 409
    default_detail = "预算已有新版本，请刷新后重新编辑"


def text_field(value, label, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or required and not value.strip():
        raise ValidationError(f"{label}须为{'非空' if required else ''}文本，最多{limit}字")
    return value.strip()


def normalize_budget(data):
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValidationError("请填写1至100条预算明细")
    normalized, total = [], Decimal("0.00")
    for item in items:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("category"), str)
            or item["category"] not in CATEGORIES
        ):
            raise ValidationError("费用类别无效")
        raw = item.get("amount")
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", raw):
            raise ValidationError("预算金额须为非负数，最多12位整数及2位小数")
        amount = Decimal(raw)
        total += amount
        calculation = {}
        if "quantity" in item:
            quantity, price = item.get("quantity"), item.get("unit_price")
            if any(not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", value) for value in (quantity, price)):
                raise ValidationError("预算数量和单价须为非负数，最多12位整数及2位小数")
            computed = (Decimal(quantity) * Decimal(price)).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")
            if computed != amount:
                raise ValidationError("预算金额与数量乘单价不一致")
            calculation = {"quantity": quantity, "unit_price": price, "unit": text_field(item.get("unit", ""), "计价单位", 20, required=True)}
        normalized.append(
            {
                "category": item["category"],
                "name": text_field(item.get("name", ""), "费用项目", 120, required=True),
                "amount": f"{amount:.2f}",
                "note": text_field(item.get("note", ""), "测算依据", 1000),
                **calculation,
            }
        )
    if total > MAX_AMOUNT:
        raise ValidationError("预算合计超出金额上限")
    version = data.get("expected_version")
    if type(version) is not int or version < 0:
        raise ValidationError("预算版本无效")
    return {
        "items": normalized,
        "reason": text_field(data.get("reason"), "编制／调整说明", 2000, required=True),
        "expected_version": version,
    }, total


def budget_data(row):
    subtotals = {key: Decimal("0.00") for key in CATEGORIES}
    for item in row.items:
        subtotals[item["category"]] += Decimal(item["amount"])
    return {
        "id": str(row.id),
        "project_id": str(row.project_id_snapshot),
        "version": row.version,
        "items": row.items,
        "total": f"{row.total:.2f}",
        "subtotals": {key: f"{value:.2f}" for key, value in subtotals.items()},
        "reason": row.reason,
        "actor": row.actor_name,
        "created_at": row.created_at.isoformat(),
    }


@transaction.atomic
def save_budget(user, project, data):
    lock(f"finance:{project.workspace_id}")
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=project.id, workspace_id=project.workspace_id
    )
    require_project_finance(user, project, "record")
    if not isinstance(data, dict):
        raise ValidationError("预算内容须为对象")
    if project.id in finance_removal_state(project.workspace)["projects"] or project.archived_at:
        raise ValidationError("已删除资金项目或已归档项目不能编制预算")
    try:
        key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("请求标识无效")
    snapshot, total = normalize_budget(data)
    existing = ProjectCostBudget.objects.filter(workspace=project.workspace, request_key=key).first()
    if existing:
        if (
            existing.project_id_snapshot != project.id
            or existing.request_snapshot != snapshot
            or existing.actor_id != user.id
        ):
            raise BudgetConflict("请求标识已用于其他预算，请刷新后重试")
        return existing
    latest = (
        ProjectCostBudget.objects.filter(workspace=project.workspace, project_id_snapshot=project.id)
        .order_by("-version")
        .first()
    )
    version = latest.version if latest else 0
    if version != snapshot["expected_version"]:
        raise BudgetConflict()
    row = ProjectCostBudget.objects.create(
        workspace=project.workspace,
        project=project,
        project_id_snapshot=project.id,
        version=version + 1,
        items=snapshot["items"],
        total=total,
        reason=snapshot["reason"],
        actor=user,
        actor_name=user.display_name,
        request_key=key,
        request_snapshot=snapshot,
    )
    audit("finance.project-budget", row, user, project.workspace, version=row.version, total=f"{total:.2f}")
    return row


def budget_csv(row, project):
    output = StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(
        ["项目", "版本", "费用类别", "费用项目", "预算金额（元）", "测算依据", "编制人", "编制时间", "编制／调整说明", "数量", "单位", "单价（元）"]
    )
    for item in row.items:
        writer.writerow(
            [
                csv_cell(project.name),
                row.version,
                CATEGORIES[item["category"]],
                csv_cell(item["name"]),
                item["amount"],
                csv_cell(item["note"]),
                csv_cell(row.actor_name),
                row.created_at.isoformat(),
                csv_cell(row.reason),
                item.get("quantity", ""),
                csv_cell(item.get("unit", "")),
                item.get("unit_price", ""),
            ]
        )
    writer.writerow(["合计", "", "", "", f"{row.total:.2f}"])
    response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="project-budget-v{row.version}.csv"'
    return response


class ProjectCostBudgetView(LabView):
    def get(self, request, slug, pk):
        project = get_object_or_404(Project, id=pk, workspace=self.workspace)
        require_project_finance(request.user, project, "view")
        versions = ProjectCostBudget.objects.filter(workspace=self.workspace, project_id_snapshot=pk).order_by(
            "-version"
        )
        if request.query_params.get("format") == "csv":
            requested = request.query_params.get("version")
            if requested is not None and not re.fullmatch(r"[1-9][0-9]{0,8}", requested):
                raise ValidationError("预算版本无效")
            row = get_object_or_404(versions, version=int(requested)) if requested else versions.first()
            if row is None:
                raise ValidationError("尚未编制项目启动预算")
            return budget_csv(row, project)
        return Response(
            {
                "project_id": str(pk),
                "can_edit": "record" in project_finance_access(request.user, project)[0]
                and pk not in finance_removal_state(self.workspace)["projects"]
                and not project.archived_at,
                "versions": [budget_data(row) for row in versions],
            }
        )

    def post(self, request, slug, pk):
        project = get_object_or_404(Project, id=pk, workspace=self.workspace)
        return Response(budget_data(save_budget(request.user, project, request.data)), status=201)
