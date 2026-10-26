# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only

"""Simple cash bounties: first claim, lead acceptance, one cash payment."""

import uuid
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember

from .finance_permissions import project_finance_access
from .finance_services import account, perform
from .models import CashBounty
from .permissions import project_ids
from .planning_views import LabView


BOUNTY_REQUIREMENTS = (
    ("target", "任务入口与范围"),
    ("steps", "操作步骤"),
    ("deliverable", "交付要求"),
    ("criteria", "验收标准"),
)


def bounty_description(data):
    values = {key: str(data.get(key, "") or "").strip() for key, _ in BOUNTY_REQUIREMENTS}
    missing = [label for key, label in BOUNTY_REQUIREMENTS if not values[key]]
    if missing:
        raise ValidationError("请填写" + "、".join(missing))
    return "\n\n".join(f"{label}：\n{values[key]}" for key, label in BOUNTY_REQUIREMENTS if key != "criteria")


def bounty_submission(data):
    mode = data.get("feedback_mode", "text")
    if mode == "text":
        evidence = str(data.get("evidence", "") or "").strip()
        if not evidence:
            raise ValidationError("请填写成果或证据")
        return evidence
    if mode != "test":
        raise ValidationError("请选择有效的反馈方式")
    labels = {"pass": "通过", "fail": "不通过", "blocked": "无法测试"}
    result = data.get("test_result")
    if not isinstance(result, str) or result not in labels:
        raise ValidationError("请选择测试结论")
    steps = str(data.get("test_steps", "") or "").strip()
    feedback = str(data.get("feedback", "") or "").strip()
    if not steps:
        raise ValidationError("请填写已测步骤与实际结果")
    if result != "pass" and not feedback:
        raise ValidationError("请填写问题复现步骤、预期与实际结果，或无法测试的原因")
    return f"人工测试反馈\n测试结论：{labels[result]}\n已测步骤与实际结果：\n{steps}\n问题或建议：\n{feedback or '未发现问题'}"


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
        "payment_operation_id": str(row.payment_operation_id) if row.payment_operation_id else None,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "evidence": row.evidence,
        "acceptance_note": row.acceptance_note,
        "review_note": row.review_note,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "can_approve": row.status == "proposed"
        and (row.reviewer_id == user.id or row.project.project_lead_id == user.id),
        "can_reject": row.status == "proposed"
        and (row.reviewer_id == user.id or row.project.project_lead_id == user.id),
        "can_claim": row.status == "open"
        and member
        and not (row.publisher_id == user.id and row.project.project_lead_id == user.id),
        "can_submit": row.status == "claimed" and row.claimed_by_id == user.id,
        "can_accept": row.status == "submitted" and (row.reviewer_id == user.id or row.project.project_lead_id == user.id),
        "can_pay": row.status == "accepted" and can_pay(user, row),
        "can_cancel": row.status in ("proposed", "open", "claimed")
        and (row.publisher_id == user.id or row.project.project_lead_id == user.id),
    }


def visible_cash_bounties(user, workspace):
    """Use one visibility scope for lists, deep links, workbench and AI reads."""
    return CashBounty.objects.filter(
        workspace=workspace, project_id__in=project_ids(user, workspace)
    ).filter(~Q(status="proposed") | Q(publisher=user) | Q(project__project_lead=user))


class CashBountyView(LabView):
    def get(self, request, slug):
        rows = (
            visible_cash_bounties(request.user, self.workspace)
            .select_related("project", "publisher", "reviewer", "claimed_by")
            .order_by("-created_at")
        )
        return Response([row_data(row, request.user) for row in rows])

    def post(self, request, slug):
        project = project_for(request.user, self.workspace, request.data.get("project_id"))
        if not ProjectMember.objects.filter(
            project=project, member=request.user, is_active=True, role__gte=15, member__is_active=True
        ).exists():
            raise PermissionDenied("只有项目成员可以提议现金悬赏")
        if not project.project_lead_id:
            raise ValidationError("项目未设置负责人，暂不能提交现金悬赏")
        title = str(request.data.get("title", "")).strip()
        deliverable = bounty_description(request.data)
        criteria = str(request.data.get("criteria", "")).strip()
        if not title:
            raise ValidationError("请填写任务名称")
        if not deliverable:
            raise ValidationError("请填写交付要求")
        amount = cash_amount(request.data.get("amount"))
        due_at = parse_datetime(str(request.data.get("due_at", ""))) if request.data.get("due_at") else None
        if due_at and timezone.is_naive(due_at):
            due_at = timezone.make_aware(due_at, ZoneInfo("Asia/Shanghai"))
        reviewer = project.project_lead
        lead = project.project_lead_id == request.user.id
        row = CashBounty.objects.create(
            workspace=self.workspace,
            project=project,
            title=title,
            deliverable=deliverable,
            criteria=criteria,
            amount=amount,
            status="open" if lead else "proposed",
            publisher=request.user,
            reviewer=reviewer,
            due_at=due_at,
        )
        return Response(row_data(row, request.user), status=201)


class CashBountyDetailView(LabView):
    def get(self, request, slug, pk):
        row = get_object_or_404(
            visible_cash_bounties(request.user, self.workspace).select_related("project", "publisher", "reviewer", "claimed_by"),
            id=pk,
            workspace=self.workspace,
        )
        project_for(request.user, self.workspace, row.project_id)
        return Response(row_data(row, request.user))


class CashBountyActionView(LabView):
    def post(self, request, slug, pk, action):
        with transaction.atomic():
            row = get_object_or_404(
                CashBounty.objects.select_for_update(of=("self",)).select_related("project", "publisher", "reviewer", "claimed_by"),
                id=pk,
                workspace=self.workspace,
            )
            project_for(request.user, self.workspace, row.project_id)
            now = timezone.now()
            if action in ("approve", "reject"):
                if row.status != "proposed":
                    raise ValidationError("该现金悬赏不在待审批状态")
                if row.reviewer_id != request.user.id and row.project.project_lead_id != request.user.id:
                    raise PermissionDenied("只有项目负责人可以审批现金悬赏")
                note = str(request.data.get("note", "")).strip()
                if action == "reject" and not note:
                    raise ValidationError("请填写驳回原因")
                row.review_note = note
                row.reviewed_at = now
                row.status = "open" if action == "approve" else "cancelled"
                row.save(update_fields=["review_note", "reviewed_at", "status"])
            elif action == "claim":
                if row.status != "open":
                    raise ValidationError("该现金悬赏已被领取或已结束")
                if row.publisher_id == request.user.id and row.project.project_lead_id == request.user.id:
                    raise PermissionDenied("负责人不能领取自己发布的现金悬赏")
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
                row.evidence = bounty_submission(request.data)
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
                payment_evidence = str(request.data.get("payment_evidence", "") or "").strip()
                if not payment_evidence:
                    raise ValidationError("请填写线下付款凭证；流程测试请明确注明测试记账")
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
                        "evidence": payment_evidence,
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
                if row.status not in ("proposed", "open", "claimed"):
                    raise ValidationError("该悬赏已提交成果，不能取消")
                if row.publisher_id != request.user.id and row.project.project_lead_id != request.user.id:
                    raise PermissionDenied("只有发布人或项目负责人可以取消")
                row.status = "cancelled"
                row.save(update_fields=["status"])
            else:
                raise ValidationError("未知操作")
        row.refresh_from_db()
        return Response(row_data(row, request.user))
