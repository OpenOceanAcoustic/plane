# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Date-based work-item archiving preserves native identities and all related history."""

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core import signing
from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from plane.db.models import Issue, IssueActivity, ProjectMember
from .auth import audit, lock
from .models import Audit, Bounty
from .permissions import readable_issues

ZONE = ZoneInfo("Asia/Shanghai")
SALT = "plane.lab.issue-archive-preview.v1"
LIMIT = 1000


class ArchiveConflict(APIException):
    status_code = 409
    default_detail = "工作项或权限已变化，请重新预览"


def calendar_date(value):
    try:
        result = date.fromisoformat(value)
        if result.isoformat() != value:
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise ValidationError("日期须为 YYYY-MM-DD") from None


def completion_date(issue):
    return issue.completed_at.astimezone(ZONE).date().isoformat() if issue.completed_at else None


def filter_dates(rows, params):
    for field in ("completed", "archived"):
        lower = calendar_date(params[f"{field}_from"]) if params.get(f"{field}_from") else None
        upper = calendar_date(params[f"{field}_to"]) if params.get(f"{field}_to") else None
        if lower and upper and lower > upper:
            raise ValidationError("开始日期不能晚于结束日期")
        if field == "archived":
            if lower:
                rows = rows.filter(archived_at__gte=lower)
            if upper:
                rows = rows.filter(archived_at__lte=upper)
        else:
            if lower:
                rows = rows.filter(completed_at__gte=datetime.combine(lower, time.min, ZONE))
            if upper:
                if upper == date.max:
                    raise ValidationError("结束日期超出范围")
                rows = rows.filter(completed_at__lt=datetime.combine(upper + timedelta(days=1), time.min, ZONE))
    return rows


def manageable_projects(user, workspace):
    return ProjectMember.objects.filter(
        workspace=workspace,
        member=user,
        member__is_active=True,
        is_active=True,
        role__gte=15,
        project__archived_at__isnull=True,
        project__deleted_at__isnull=True,
    ).values_list("project_id", flat=True)


def open_bounties():
    return (
        Bounty.objects.filter(issue_id__isnull=False)
        .exclude(status__in=("done", "cancelled", "deleted"))
        .values("issue_id")
    )


def revision(issue):
    return [str(issue.id), issue.updated_at.isoformat(), str(issue.state_id), issue.completed_at.isoformat()]


def preview(user, workspace, data):
    cutoff = calendar_date(data.get("cutoff"))
    if cutoff > timezone.localdate(timezone=ZONE):
        raise ValidationError("截止日期不能晚于今天")
    rows = readable_issues(user, workspace).filter(
        project_id__in=manageable_projects(user, workspace),
        is_draft=False,
        archived_at__isnull=True,
        state__group="completed",
        completed_at__isnull=False,
    )
    if data.get("project_id"):
        rows = rows.filter(project_id=data["project_id"])
    rows = list(
        filter_dates(rows, {"completed_to": cutoff.isoformat()})
        .exclude(id__in=open_bounties())
        .select_related("project", "state")
        .order_by("completed_at", "id")[: LIMIT + 1]
    )
    if len(rows) > LIMIT:
        raise ValidationError("一次最多归档 1000 项，请选择项目或更早的截止日期")
    payload = {
        "user": str(user.id),
        "workspace": str(workspace.id),
        "batch": str(uuid.uuid4()),
        "cutoff": cutoff.isoformat(),
        "items": [revision(row) for row in rows],
    }
    return {
        "cutoff": cutoff.isoformat(),
        "total": len(rows),
        "preview_token": signing.dumps(payload, salt=SALT, compress=True) if rows else None,
        "tasks": [
            {
                "id": str(row.id),
                "title": row.name,
                "key": f"{row.project.identifier}-{row.sequence_id}",
                "project": row.project.name,
                "completed_date": completion_date(row),
            }
            for row in rows
        ],
    }


def lock_archive(workspace):
    # Share publication/acceptance/deletion ordering before taking native tuple locks.
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])


def record(issue, user, workspace, old_date, new_date, **details):
    IssueActivity.objects.create(
        workspace=workspace,
        project=issue.project,
        issue=issue,
        actor=user,
        verb="updated",
        field="archived_at",
        old_value=old_date.isoformat() if old_date else "",
        new_value=new_date.isoformat() if new_date else "",
    )
    audit(
        "issue.archived" if new_date else "issue.restored",
        issue,
        user,
        workspace,
        project_id=str(issue.project_id),
        archived_at=new_date.isoformat() if new_date else None,
        previous_archived_at=old_date.isoformat() if old_date else None,
        **details,
    )


@transaction.atomic
def archive(user, workspace, token):
    if not isinstance(token, str) or len(token) > 500000:
        raise ValidationError("请先预览待归档工作项")
    try:
        payload = signing.loads(token, salt=SALT, max_age=900)
    except signing.BadSignature:
        raise ArchiveConflict("归档预览已失效，请重新预览") from None
    if payload["user"] != str(user.id) or payload["workspace"] != str(workspace.id):
        raise PermissionDenied("归档预览不属于当前用户或工作区")
    lock_archive(workspace)
    rows = list(
        readable_issues(user, workspace)
        .filter(id__in=[item[0] for item in payload["items"]], project_id__in=manageable_projects(user, workspace))
        .select_for_update(of=("self",))
        .select_related("project", "state")
        .order_by("completed_at", "id")
    )
    if len(rows) != len(payload["items"]):
        raise ArchiveConflict()
    previous = Audit.objects.filter(
        workspace_id_snapshot=workspace.id,
        actor=user,
        action="issue.archive_batch",
        details__batch_id=payload["batch"],
    ).first()
    if previous:
        return {"archived": previous.details["count"], "replayed": True}
    if any(
        row.archived_at or row.is_draft or not row.state or row.state.group != "completed" or not row.completed_at
        for row in rows
    ):
        raise ArchiveConflict()
    if [revision(row) for row in rows] != payload["items"] or Bounty.objects.filter(
        issue_id__in=[row.id for row in rows]
    ).exclude(status__in=("done", "cancelled", "deleted")).exists():
        raise ArchiveConflict()
    now = timezone.now()
    archived_date = now.astimezone(ZONE).date()
    Issue.objects.filter(id__in=[row.id for row in rows]).update(
        archived_at=archived_date, updated_by=user, updated_at=now
    )
    for row in rows:
        record(row, user, workspace, None, archived_date, cutoff=payload["cutoff"], batch_id=payload["batch"])
    audit(
        "issue.archive_batch",
        rows[0],
        user,
        workspace,
        batch_id=payload["batch"],
        cutoff=payload["cutoff"],
        count=len(rows),
    )
    return {"archived": len(rows), "replayed": False}


@transaction.atomic
def restore(user, workspace, issue_id, expected_revision):
    lock_archive(workspace)
    row = get_object_or_404(
        readable_issues(user, workspace)
        .filter(project_id__in=manageable_projects(user, workspace))
        .select_for_update(of=("self",))
        .select_related("project"),
        id=issue_id,
        is_draft=False,
    )
    if not row.archived_at:
        return {"restored": False}
    if row.updated_at.isoformat() != expected_revision:
        raise ArchiveConflict("工作项已变化，请刷新归档记录后重试")
    old_date = row.archived_at
    Issue.objects.filter(id=row.id).update(archived_at=None, updated_by=user, updated_at=timezone.now())
    record(row, user, workspace, old_date, None)
    return {"restored": True}
