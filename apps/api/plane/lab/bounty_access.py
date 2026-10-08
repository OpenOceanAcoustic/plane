# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, NotFound, PermissionDenied

from .bounty_models import BountyPublication, BountyTaskAccess
from .models import Bounty
from .permissions import collaboration_projects, issue_access, workspace_member


def has_project_access(user, bounty):
    if not bounty.issue_id:
        return bounty.stage.project_id in set(collaboration_projects(user, bounty.stage.workspace))
    try:
        issue_access(user, bounty.stage.workspace, bounty.issue_id)
        return True
    except APIException:
        return False


def task_granted(user, bounty):
    if not bounty.issue_id or bounty.issue.deleted_at or bounty.issue.is_draft or not user.is_active:
        return False
    grant = BountyTaskAccess.objects.filter(
        allocation__bounty=bounty, allocation__user=user, allocation__approved=True, revoked_at__isnull=True
    ).first()
    return bool(grant and (not grant.requires_project_membership or has_project_access(user, bounty)))


def publicly_visible(bounty):
    return bool(
        bounty.published_at
        and bounty.status not in ("draft", "publication_review")
        and bounty.issue_id
        and not bounty.issue.deleted_at
        and not bounty.issue.is_draft
        and BountyPublication.objects.filter(bounty=bounty, enabled=True).exists()
    )


def access_level(user, bounty):
    workspace_member(user, bounty.stage.workspace.slug)
    if has_project_access(user, bounty):
        return "project"
    if task_granted(user, bounty):
        return "task"
    if publicly_visible(bounty):
        return "public"
    raise NotFound("悬赏不可访问")


def accessible_bounties(user, workspace):
    projects = collaboration_projects(user, workspace)
    grants = BountyTaskAccess.objects.filter(
        allocation__user=user,
        allocation__approved=True,
        revoked_at__isnull=True,
        requires_project_membership=False,
    ).values("allocation__bounty_id")
    return (
        Bounty.objects.filter(stage__workspace=workspace)
        .filter(
            Q(stage__project_id__in=projects)
            | Q(id__in=grants)
            | Q(
                publication__enabled=True,
                published_at__isnull=False,
                issue__isnull=False,
                issue__deleted_at__isnull=True,
                issue__is_draft=False,
            )
        )
        .distinct()
    )


def bounty_access(user, workspace, bounty_id, *, execution=False):
    bounty = get_object_or_404(
        Bounty.objects.select_related(
            "stage__workspace", "stage__project", "issue__project", "issue__state"
        ).prefetch_related("allocations__user", "allocations__ledger", "acceptances", "ledger"),
        id=bounty_id,
        stage__workspace=workspace,
    )
    level = access_level(user, bounty)
    if execution and level == "public":
        raise PermissionDenied("执行资料仅对获批参与者和项目成员开放")
    return bounty


def planning_issue_access(user, workspace, issue_id):
    """Planning allows a granted task reference but grants no native edit rights."""
    try:
        return issue_access(user, workspace, issue_id)
    except APIException:
        bounty = get_object_or_404(
            Bounty.objects.select_related("issue__project", "issue__state", "stage__workspace"),
            issue_id=issue_id,
            stage__workspace=workspace,
        )
        workspace_member(user, workspace.slug)
        if not task_granted(user, bounty):
            raise NotFound("任务不可访问")
        return bounty.issue


def grant_allocation(allocation, user):
    return BountyTaskAccess.objects.get_or_create(
        allocation=allocation,
        defaults={
            "granted_by": user,
            "requires_project_membership": has_project_access(allocation.user, allocation.bounty),
        },
    )[0]


def issue_capabilities(user, bounty, *, editable=None):
    if editable is None:
        try:
            issue_access(user, bounty.stage.workspace, bounty.issue_id, edit=True)
            editable = True
        except APIException:
            editable = False
    return {
        "bounty_id": str(bounty.id),
        "bounty_status": bounty.status,
        "bounty_detail_url": f"/{bounty.stage.workspace.slug}/lab/bounties?bounty_id={bounty.id}",
        "can_edit_issue": editable,
    }
