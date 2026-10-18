# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from plane.db.models import Project
from . import vc
from .models import VCGrant
from .planning_views import LabView
from .vc_budgets import adjust_budget, budget_entries


class VCBudgetEntryView(LabView):
    def patch(self, request, slug, project_id, entry_id):
        entry = adjust_budget(request.user, self.workspace, project_id, entry_id, request.data)
        return Response(next(row for row in budget_entries(entry.stage) if row["id"] == str(entry.id)))


class VCQuotaView(LabView):
    def get(self, request, slug, project_id):
        project = get_object_or_404(Project, id=project_id, workspace=self.workspace)
        members = vc.quota_members(request.user, project)
        history = VCGrant.objects.filter(stage__project=project, stage__workspace=self.workspace).order_by(
            "-created_at", "-id"
        )
        return Response(
            {
                "members": members,
                "history": [
                    {
                        "id": str(row.id),
                        "user_id": str(row.user_id_snapshot),
                        "name": row.user_name,
                        "delta": str(row.delta),
                        "reason": row.reason,
                        "created_at": row.created_at.isoformat(),
                    }
                    for row in history[:200]
                ],
            }
        )

    def post(self, request, slug, project_id):
        row, created = vc.grant(request.user, self.workspace, project_id, request.data)
        return Response({"id": str(row.id)}, status=201 if created else 200)
