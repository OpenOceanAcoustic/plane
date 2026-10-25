# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember, WorkspaceMember
from .auth import issue_invitation
from .planning_views import LabView


class LabInvitationCreateView(LabView):
    permission_classes = [IsAuthenticated]

    def post(self, request, slug):
        membership = WorkspaceMember.objects.filter(
            workspace__slug=slug, member=request.user, is_active=True, member__is_active=True
        ).first()
        if membership is None or membership.role < 20:
            return Response({"error": "只有工作区管理员可以生成邀请链接"}, status=status.HTTP_403_FORBIDDEN)
        project = None
        project_id = str(request.data.get("project_id", "")).strip()
        if project_id:
            project = Project.objects.filter(id=project_id, workspace=membership.workspace).first()
            if project is None:
                return Response({"error": "项目不存在"}, status=status.HTTP_400_BAD_REQUEST)
            if (
                not ProjectMember.objects.filter(
                    project=project, member=request.user, is_active=True, role__gte=20
                ).exists()
                and project.project_lead_id != request.user.id
            ):
                return Response({"error": "只有项目管理员可以邀请项目成员"}, status=status.HTTP_403_FORBIDDEN)
        invitation, token = issue_invitation("member", workspace=membership.workspace, role=15, project=project)
        return Response(
            {
                "id": str(invitation.id),
                "url": f"/lab/register/{token}",
                "expires_at": invitation.expires_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )
