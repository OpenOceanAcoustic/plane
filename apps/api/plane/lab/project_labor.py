# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Project labor teams and atomic, idempotent multi-member worklog entry."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project
from .auth import audit, lock
from .finance_permissions import require_project_finance, project_finance_access
from .finance_services import require_finance_open
from .management_models import ProjectManagementRecord, latest_records
from .planning_views import LabView
from .project_budgets import BudgetConflict, text_field
from .project_management import (
    append_record,
    employee,
    finance_mutation,
    get_previous,
    identifier,
    membership,
    money_text,
    record_data,
)


def labor_teams(project, user):
    permissions, _ = project_finance_access(user, project)
    if "record" not in permissions and "approve" not in permissions:
        return []
    return [record_data(row) for row in latest_records(project.id).filter(kind="team")]


def previous_request(user, project, body):
    old = ProjectManagementRecord.objects.filter(
        workspace=project.workspace, request_key=identifier(body.get("request_key"), "请求标识")
    ).first()
    if old and (old.actor_id != user.id or old.project_id_snapshot != project.id or old.request_snapshot != body):
        raise BudgetConflict("请求标识已被使用")
    return old


class ProjectLaborTeamsView(LabView):
    def get(self, request, slug, pk):
        project = get_object_or_404(Project, workspace=self.workspace, id=pk)
        membership(request.user, project)
        return Response({"teams": labor_teams(project, request.user)})

    @transaction.atomic
    def post(self, request, slug, pk):
        lock(f"finance:{self.workspace.id}")
        project = get_object_or_404(
            Project.objects.select_for_update(of=("self",), no_key=True), workspace=self.workspace, id=pk
        )
        membership(request.user, project)
        require_project_finance(request.user, project, "record")
        body = request.data
        if not isinstance(body, dict):
            raise ValidationError("请求须为对象")
        old = previous_request(request.user, project, body)
        if old:
            if old.kind != "team":
                raise BudgetConflict("请求标识已被使用")
            return Response(record_data(old), status=201)
        require_finance_open(self.workspace, project.id)
        if project.archived_at:
            raise ValidationError("归档项目不能修改团队")
        key, previous = get_previous(project, body, "team")
        data = body.get("data", {})
        if not isinstance(data, dict):
            raise ValidationError("团队内容须为对象")
        name = text_field(data.get("name"), "团队名称", 100, required=True)
        ids = data.get("member_ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100:
            raise ValidationError("请选择1至100位团队成员")
        people = [employee(project, value) for value in ids]
        if len({value for value, _ in people}) != len(people):
            raise ValidationError("团队成员不能重复")
        if latest_records(project.id).filter(kind="team", data__name=name).exclude(object_key=key).exists():
            raise ValidationError("项目中已存在同名团队")
        row = append_record(
            request.user,
            project,
            body,
            "team",
            key,
            previous,
            "active",
            {
                "name": name,
                "member_ids": [value for value, _ in people],
                "members": [{"id": value, "name": label} for value, label in people],
            },
        )
        audit("labor-team.save", row, request.user, self.workspace, version=row.version)
        return Response(record_data(row), status=201)


def batch_response(row):
    versions = {
        str(entry.id): entry for entry in ProjectManagementRecord.objects.filter(id__in=row.data["version_ids"])
    }
    return {"records": [record_data(versions[value]) for value in row.data["version_ids"]], "total": row.data["amount"]}


@transaction.atomic
def labor_batch(user, project, body):
    lock(f"finance:{project.workspace_id}")
    project = get_object_or_404(Project.objects.select_for_update(of=("self",), no_key=True), id=project.id)
    membership(user, project)
    old = previous_request(user, project, body)
    if old:
        if old.kind != "labor-batch":
            raise BudgetConflict("请求标识已被使用")
        permissions, _ = project_finance_access(user, project)
        if "record" not in permissions and any(value != str(user.id) for value in old.data["member_ids"]):
            raise PermissionDenied("无批量工时登记权限")
        return batch_response(old)
    data = body.get("data", {})
    if not isinstance(data, dict) or data.get("category") != "labor":
        raise ValidationError("批量登记仅支持劳务费")
    lines = data.get("lines")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 100 or not all(isinstance(line, dict) for line in lines):
        raise ValidationError("请填写1至100行成员工时")
    ids = [str(identifier(line.get("user_id"), "成员ID")) for line in lines]
    if len(set(ids)) != len(ids):
        raise ValidationError("同批成员不能重复")
    batch_key, previous = get_previous(project, body, "labor-batch")
    if previous:
        raise ValidationError("批量登记须创建新记录")
    team_name = ""
    if data.get("team_id"):
        team = get_object_or_404(latest_records(project.id).filter(kind="team"), object_key=identifier(data["team_id"]))
        if not set(ids) <= set(team.data["member_ids"]):
            raise ValidationError("所选成员不属于该团队，请刷新团队")
        team_name = team.data["name"]
    rows = []
    for line, user_id in zip(lines, ids):
        child = {
            "kind": "cost",
            "action": "save",
            "record_id": str(uuid.uuid5(batch_key, user_id)),
            "expected_version": 0,
            "request_key": str(uuid.uuid5(identifier(body["request_key"]), user_id)),
            "reason": body.get("reason", ""),
            "data": {**data, **line, "user_id": user_id, "team_name": team_name},
        }
        child["data"].pop("lines", None)
        rows.append(finance_mutation(user, project, child))
    row = append_record(
        user,
        project,
        body,
        "labor-batch",
        batch_key,
        None,
        "submitted",
        {
            "version_ids": [str(entry.id) for entry in rows],
            "member_ids": ids,
            "amount": money_text(sum((Decimal(entry.data["amount"]) for entry in rows), Decimal("0"))),
        },
    )
    return batch_response(row)
