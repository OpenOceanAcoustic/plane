# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from plane.db.models import ProjectMember, WorkspaceMember


def native_asset_access(user, asset):
    """Task grants deliberately never authorize native asset endpoints."""
    if (
        not asset.workspace_id
        or not WorkspaceMember.objects.filter(member=user, workspace_id=asset.workspace_id, is_active=True).exists()
    ):
        return False
    project_id = asset.project_id
    if asset.issue_id:
        if asset.issue.workspace_id != asset.workspace_id:
            return False
        project_id = asset.issue.project_id
        if asset.project_id and asset.project_id != project_id:
            return False
    if asset.comment_id:
        project_id = asset.comment.project_id
    if asset.draft_issue_id:
        project_id = asset.draft_issue.project_id
    if project_id:
        membership = (
            ProjectMember.objects.select_related("project")
            .filter(
                member=user,
                workspace_id=asset.workspace_id,
                project_id=project_id,
                is_active=True,
                project__deleted_at__isnull=True,
            )
            .first()
        )
        if not membership:
            return False
        if (
            asset.issue_id
            and membership.role == 5
            and not membership.project.guest_view_all_features
            and asset.issue.created_by_id != user.id
        ):
            return False
    if asset.page_id:
        page = asset.page
        if page.workspace_id != asset.workspace_id or page.deleted_at:
            return False
        if page.access == page.PRIVATE_ACCESS and page.owned_by_id != user.id:
            return False
        pages_projects = page.project_pages.filter(deleted_at__isnull=True).values("project_id")
        if (
            pages_projects.exists()
            and not ProjectMember.objects.filter(
                member=user,
                workspace_id=asset.workspace_id,
                project_id__in=pages_projects,
                is_active=True,
            ).exists()
        ):
            return False
    return True
