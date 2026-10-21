# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only

"""Simple cash bounties: first claim, lead acceptance, one cash payment."""

import uuid
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember

from .finance_permissions import project_finance_access
from .finance_services import account, perform
from .models import CashBounty
from .permissions import project_ids, require_lead
from .planning_views import LabView


def cash_amount(value):
    try:
        result = Decimal(str(value))
        if (
            not result.is_finite()
            or result <= 0
            or result > Decimal("999999999999.99")
            or result != result.quantize(Decimal("0.01"))
        ):
            raise InvalidOperation()
        return result.quantize(Decimal("0.01"))
    except (ValueError, TypeError, InvalidOperation):
        raise ValidationError("现金赏金须大于 0，最多两位小数")


def project_for(user, workspace, project_id):
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    if not ProjectMember.objects.filter(
        project=project, member=user, is_active=True, member__is_active=True
    ).exists():
        raise PermissionDenied("无项目访问权限")
    return project


def can_pay(user, row):
    permissions, owner = project_finance_access(user, row.project)
    return owner or "pay" in permissions


def row_data(row, user):
    member = ProjectMember.objects.filter(
        project=row.project, member=user, is_active=True, role__gte=15, member__is_active=True
    ).exists()
    return {
        "id": str(row.id),
        "project_id": str(row.project_id),
        "project": row.project.name,
        "title": row.title,
        "deliverable": row.deliverable,
        "criteria": row.criteria,
        "amount": str(row.amount),
        "status": row.status,
        "publisher": {"id": str(row.publisher_id), "name": row.publisher.display_name} if row.publisher else None,
        "reviewer": {"id": str(row.reviewer_id), "name": row.reviewer.display_name} if row.reviewer else None,
        "claimed_by": {"id": str(row.claimed_by_id), "name": row.claimed_by.display_name} if row.claimed_by else None,
        "claimed_at": row.claimed_at.isoformat() if row.claimed_at else None,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "paid_at": row.paid_at.isoformat() if row.paid_at else None,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "evidence": row.evidence,
        "acceptance_note": row.acceptance_note,
        "can_claim": row.status == "open" and member and row.publisher_id != user.id,
        "can_submit": row.status == "claimed" and row.claimed_by_id == user.id,
        "can_accept": row.status == "submitted" and (row.reviewer_id == user.id or row.project.project_lead_id == user.id),
        "can_pay": row.status == "accepted" and can_pay(user, row),
        "can_cancel": row.status in ("open", "claimed")
        and (row.publisher_id == user.id or row.project.project_lead_id == user.id),
    }


class CashBountyView(LabView):
    def get(self, request, slug):
        rows = (
            CashBounty.objects.filter(
                workspace=self.workspace,
                project_id__in=project_ids(request.user, self.workspace),
            )
            .select_related("project", "publisher", "reviewer", "claimed_by")
            .order_by("-created_at")
        )
        return Response([row_data(row, request.user) for row in rows])

    def post(self, request, slug):
        project = project_for(request.user, self.workspace, request.data.get("project_id"))
        require_lead(request.user, project)
        title = str(request.data.get("title", "")).strip()
        deliverable = str(request.data.get("deliverable", "")).strip()
        criteria = str(request.data.get("criteria", "")).strip()
        if not title:
            raise ValidationError("请填写任务名称")
        if not deliverable:
            raise ValidationError("请填写交付要求")
        amount = cash_amount(request.data.get("amount"))
        due_at = parse_datetime(str(request.data.get("due_at", ""))) if request.data.get("due_at") else None
        if due_at and timezone.is_naive(due_at):
            due_at = timezone.make_aware(due_at, ZoneInfo("Asia/Shanghai"))
        reviewer = project.project_lead or request.user
        row = CashBounty.objects.create(
            workspace=self.workspace,
            project=project,
            title=title,
            deliverable=deliverable,
            criteria=criteria,
            amount=amount,
            status="open",
            publisher=request.user,
            reviewer=reviewer,
            due_at=due_at,
        )
        return Response(row_data(row, request.user), status=201)


class CashBountyDetailView(LabView):
    def get(self, request, slug, pk):
        row = get_object_or_404(
            CashBounty.objects.select_related("project", "publisher", "reviewer", "claimed_by"),
            id=pk,
            workspace=self.workspace,
        )
        project_for(request.user, self.workspace, row.project_id)
        return Response(row_data(row, request.user))


class CashBountyActionView(LabView):
    def post(self, request, slug, pk, action):
        with transaction.atomic():
            row = get_object_or_404(
                CashBounty.objects.select_for_update().select_related("project", "publisher", "reviewer", "claimed_by"),
                id=pk,
                workspace=self.workspace,
            )
            project_for(request.user, self.workspace, row.project_id)
            now = timezone.now()
            if action == "claim":
                if row.status != "open":
                    raise ValidationError("该现金悬赏已被领取或已结束")
                if row.publisher_id == request.user.id:
                    raise PermissionDenied("不能领取自己发布的现金悬赏")
                if not ProjectMember.objects.filter(
                    project=row.project, member=request.user, is_active=True, role__gte=15, member__is_active=True
                ).exists():
                    raise PermissionDenied("只有项目成员可以接单")
                row.status = "claimed"
                row.claimed_by = request.user
                row.claimed_at = now
                row.save(update_fields=["status", "claimed_by", "claimed_at"])
            elif action == "submit":
                if row.status != "claimed" or row.claimed_by_id != request.user.id:
                    raise PermissionDenied("只有领取人可以提交成果")
                evidence = str(request.data.get("evidence", "")).strip()
                if not evidence:
                    raise ValidationError("请填写成果或证据")
                row.evidence = evidence
                row.submitted_at = now
                row.status = "submitted"
                row.save(update_fields=["evidence", "submitted_at", "status"])
            elif action == "accept":
                if row.status != "submitted":
                    raise ValidationError("该悬赏尚未提交成果")
                if row.reviewer_id != request.user.id and row.project.project_lead_id != request.user.id:
                    raise PermissionDenied("只有验收人或项目负责人可以验收")
                row.acceptance_note = str(request.data.get("note", "")).strip()
                row.accepted_at = now
                row.status = "accepted"
                row.save(update_fields=["acceptance_note", "accepted_at", "status"])
            elif action == "pay":
                if row.status == "paid":
                    return Response(row_data(row, request.user))
                if row.status != "accepted":
                    raise ValidationError("请先验收通过再付款")
                if not can_pay(request.user, row):
                    raise PermissionDenied("无此项目付款权限")
                cash = account(self.workspace, "project", project=row.project)
                payee = row.claimed_by
                result = perform(
                    request.user,
                    self.workspace,
                    "expense",
                    {
                        "account_id": str(cash.id),
                        "amount": str(row.amount),
                        "purpose": f"现金悬赏：{row.title} / {payee.display_name if payee else '领取人'}",
                        "reason": f"现金悬赏验收付款：{row.title}",
                        "evidence": row.evidence or f"现金悬赏验收通过：{row.title}",
                        "request_key": str(uuid.uuid5(uuid.NAMESPACE_URL, f"cash-bounty:{row.id}:pay")),
                        "cash_bounty_id": str(row.id),
                        "payee_id": str(row.claimed_by_id) if row.claimed_by_id else None,
                        "payee_name": payee.display_name if payee else "",
                    },
                )
                row.payment_operation_id = result.get("operation_id")
                row.paid_at = now
                row.status = "paid"
                row.save(update_fields=["payment_operation", "paid_at", "status"])
            elif action == "cancel":
                if row.status not in ("open", "claimed"):
                    raise ValidationError("该悬赏已提交成果，不能取消")
                if row.publisher_id != request.user.id and row.project.project_lead_id != request.user.id:
                    raise PermissionDenied("只有发布人或项目负责人可以取消")
                row.status = "cancelled"
                row.save(update_fields=["status"])
            else:
                raise ValidationError("未知操作")
        row.refresh_from_db()
        return Response(row_data(row, request.user))
