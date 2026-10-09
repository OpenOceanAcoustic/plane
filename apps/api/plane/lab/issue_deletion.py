# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Delete native work items while retaining contribution and financial history."""

from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.bgtasks.deletion_task import soft_delete_related_objects
from plane.db.models import Issue, ProjectMember, UserRecentVisit, WorkspaceMember
from .auth import audit, lock
from .models import Bounty


def deletable_issue_ids(user, workspace, issues, *, bound_issue_ids=None):
    rows = list(issues)
    membership = WorkspaceMember.objects.filter(
        workspace=workspace, member=user, is_active=True, member__is_active=True
    ).first()
    if not membership:
        return set()
    roles = dict(
        ProjectMember.objects.filter(
            workspace=workspace, project_id__in={row.project_id for row in rows}, member=user, is_active=True
        ).values_list("project_id", "role")
    )
    if bound_issue_ids is None:
        bound_issue_ids = set(
            Bounty.objects.filter(issue_id__in=[row.id for row in rows])
            .exclude(status="deleted")
            .values_list("issue_id", flat=True)
        )
    result = set()
    for row in rows:
        if row.deleted_at or row.project.deleted_at:
            continue
        role = roles.get(row.project_id)
        lead = row.project.project_lead_id == user.id and role is not None and role >= 15
        ordinary = role is not None and (row.created_by_id == user.id or role == 20 or membership.role == 20 or lead)
        allowed = lead if row.id in bound_issue_ids else ordinary
        if allowed:
            result.add(row.id)
    return result


@transaction.atomic
def delete_issue(user, workspace, issue_id, *, project_id=None, reason=""):
    # Publication, acceptance and deletion all serialize before native tuple
    # locks. A newly published bounty cannot appear between cleanup and deletion.
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regprocedure('lab_wip_lock(uuid)')")
        if cursor.fetchone()[0] is not None:
            cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    rows = (
        Issue.all_objects.select_for_update(of=("self",))
        .select_related("project", "state")
        .filter(workspace=workspace)
    )
    if project_id is not None:
        rows = rows.filter(project_id=project_id)
    issue = get_object_or_404(rows, pk=issue_id)
    # An already deleted row is retained for idempotent retries; authorization
    # uses the same original identity, never a planning-reference owner.
    deleted_at = issue.deleted_at
    issue.deleted_at = None
    allowed = issue.id in deletable_issue_ids(user, workspace, [issue])
    issue.deleted_at = deleted_at
    if not allowed:
        raise PermissionDenied("无工作项删除权限；关联悬赏仅项目负责人可删除")
    if issue.deleted_at:
        return issue, False
    # The native worker cascades through child issues without lab callbacks.
    # Historical bounties may have become children after completion, so require
    # their explicit deletion before scheduling that native cascade.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            WITH RECURSIVE descendants AS (
                SELECT id FROM issues WHERE parent_id = %s AND deleted_at IS NULL
                UNION
                SELECT child.id FROM issues child
                JOIN descendants parent ON child.parent_id = parent.id
                WHERE child.deleted_at IS NULL
            )
            SELECT EXISTS (
                SELECT 1 FROM lab_bounty
                WHERE issue_id IN (SELECT id FROM descendants) AND status <> 'deleted'
            )
            """,
            [issue.id],
        )
        if cursor.fetchone()[0]:
            raise ValidationError("子工作项关联悬赏，请先删除关联悬赏工作项")
    bounty = Bounty.objects.filter(issue=issue).exclude(status="deleted").first()
    reason = str(reason or "").strip()
    if bounty:
        if not reason:
            raise ValidationError("请填写删除原因")
        from .bounties import delete

        delete(user, bounty.id, reason)
    issue.deleted_at = timezone.now()
    issue.updated_by = user
    issue.save(update_fields=["deleted_at", "updated_by", "updated_at"], disable_auto_set_user=True)
    UserRecentVisit.objects.filter(
        workspace=workspace,
        project_id=issue.project_id,
        entity_identifier=str(issue.id),
        entity_name="issue",
    ).delete(soft=False)
    audit(
        "issue.deleted",
        issue,
        user,
        workspace,
        reason=reason,
        project_id=str(issue.project_id),
        bounty_id=str(bounty.id) if bounty else None,
    )
    # Native relation cleanup is dispatched only after the whole transaction
    # commits, including any enclosing bulk deletion.
    transaction.on_commit(lambda: soft_delete_related_objects.delay("db", "issue", issue.id))
    return issue, True
