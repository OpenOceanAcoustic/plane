# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Authoritative, preview-first finish-to-start scheduling of canonical issues."""

import hashlib
import json
from collections import deque
from datetime import date, timedelta
from django.core import signing
from django.db import connection, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from plane.db.models import Issue, IssueRelation, IssueActivity
from .auth import audit, lock
from .fields import project_access
from .permissions import issue_access, readable_issues
from .planning_views import LabView

TOKEN_SALT = "lab.gantt.preview.v1"


class StalePreview(APIException):
    status_code = 409
    default_detail = "任务或依赖已变化，请重新预览后确认"


def graph_lock(workspace_id):
    lock(f"lab-gantt-graph:{workspace_id}")


def assert_acyclic(edges):
    successors, degree = {}, {}
    for predecessor, successor in set(edges):
        if predecessor == successor:
            raise ValidationError("任务不能依赖自身")
        successors.setdefault(predecessor, set()).add(successor)
        degree.setdefault(predecessor, 0)
        degree[successor] = degree.get(successor, 0) + 1
    pending = deque(node for node, count in degree.items() if count == 0)
    order = []
    while pending:
        node = pending.popleft()
        order.append(node)
        for successor in successors.get(node, ()):
            degree[successor] -= 1
            if degree[successor] == 0:
                pending.append(successor)
    if len(order) != len(degree):
        raise ValidationError("任务依赖存在循环，请先修正依赖")
    return order


def validate_native_dependencies(workspace_id, additions):
    """Shared by the native relations API; caller owns graph lock/transaction."""
    existing = IssueRelation.objects.filter(workspace_id=workspace_id, relation_type="blocked_by").values_list(
        "related_issue_id", "issue_id"
    )
    assert_acyclic(list(existing) + additions)


def snapshot(project, for_update=False):
    rows = Issue.objects.filter(project=project).select_related("project", "state").order_by("id")
    if for_update:
        rows = rows.select_for_update(of=("self",))
    rows = list(rows)
    relations = list(
        IssueRelation.objects.filter(workspace_id=project.workspace_id, relation_type="blocked_by")
        .filter(Q(issue__project=project) | Q(related_issue__project=project))
        .values_list("id", "related_issue_id", "issue_id")
    )
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "project": [str(project.id), str(project.archived_at)],
                "tasks": [
                    [
                        str(r.id),
                        str(r.start_date),
                        str(r.target_date),
                        str(r.updated_at),
                        str(r.archived_at),
                        r.is_draft,
                    ]
                    for r in rows
                ],
                "relations": sorted([[str(v) for v in row] for row in relations]),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {str(row.id): row for row in rows}, [(str(p), str(s)) for _, p, s in relations], fingerprint


def parse_day(value):
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise ValidationError("日期格式应为 YYYY-MM-DD")


def calculate(user, workspace, rows, edges, request):
    issue_id = str(request.get("issue_id", ""))
    issue = issue_access(user, workspace, issue_id, edit=True)
    if str(issue.id) not in rows or issue.project.archived_at:
        raise ValidationError("只能修改当前项目未归档任务")
    start, end = parse_day(request.get("start_date")), parse_day(request.get("target_date"))
    if end < start:
        raise ValidationError("截止日期不能早于开始日期")
    order = assert_acyclic(edges)
    successors, predecessors = {}, {}
    for p, s in edges:
        successors.setdefault(p, set()).add(s)
        predecessors.setdefault(s, set()).add(p)
    affected, queue = {issue_id}, deque([issue_id])
    while queue:
        for successor in successors.get(queue.popleft(), ()):
            if successor not in affected:
                affected.add(successor)
                queue.append(successor)
    required = affected | {p for s in affected for p in predecessors.get(s, ())}
    if not required <= set(rows):
        raise ValidationError("此操作涉及项目外依赖，请先在任务关系中处理后重试")
    for node in required:
        # Check access before exposing any affected task metadata.
        issue_access(user, workspace, node, edit=node in affected)
        row = rows[node]
        if node != issue_id and (row.start_date is None or row.target_date is None):
            raise ValidationError("关联任务缺少开始或截止日期，请补齐排期后重试")
        if row.archived_at or row.is_draft:
            raise ValidationError("关联任务已归档或尚为草稿，不能进行日期联动")
    dates = {node: (r.start_date, r.target_date) for node, r in rows.items()}
    dates[issue_id] = (start, end)
    ordered = [n for n in order if n in affected]
    if issue_id not in ordered:
        ordered.insert(0, issue_id)
    for node in ordered:
        pdates = [dates[p][1] for p in predecessors.get(node, ())]
        if not pdates:
            continue
        earliest = max(pdates) + timedelta(days=1)
        current_start, current_end = dates[node]
        if current_start < earliest:
            if node == issue_id:
                raise ValidationError("开始日期必须晚于所有前置任务的截止日期")
            duration = current_end - current_start
            dates[node] = (earliest, earliest + duration)
    changes = []
    for node in ordered:
        row = rows[node]
        new_start, new_end = dates[node]
        if (row.start_date, row.target_date) != (new_start, new_end):
            changes.append(
                {
                    "id": node,
                    "title": row.name,
                    "key": f"{row.project.identifier}-{row.sequence_id}",
                    "old_start_date": row.start_date.isoformat() if row.start_date else None,
                    "old_target_date": row.target_date.isoformat() if row.target_date else None,
                    "start_date": new_start.isoformat(),
                    "target_date": new_end.isoformat(),
                }
            )
    if not changes:
        raise ValidationError("日期没有变化")
    return changes


class GanttView(LabView):
    def get(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        rows = (
            readable_issues(request.user, self.workspace)
            .filter(project=project, is_draft=False, archived_at__isnull=True)
            .select_related("state")
            .order_by("sort_order", "sequence_id")
        )
        if project.archived_at:
            rows = rows.none()
        rows = list(rows)
        visible = {str(r.id) for r in rows}
        edges = IssueRelation.objects.filter(workspace=self.workspace, relation_type="blocked_by").filter(
            Q(issue_id__in=visible) | Q(related_issue_id__in=visible)
        )
        relations, external = [], set()
        for edge in edges:
            p, s = str(edge.related_issue_id), str(edge.issue_id)
            if p in visible and s in visible:
                relations.append({"id": str(edge.id), "predecessor_id": p, "successor_id": s})
            else:
                external.add(p if p in visible else s)
        return Response(
            {
                "tasks": [
                    {
                        "id": str(r.id),
                        "title": r.name,
                        "key": f"{project.identifier}-{r.sequence_id}",
                        "project_id": str(project.id),
                        "start_date": r.start_date,
                        "target_date": r.target_date,
                        "state": r.state.name if r.state else "",
                        "state_group": r.state.group if r.state else "",
                        "external_dependency": str(r.id) in external,
                    }
                    for r in rows
                ],
                "dependencies": relations,
            }
        )


class GanttPreviewView(LabView):
    def post(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        with transaction.atomic():
            graph_lock(self.workspace.id)
            rows, edges, fingerprint = snapshot(project)
            changes = calculate(request.user, self.workspace, rows, edges, request.data)
            intent = {k: request.data.get(k) for k in ("issue_id", "start_date", "target_date")}
            token = signing.dumps(
                {
                    "user": str(request.user.id),
                    "workspace": str(self.workspace.id),
                    "project": str(project.id),
                    "fingerprint": fingerprint,
                    "intent": intent,
                },
                salt=TOKEN_SALT,
            )
        return Response({"changes": changes, "token": token, "expires_in": 300})


class GanttCommitView(LabView):
    def post(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        try:
            data = signing.loads(request.data.get("token", ""), salt=TOKEN_SALT, max_age=300)
        except (signing.BadSignature, TypeError, ValueError):
            raise StalePreview()
        if not isinstance(data, dict) or (data.get("user"), data.get("workspace"), data.get("project")) != (
            str(request.user.id),
            str(self.workspace.id),
            str(project.id),
        ):
            raise StalePreview()
        with transaction.atomic():
            # Match the native statement-trigger lock order before taking issue tuple locks.
            with connection.cursor() as cursor:
                cursor.execute("""DO $$ BEGIN IF to_regprocedure('lab_wip_lock(uuid)') IS NOT NULL THEN
                    PERFORM lab_wip_lock(NULL); END IF; END $$;""")
            graph_lock(self.workspace.id)
            rows, edges, fingerprint = snapshot(project, for_update=True)
            if fingerprint != data.get("fingerprint"):
                raise StalePreview()
            changes = calculate(request.user, self.workspace, rows, edges, data["intent"])
            now = timezone.now()
            for change in changes:
                row = rows[change["id"]]
                for field in ("start_date", "target_date"):
                    if change["old_" + field] != change[field]:
                        IssueActivity.objects.create(
                            workspace=self.workspace,
                            project=project,
                            issue=row,
                            actor=request.user,
                            verb="updated",
                            field=field,
                            old_value=change["old_" + field],
                            new_value=change[field],
                        )
                # Dates only: preserve task state, WIP, descriptions and native scheduling-independent calendars.
                Issue.objects.filter(pk=row.id).update(
                    start_date=change["start_date"],
                    target_date=change["target_date"],
                    updated_at=now,
                    updated_by=request.user,
                )
            audit("gantt.dates.commit", project, request.user, self.workspace, changes=changes)
        return Response({"changes": changes})


class GanttDependenciesView(LabView):
    def post(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        with transaction.atomic():
            graph_lock(self.workspace.id)
            predecessor = issue_access(request.user, self.workspace, request.data.get("predecessor_id"), edit=True)
            successor = issue_access(request.user, self.workspace, request.data.get("successor_id"), edit=True)
            if predecessor.project_id != project.id or successor.project_id != project.id or project.archived_at:
                raise ValidationError("依赖仅限当前项目未归档任务")
            validate_native_dependencies(self.workspace.id, [(predecessor.id, successor.id)])
            existing = IssueRelation.objects.filter(issue=successor, related_issue=predecessor).first()
            if existing and existing.relation_type != "blocked_by":
                raise ValidationError("这两个任务已经存在其他关系，请先移除原关系")
            edge, _ = IssueRelation.objects.get_or_create(
                issue=successor,
                related_issue=predecessor,
                defaults={
                    "workspace": self.workspace,
                    "project": project,
                    "relation_type": "blocked_by",
                    "created_by": request.user,
                    "updated_by": request.user,
                },
            )
            audit("gantt.dependency.create", edge, request.user, self.workspace)
        return Response({"id": str(edge.id)}, status=201)

    def delete(self, request, slug, project_id):
        project = project_access(request.user, self.workspace, project_id)
        with transaction.atomic():
            graph_lock(self.workspace.id)
            edge = get_object_or_404(
                IssueRelation,
                id=request.data.get("id"),
                workspace=self.workspace,
                relation_type="blocked_by",
                issue__project=project,
                related_issue__project=project,
            )
            issue_access(request.user, self.workspace, edge.issue_id, edit=True)
            issue_access(request.user, self.workspace, edge.related_issue_id, edit=True)
            audit("gantt.dependency.delete", edge, request.user, self.workspace)
            edge.delete()
        return Response(status=204)
