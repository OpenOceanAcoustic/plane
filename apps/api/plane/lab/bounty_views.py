# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import csv

from .export import csv_cell
import uuid
from io import StringIO
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, WorkspaceMember
from . import bounties
from .auth import audit
from .models import Bounty, Ledger, Stage, WIPException, WorkspacePolicy
from .permissions import can_view_team, collaboration_projects as project_ids, require_lead
from .planning_views import LabView


def bounty_data(row, user):
    participants = list(row.allocations.all())
    acceptances = list(row.acceptances.all().order_by("-created_at"))
    return {
        "id": str(row.id),
        "stage_id": str(row.stage_id),
        "project_id": str(row.stage.project_id_snapshot),
        "project": row.stage.project_name,
        "issue_id": str(row.issue_id) if row.issue_id else None,
        "title": row.title,
        "deliverable": row.deliverable,
        "criteria": row.criteria,
        "budget": str(row.budget),
        "reserved": str(row.reserved),
        "awarded": str(bounties.total(row.ledger.all(), "delta")),
        "status": row.status,
        "major": row.major,
        "major_reasons": row.major_reasons,
        "evidence": row.evidence,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "overdue": bool(row.due_at and row.due_at < timezone.now() and row.status in ("review", "acceptance_review")),
        "is_lead": bool(row.stage.project and row.stage.project.project_lead_id == user.id),
        "is_reviewer": row.reviewer_id == user.id,
        "is_independent_reviewer": row.independent_reviewer_id == user.id,
        "allocations": [
            {
                "id": str(p.id),
                "user_id": str(p.user_id_snapshot),
                "name": p.user_name,
                "deliverable": p.deliverable,
                "planned": str(p.planned),
                "awarded": str(bounties.total(p.ledger.all(), "delta")),
                "approved": p.approved,
                "confirmed": p.confirmed,
                "closed": p.closed,
            }
            for p in participants
        ],
        "acceptances": [
            {
                "id": str(a.id),
                "result": a.result,
                "reason": a.reason,
                "targets": a.targets,
                "reviewer": a.reviewer_name,
                "approved_at": a.approved_at.isoformat() if a.approved_at else None,
            }
            for a in acceptances
        ],
    }


class StageView(LabView):
    def get(self, request, slug):
        rows = Stage.objects.filter(workspace=self.workspace, project_id__in=project_ids(request.user, self.workspace))
        return Response(
            [
                {
                    "id": str(row.id),
                    "project_id": str(row.project_id_snapshot),
                    "project": row.project_name,
                    "name": row.name,
                    "budget": str(row.budget),
                    "reserved": str(bounties.total(row.bounties.all(), "reserved")),
                    "frozen_at": row.frozen_at.isoformat(),
                }
                for row in rows
            ]
        )

    def post(self, request, slug):
        project = get_object_or_404(Project, id=request.data.get("project_id"), workspace=self.workspace)
        require_lead(request.user, project)
        budget = bounties.amount(request.data.get("budget"))
        name = str(request.data.get("name", "")).strip()
        if budget <= 0 or not name or len(name) > 120:
            raise ValidationError("请填写阶段名称和正数预算 B")
        with transaction.atomic():
            stage = Stage.objects.create(
                workspace=self.workspace,
                project=project,
                workspace_id_snapshot=self.workspace.id,
                project_id_snapshot=project.id,
                project_name=project.name,
                name=name,
                budget=budget,
                frozen_at=timezone.now(),
            )
            WorkspacePolicy.objects.get_or_create(workspace=self.workspace)
            audit("stage.frozen", stage, request.user, self.workspace, budget=str(budget))
        return Response({"id": str(stage.id)}, status=201)


class BountyView(LabView):
    def get(self, request, slug):
        rows = (
            Bounty.objects.filter(
                stage__workspace=self.workspace, stage__project_id__in=project_ids(request.user, self.workspace)
            )
            .select_related("stage__project")
            .prefetch_related("allocations", "acceptances", "ledger")
        )
        return Response([bounty_data(row, request.user) for row in rows.order_by("-created_at")])

    def post(self, request, slug):
        stage = get_object_or_404(Stage, id=request.data.get("stage_id"), workspace=self.workspace)
        row = bounties.publish(request.user, stage.id, request.data)
        return Response({"id": str(row.id)}, status=201)


class BountyActionView(LabView):
    def post(self, request, slug, pk, action):
        row = get_object_or_404(
            Bounty,
            id=pk,
            stage__workspace=self.workspace,
            stage__project_id__in=project_ids(request.user, self.workspace),
        )
        data = request.data
        result = None
        if action == "claim":
            result = bounties.claim(request.user, row.id, data)
        elif action == "approve":
            bounties.approve_claim(request.user, row.id, data.get("allocation_id"))
        elif action == "confirm":
            bounties.confirm_claim(request.user, row.id)
        elif action == "start":
            bounties.start(request.user, row.id)
        elif action == "submit":
            bounties.submit(request.user, row.id, data.get("evidence", ""))
        elif action == "accept":
            result = bounties.accept(request.user, row.id, data)
        elif action == "publication-review":
            bounties.publication_review(request.user, row.id, data.get("reason", ""))
        elif action == "acceptance-review":
            bounties.review_acceptance(request.user, row.id, data.get("acceptance_id"), data.get("reason", ""))
        elif action == "cancel":
            bounties.cancel(request.user, row.id, data.get("reason", ""))
        else:
            raise ValidationError("操作无效")
        return Response({"ok": True, "id": str(result.id) if result else None})


class LedgerView(LabView):
    def get(self, request, slug):
        # No global ranking: return project-scoped records and historical snapshots.
        allowed = set(project_ids(request.user, self.workspace))
        scope = Q(bounty__stage__project_id_snapshot__in=allowed)
        if self.membership.role == 20:
            scope |= Q(bounty__stage__project__isnull=True) | Q(bounty__stage__project__deleted_at__isnull=False)
        rows = Ledger.objects.filter(scope, bounty__stage__workspace_id_snapshot=self.workspace.id).order_by(
            "created_at"
        )
        if request.query_params.get("project_id"):
            rows = rows.filter(bounty__stage__project_id_snapshot=request.query_params["project_id"])
        records = [
            {
                "id": str(row.id),
                "created_at": row.created_at.isoformat(),
                "delta": str(row.delta),
                "bounty_id": str(row.bounty_id),
                "allocation_id": str(row.allocation_id),
                "task": row.task_snapshot,
                "participant": row.participant_snapshot,
                "actor": row.actor_name,
                "reason": row.reason,
                "reverses": str(row.reverses_id) if row.reverses_id else None,
            }
            for row in rows
        ]
        if request.query_params.get("format") == "csv":
            output = StringIO()
            writer = csv.writer(output)
            writer.writerow(
                ["记录ID", "时间", "项目", "任务ID", "任务", "人员ID", "人员", "VC变化", "验收人", "原因", "冲正记录"]
            )

            for row in records:
                writer.writerow(
                    [
                        csv_cell(value)
                        for value in (
                            row["id"],
                            row["created_at"],
                            row["task"].get("project"),
                            row["task"].get("id"),
                            row["task"].get("title"),
                            row["participant"].get("id"),
                            row["participant"].get("name"),
                            row["delta"],
                            row["actor"],
                            row["reason"],
                            row["reverses"],
                        )
                    ]
                )
            response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = 'attachment; filename="project-contributions.csv"'
            return response
        return Response(records)


class LedgerReverseView(LabView):
    def post(self, request, slug, pk):
        get_object_or_404(
            Ledger,
            id=pk,
            bounty__stage__workspace=self.workspace,
            bounty__stage__project_id__in=project_ids(request.user, self.workspace),
        )
        try:
            uuid.UUID(str(request.data.get("request_key")))
        except (ValueError, TypeError):
            raise ValidationError("需要 UUID 幂等键")
        result = bounties.reverse(request.user, pk, request.data)
        return Response({"id": str(result.id)})


class WIPExceptionView(LabView):
    def get(self, request, slug):
        rows = WIPException.objects.filter(workspace=self.workspace, expires_at__gt=timezone.now()).select_related(
            "user", "approver"
        )
        if not can_view_team(request.user, self.membership):
            rows = rows.filter(user=request.user)
        return Response(
            [
                {
                    "id": str(row.id),
                    "user_id": str(row.user_id),
                    "name": row.user.display_name,
                    "approver": row.approver.display_name,
                    "reason": row.reason,
                    "expires_at": row.expires_at.isoformat(),
                    "active_limit": row.active_limit,
                    "major_limit": row.major_limit,
                }
                for row in rows
            ]
        )

    def post(self, request, slug):
        if not can_view_team(request.user, self.membership):
            raise PermissionDenied("仅负责人可以批准 WIP 例外")
        member = get_object_or_404(
            WorkspaceMember,
            workspace=self.workspace,
            member_id=request.data.get("user_id"),
            is_active=True,
            member__is_active=True,
        )
        if member.member_id == request.user.id:
            raise PermissionDenied("不能批准本人的例外")
        reason = str(request.data.get("reason", "")).strip()
        try:
            expires = parse_datetime(request.data.get("expires_at", ""))
            active = int(request.data.get("active_limit", 2))
            major = int(request.data.get("major_limit", 1))
            if (
                not expires
                or timezone.is_naive(expires)
                or not timezone.now() < expires <= timezone.now() + timedelta(days=90)
                or not 2 <= active <= 10
                or not 1 <= major <= 5
                or not reason
            ):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValidationError("例外须有原因、90 天内截止时间及有效 WIP 上限")
        with transaction.atomic():
            row = WIPException.objects.create(
                workspace=self.workspace,
                user=member.member,
                approver=request.user,
                reason=reason,
                expires_at=expires,
                active_limit=active,
                major_limit=major,
            )
            audit(
                "wip.exception",
                row,
                request.user,
                self.workspace,
                reason=reason,
                user_id=str(member.member_id),
                expires_at=expires.isoformat(),
                active_limit=active,
                major_limit=major,
            )
        return Response({"id": str(row.id)}, status=201)


class InboxView(LabView):
    def get(self, request, slug):
        rows = Bounty.objects.filter(
            stage__workspace=self.workspace, stage__project_id__in=project_ids(request.user, self.workspace)
        ).select_related("stage__project")
        tasks = []
        for row in rows:
            reason = None
            if row.status == "publication_review" and row.independent_reviewer_id == request.user.id:
                reason = "重大任务发布复核"
            elif row.status == "acceptance_review" and row.independent_reviewer_id == request.user.id:
                reason = "重大任务验收复核"
            elif row.status == "review" and row.reviewer_id == request.user.id:
                reason = "验收"
            elif (
                row.status == "open"
                and row.stage.project
                and row.stage.project.project_lead_id == request.user.id
                and row.allocations.filter(approved=False).exists()
            ):
                reason = "审批认领"
            elif (
                row.status == "open"
                and row.allocations.filter(user=request.user, approved=True, confirmed=False).exists()
            ):
                reason = "确认开工约定"
            if reason:
                tasks.append(
                    {
                        "id": str(row.id),
                        "title": row.title,
                        "action": reason,
                        "due_at": row.due_at.isoformat() if row.due_at else None,
                        "overdue": bool(row.due_at and row.due_at < timezone.now()),
                    }
                )
        return Response(tasks)
