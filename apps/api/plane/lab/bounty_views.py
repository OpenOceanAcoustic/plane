# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import csv

from .export import csv_cell
import uuid
from io import StringIO
from datetime import timedelta

from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember, WorkspaceMember
from . import bounties
from .auth import audit
from .models import Bounty, Ledger, PersonalCategory, PersonalItem, Stage, WIPException
from .permissions import can_view_team, collaboration_projects as project_ids, readable_issues, require_lead
from .planning_views import LabView
from .bounty_access import access_level, accessible_bounties, bounty_access, issue_capabilities
from .bounty_models import BountyPublication
from .bounty_budgets import freeze_vc_budget, project_budgets, publish_from_project
from .categories import item_category_data
from .finance_services import bounty_reward_projection, reward_projection_context


def bounty_data(row, user, reward_context=None):
    level = access_level(user, row)
    public = level == "public"
    publication = BountyPublication.objects.filter(bounty=row).first()
    participants = list(row.allocations.all())
    mine = next((p for p in participants if p.user_id == user.id), None)
    if public:
        participants = [mine] if mine else []
    acceptances = list(row.acceptances.all().order_by("-created_at"))
    capabilities = issue_capabilities(user, row)
    try:
        require_lead(user, row.stage.project)
        lead = True
    except APIException:
        lead = False
    own_item = (
        PersonalItem.objects.filter(workspace=row.stage.workspace, user=user, issue_id=row.issue_id)
        .select_related("category")
        .first()
        if row.issue_id
        else None
    )
    category = PersonalCategory.objects.filter(workspace=row.stage.workspace, user=user, legacy_key="project").first()
    return {
        **capabilities,
        **bounty_reward_projection(row, user, context=reward_context),
        **(
            item_category_data(own_item)
            if own_item
            else {
                "category_id": str(category.id) if category else None,
                "category_name": category.name if category else None,
                "category_color": category.color if category else None,
            }
        ),
        "access_level": level,
        "public_summary": publication.summary if publication else "",
        "detail_url": capabilities["bounty_detail_url"],
        "issue_key": f"{row.issue.project.identifier}-{row.issue.sequence_id}" if row.issue_id else None,
        "can_claim": bool(
            row.status == "open"
            and not mine
            and row.issue_id
            and not row.issue.archived_at
            and user.id not in (row.reviewer_id, row.independent_reviewer_id)
        ),
        "can_confirm": bool(row.status == "open" and mine and mine.approved and not mine.confirmed and not public),
        "can_submit": bool(
            row.status in ("active", "partial", "rework")
            and mine
            and mine.approved
            and mine.confirmed
            and not mine.closed
            and not public
        ),
        "can_manage_materials": lead and row.status != "deleted",
        "can_delete": lead and row.status != "deleted",
        "id": str(row.id),
        "stage_id": str(row.stage_id),
        "project_id": str(row.stage.project_id_snapshot),
        "project": row.stage.project_name,
        "issue_id": str(row.issue_id) if row.issue_id else None,
        "issue_id_snapshot": str(row.issue_id_snapshot),
        "title": row.title,
        "deliverable": publication.deliverable if public and publication else "" if public else row.deliverable,
        "criteria": publication.criteria if public and publication else "" if public else row.criteria,
        "budget": str(row.budget),
        "reserved": None if public else str(row.reserved),
        "awarded": None if public else str(bounties.total(row.ledger.all(), "delta")),
        "status": row.status,
        "major": row.major,
        "major_reasons": [] if public else row.major_reasons,
        "evidence": "" if public else row.evidence,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "overdue": bool(row.due_at and row.due_at < timezone.now() and row.status in ("review", "acceptance_review")),
        "is_lead": lead,
        "is_reviewer": not public and row.reviewer_id == user.id,
        "is_independent_reviewer": not public and row.independent_reviewer_id == user.id,
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
            for a in ([] if public else acceptances)
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
        stage = freeze_vc_budget(request.user, self.workspace, project, request.data)
        return Response({"id": str(stage.id)}, status=201)


class BountyBudgetView(LabView):
    def get(self, request, slug):
        return Response(project_budgets(request.user, self.workspace))


class BountyView(LabView):
    def get(self, request, slug):
        rows = list(
            accessible_bounties(request.user, self.workspace)
            .select_related("stage__project", "stage__workspace", "issue__project")
            .prefetch_related("allocations", "acceptances", "ledger")
            .order_by("-created_at")
        )
        reward_context = reward_projection_context(rows, request.user)
        records = []
        for row in rows:
            try:
                records.append(bounty_data(row, request.user, reward_context=reward_context))
            except NotFound:
                continue
        return Response(records)

    def post(self, request, slug):
        if request.data.get("project_id"):
            row = publish_from_project(request.user, self.workspace, request.data["project_id"], request.data)
        else:
            stage = get_object_or_404(Stage, id=request.data.get("stage_id"), workspace=self.workspace)
            row = bounties.publish(request.user, stage.id, request.data)
        return Response({"id": str(row.id)}, status=201)


class BountyActionView(LabView):
    def post(self, request, slug, pk, action):
        row = bounty_access(request.user, self.workspace, pk)
        if row.status == "deleted":
            raise ValidationError("悬赏已删除")
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
        elif action == "reopen":
            bounties.reopen(request.user, row.id, data.get("reason", ""))
        elif action == "public-summary":
            result = bounties.update_public_summary(request.user, row.id, data)
        else:
            raise ValidationError("操作无效")
        return Response({"ok": True, "id": str(result.id) if result else None})


class BountyDetailView(LabView):
    def get(self, request, slug, pk):
        return Response(bounty_data(bounty_access(request.user, self.workspace, pk), request.user))

    def delete(self, request, slug, pk):
        row = bounty_access(request.user, self.workspace, pk)
        bounties.delete(request.user, row.id, request.data.get("reason", ""))
        return Response(status=204)


class TaskCardMetadataView(LabView):
    def get(self, request, slug):
        return self.metadata(
            request,
            project_id=request.query_params.get("project_id"),
            issue_ids=request.query_params.get("issue_ids", "").split(",")
            if request.query_params.get("issue_ids")
            else None,
        )

    def post(self, request, slug):
        return self.metadata(
            request, project_id=request.data.get("project_id"), issue_ids=request.data.get("issue_ids")
        )

    def metadata(self, request, *, project_id=None, issue_ids=None):
        rows = readable_issues(request.user, self.workspace).filter(is_draft=False)
        if project_id:
            project = get_object_or_404(
                Project, id=project_id, workspace=self.workspace, id__in=project_ids(request.user, self.workspace)
            )
            rows = rows.filter(project=project)
        elif issue_ids is None:
            raise ValidationError("需要项目或工作项 ID")
        if issue_ids is not None:
            if not isinstance(issue_ids, list) or len(issue_ids) > 200:
                raise ValidationError("最多同时查询 200 个工作项")
            try:
                ids = [uuid.UUID(str(value)) for value in issue_ids]
            except (ValueError, TypeError, AttributeError):
                raise ValidationError("工作项 ID 格式无效")
            rows = rows.filter(id__in=ids)
        ids = set(rows.values_list("id", flat=True))
        items = {
            row.issue_id: row
            for row in PersonalItem.objects.filter(
                workspace=self.workspace,
                user=request.user,
                issue_id__in=ids,
            ).select_related("category")
        }
        bounties_by_issue = {
            row.issue_id: row
            for row in Bounty.objects.filter(issue_id__in=ids)
            .exclude(status="deleted")
            .select_related("stage__workspace")
        }
        category = PersonalCategory.objects.filter(
            workspace=self.workspace, user=request.user, legacy_key="project"
        ).first()
        records = []
        for issue_id in ids.intersection(set(items) | set(bounties_by_issue)):
            item, bounty = items.get(issue_id), bounties_by_issue.get(issue_id)
            category_fields = (
                item_category_data(item)
                if item
                else {
                    "category_id": str(category.id) if category else None,
                    "category_name": category.name if category else None,
                    "category_color": category.color if category else None,
                }
            )
            detail = f"/{self.workspace.slug}/lab/bounties?bounty_id={bounty.id}" if bounty else None
            records.append(
                {
                    "issue_id": str(issue_id),
                    "bounty_id": str(bounty.id) if bounty else None,
                    "bounty_status": bounty.status if bounty else None,
                    **category_fields,
                    "color": category_fields["category_color"],
                    "detail_path": detail,
                    "bounty_detail_url": detail,
                }
            )
        return Response({"items": records})


class LedgerView(LabView):
    def get(self, request, slug):
        # No global ranking: return project-scoped records and historical snapshots.
        allowed = set(project_ids(request.user, self.workspace))
        scope = Q(bounty__stage__project_id_snapshot__in=allowed)
        scope |= Q(
            allocation__user=request.user,
            allocation__task_access__revoked_at__isnull=True,
            allocation__task_access__requires_project_membership=False,
        )
        if self.membership.role == 20:
            scope |= Q(bounty__stage__project__isnull=True) | Q(bounty__stage__project__deleted_at__isnull=False)
        lead_projects = set(
            ProjectMember.objects.filter(
                workspace=self.workspace,
                member=request.user,
                is_active=True,
                role__gte=15,
                project__project_lead=request.user,
            ).values_list("project_id", flat=True)
        )
        rows = (
            Ledger.objects.filter(scope, bounty__stage__workspace_id_snapshot=self.workspace.id)
            .annotate(
                permission_project_id=F("bounty__stage__project_id"),
                already_reversed=Exists(Ledger.objects.filter(reverses_id=OuterRef("pk"))),
            )
            .order_by("created_at")
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
                "can_reverse": row.delta > 0
                and row.permission_project_id in lead_projects
                and not row.already_reversed,
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
        rows = accessible_bounties(request.user, self.workspace).select_related(
            "stage__project", "stage__workspace", "issue"
        )
        tasks = []
        for row in rows:
            try:
                access_level(request.user, row)
            except NotFound:
                continue
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
