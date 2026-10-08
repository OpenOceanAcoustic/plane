# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import csv
import math
from datetime import date
from io import StringIO
from uuid import UUID
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from plane.db.models import Project, ProjectMember, IssueActivity
from .auth import audit, lock
from .export import csv_cell
from .field_models import FieldDefinition, ProjectField, IssueFieldValue
from .permissions import issue_access, project_ids, readable_issues, require_lead
from .planning_views import LabView

KINDS = {"text", "number", "single_select", "multi_select", "date", "member", "boolean", "url"}


def field_data(field, enabled=True):
    return {
        "id": str(field.id),
        "name": field.name,
        "kind": field.kind,
        "options": field.options,
        "archived": field.archived,
        "enabled": enabled,
    }


def admin(view):
    if view.membership.role != 20:
        raise PermissionDenied("仅工作区管理员可以定义字段")


def project_access(user, workspace, pk):
    return get_object_or_404(Project, workspace=workspace, id=pk, id__in=project_ids(user, workspace))


def clean_definition(data, instance=None):
    name = data.get("name", instance.name if instance else "")
    kind = data.get("kind", instance.kind if instance else "")
    options = data.get("options", instance.options if instance else [])
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80 or kind not in KINDS:
        raise ValidationError("请填写字段名称及有效类型")
    if (
        not isinstance(options, list)
        or len(options) > 100
        or any(not isinstance(option, str) or not option.strip() or len(option) > 80 for option in options)
        or len(set(options)) != len(options)
    ):
        raise ValidationError("选项必须为不重复的非空文本，最多 100 项")
    if "select" in kind and not options:
        raise ValidationError("选择字段至少需要一个选项")
    if "select" not in kind and options:
        raise ValidationError("此字段类型不支持选项")
    if instance and kind != instance.kind:
        raise ValidationError("字段类型不能更改；请新建字段并停用旧字段")
    if instance and set(instance.options) - set(options) and IssueFieldValue.objects.filter(field=instance).exists():
        raise ValidationError("已有历史值的选项不能删除，可以停用字段")
    return name.strip(), kind, options


def clean_value(field, value, project):
    if value is None:
        return None
    kind = field.kind
    valid = False
    if kind == "text":
        valid = isinstance(value, str) and len(value) <= 10000
    elif kind == "number":
        valid = type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e15
    elif kind == "single_select":
        valid = isinstance(value, str) and value in field.options
    elif kind == "multi_select":
        valid = isinstance(value, list) and all(isinstance(v, str) and v in field.options for v in value)
        valid = valid and len(value) == len(set(value))
    elif kind == "date":
        try:
            valid = isinstance(value, str) and date.fromisoformat(value).isoformat() == value
        except ValueError:
            valid = False
    elif kind == "member":
        try:
            value = str(UUID(str(value)))
            valid = ProjectMember.objects.filter(
                project=project, member_id=value, is_active=True, member__is_active=True
            ).exists()
        except (ValueError, TypeError):
            valid = False
    elif kind == "boolean":
        valid = type(value) is bool
    elif kind == "url":
        try:
            if isinstance(value, str) and len(value) <= 2048:
                URLValidator(schemes=["http", "https"])(value)
                valid = True
        except DjangoValidationError:
            valid = False
    if not valid:
        raise ValidationError({str(field.id): "字段值类型或选项无效"})
    return value


class FieldDefinitionsView(LabView):
    def get(self, request, slug):
        return Response(
            {
                "fields": [field_data(row) for row in FieldDefinition.objects.filter(workspace=self.workspace)],
                "can_manage": self.membership.role == 20,
            }
        )

    def post(self, request, slug):
        admin(self)
        name, kind, options = clean_definition(request.data)
        field = FieldDefinition.objects.create(workspace=self.workspace, name=name, kind=kind, options=options)
        audit("field.create", field, request.user, self.workspace, name=name, kind=kind)
        return Response(field_data(field), status=201)


class FieldDefinitionView(LabView):
    def patch(self, request, slug, pk):
        admin(self)
        with transaction.atomic():
            lock(f"lab-fields:{self.workspace.id}")
            field = get_object_or_404(FieldDefinition, workspace=self.workspace, id=pk)
            field.name, field.kind, field.options = clean_definition(request.data, field)
            if "archived" in request.data:
                if type(request.data["archived"]) is not bool:
                    raise ValidationError("停用状态必须为布尔值")
                field.archived = request.data["archived"]
            field.save()
            audit("field.update", field, request.user, self.workspace, archived=field.archived)
        return Response(field_data(field))

    def delete(self, request, slug, pk):
        admin(self)
        with transaction.atomic():
            lock(f"lab-fields:{self.workspace.id}")
            field = get_object_or_404(FieldDefinition, workspace=self.workspace, id=pk)
            field.archived = True
            field.save(update_fields=["archived", "updated_at"])
            audit("field.archive", field, request.user, self.workspace)
        return Response(status=204)


class ProjectFieldsView(LabView):
    def get(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        rows = ProjectField.objects.filter(project=project).select_related("field")
        return Response(
            {
                "fields": [field_data(row.field, row.enabled) for row in rows],
                "can_manage": project.project_lead_id == request.user.id,
                "members": [
                    {"id": str(m.member_id), "name": m.member.display_name}
                    for m in ProjectMember.objects.filter(
                        project=project, is_active=True, member__is_active=True
                    ).select_related("member")
                ],
            }
        )

    def put(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        require_lead(request.user, project)
        ids = request.data.get("ids")
        if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
            raise ValidationError("字段列表无效")
        with transaction.atomic():
            lock(f"lab-fields:{self.workspace.id}")
            fields = list(FieldDefinition.objects.filter(workspace=self.workspace, id__in=ids, archived=False))
            if len(fields) != len(ids):
                raise ValidationError("只能启用当前工作区有效字段")
            ProjectField.objects.filter(project=project).update(enabled=False)
            for field in fields:
                ProjectField.objects.update_or_create(
                    project=project, field=field, defaults={"enabled": True, "position": ids.index(str(field.id))}
                )
            audit("field.project.configure", project, request.user, self.workspace, fields=ids)
        return self.get(request, slug, project_id)


class IssueFieldsView(LabView):
    def get(self, request, slug, issue_id):
        issue = issue_access(request.user, self.workspace, issue_id)
        rows = list(ProjectField.objects.filter(project=issue.project).select_related("field"))
        values = {str(v.field_id): v.value for v in IssueFieldValue.objects.filter(issue=issue)}
        return Response(
            {
                "fields": [field_data(r.field, r.enabled) for r in rows if r.enabled or str(r.field_id) in values],
                "values": values,
            }
        )

    def patch(self, request, slug, issue_id):
        issue = issue_access(request.user, self.workspace, issue_id, edit=True)
        if issue.project.archived_at:
            raise ValidationError("项目已归档，不能修改字段")
        values = request.data.get("values")
        if not isinstance(values, dict) or len(values) > 100:
            raise ValidationError("字段值必须为对象，最多 100 个")
        with transaction.atomic():
            lock(f"lab-fields:{self.workspace.id}")
            issue = issue_access(request.user, self.workspace, issue_id, edit=True)
            fields = {
                str(r.field_id): r.field
                for r in ProjectField.objects.filter(
                    project=issue.project, enabled=True, field__archived=False
                ).select_related("field")
            }
            if not set(values) <= set(fields):
                raise ValidationError("字段未在项目启用或已经停用")
            cleaned = {key: clean_value(fields[key], value, issue.project) for key, value in values.items()}
            for key, value in cleaned.items():
                old = IssueFieldValue.objects.filter(issue=issue, field_id=key).first()
                previous = old.value if old else None
                IssueFieldValue.objects.update_or_create(issue=issue, field_id=key, defaults={"value": value})
                if previous != value:
                    IssueActivity.objects.create(
                        workspace=self.workspace,
                        project=issue.project,
                        issue=issue,
                        actor=request.user,
                        verb="updated",
                        field=f"custom_field:{key}",
                        old_value=str(previous),
                        new_value=str(value),
                    )
            audit("field.values.update", issue, request.user, self.workspace, fields=list(cleaned))
        return self.get(request, slug, issue_id)


class TaskTableView(LabView):
    def get(self, request, slug):
        rows = (
            readable_issues(request.user, self.workspace)
            .filter(is_draft=False, archived_at__isnull=True, project__archived_at__isnull=True)
            .select_related("project", "state")
            .order_by("project__name", "sequence_id")
        )
        project_id = request.query_params.get("project")
        if project_id:
            rows = rows.filter(project_id=project_id)
        tasks = list(rows)
        enabled = set(
            ProjectField.objects.filter(project_id__in={r.project_id for r in tasks}, enabled=True).values_list(
                "field_id", flat=True
            )
        )
        values = {}
        for value in IssueFieldValue.objects.filter(issue_id__in=[r.id for r in tasks]):
            values.setdefault(str(value.issue_id), {})[str(value.field_id)] = value.value
            enabled.add(value.field_id)
        fields = list(FieldDefinition.objects.filter(workspace=self.workspace, id__in=enabled))
        roles = dict(
            ProjectMember.objects.filter(
                project_id__in={r.project_id for r in tasks}, member=request.user, is_active=True
            ).values_list("project_id", "role")
        )
        data = [
            {
                "id": str(r.id),
                "title": r.name,
                "project_id": str(r.project_id),
                "project": r.project.name,
                "key": f"{r.project.identifier}-{r.sequence_id}",
                "state": r.state.name if r.state else "",
                "priority": r.priority,
                "start_date": r.start_date,
                "target_date": r.target_date,
                "editable": roles.get(r.project_id, 0) >= 15
                or r.created_by_id == request.user.id
                or r.project.guest_view_all_features,
                "values": values.get(str(r.id), {}),
            }
            for r in tasks
        ]
        if request.query_params.get("format") == "csv":
            stream = StringIO()
            writer = csv.writer(stream)
            writer.writerow(
                ["编号", "任务", "项目", "状态", "优先级", "开始日期", "截止日期"] + [csv_cell(f.name) for f in fields]
            )
            for row in data:
                writer.writerow(
                    [
                        csv_cell(row[k])
                        for k in ("key", "title", "project", "state", "priority", "start_date", "target_date")
                    ]
                    + [csv_cell(row["values"].get(str(f.id))) for f in fields]
                )
            response = HttpResponse("\ufeff" + stream.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = 'attachment; filename="tasks.csv"'
            return response
        return Response({"tasks": data, "fields": [field_data(f) for f in fields]})
