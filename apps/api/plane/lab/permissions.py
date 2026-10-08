# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied

from plane.db.models import Issue, Project, ProjectMember, WorkspaceMember


def workspace_member(user, slug):
    membership = (
        WorkspaceMember.objects.select_related("workspace")
        .filter(workspace__slug=slug, member=user, is_active=True, member__is_active=True)
        .first()
    )
    if not membership:
        raise PermissionDenied("无工作区访问权限")
    return membership


def project_ids(user, workspace):
    private_ids = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True).values("project_id")
    return Project.objects.filter(workspace=workspace, id__in=private_ids).values_list("id", flat=True)


def restricted_projects(user, workspace):
    return ProjectMember.objects.filter(
        workspace=workspace, member=user, is_active=True, role=5, project__guest_view_all_features=False
    ).values_list("project_id", flat=True)


def collaboration_projects(user, workspace):
    return project_ids(user, workspace).exclude(id__in=restricted_projects(user, workspace))


def readable_issues(user, workspace):
    return Issue.objects.filter(workspace=workspace, project_id__in=project_ids(user, workspace)).filter(
        ~Q(project_id__in=restricted_projects(user, workspace)) | Q(created_by=user)
    )


def can_read_issue(user, issue, allowed_projects):
    if issue.project_id not in allowed_projects or issue.deleted_at or issue.is_draft:
        return False
    if not issue.project.guest_view_all_features and issue.created_by_id != user.id:
        return not ProjectMember.objects.filter(project=issue.project, member=user, is_active=True, role=5).exists()
    return True


def issue_access(user, workspace, issue_id, edit=False):
    issue = (
        readable_issues(user, workspace).select_related("project", "state").filter(id=issue_id, is_draft=False).first()
    )
    if not issue or (edit and issue.archived_at):
        raise NotFound("任务不可访问")
    if edit and not (
        issue.created_by_id == user.id
        or ProjectMember.objects.filter(project=issue.project, member=user, is_active=True)
        .filter(Q(role__gte=15) | Q(project__guest_view_all_features=True))
        .exists()
    ):
        raise PermissionDenied("需要项目成员编辑权限")
    return issue


def require_lead(user, project):
    if not project or project.project_lead_id != user.id:
        raise PermissionDenied("仅项目负责人可以执行")
    workspace_member(user, project.workspace.slug)
    if not ProjectMember.objects.filter(project=project, member=user, is_active=True, role__gte=15).exists():
        raise PermissionDenied("负责人需要有效项目成员权限")


def can_view_team(user, membership):
    current_projects = ProjectMember.objects.filter(
        workspace=membership.workspace, member=user, is_active=True, role__gte=15
    ).values("project_id")
    return (
        membership.role == 20
        or Project.objects.filter(workspace=membership.workspace, project_lead=user, id__in=current_projects).exists()
    )
