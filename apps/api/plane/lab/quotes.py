# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Private, versioned applications; only final approval creates a team allocation."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, NotFound, ValidationError

from . import bounties
from .auth import audit, lock
from .bounty_access import access_level, grant_allocation
from .finance_services import require_finance_open
from .models import Allocation, Audit, Bounty, BountyQuote, BountyQuoteAttachment
from .permissions import require_bounty_manager, workspace_member

PENDING = ("pending", "pending_review")


class QuoteConflict(APIException):
    status_code = 409
    default_detail = "报价或预算已变化，请刷新后重试"


def request_key(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("请提供有效的请求键") from None


def is_lead(user, bounty):
    if not user or not bounty.stage.project:
        return False
    try:
        require_bounty_manager(user, bounty)
        return True
    except APIException:
        return False


def is_quote_reviewer(user, quote):
    if quote.reviewer_id != user.id:
        return False
    try:
        bounties.valid_reviewer(user.id, quote.bounty.stage.project)
    except APIException:
        return False
    return (
        not Allocation.objects.filter(bounty=quote.bounty, user=user, approved=True).exists()
        and quote.user_id != user.id
    )


def visible_quotes(user, bounty):
    workspace_member(user, bounty.stage.workspace.slug)
    rows = BountyQuote.objects.filter(bounty=bounty).select_related("bounty__stage__project", "reviewer", "user")
    if not is_lead(user, bounty):
        rows = rows.filter(Q(user_id=user.id) | Q(reviewer_id=user.id))
        rows = [row for row in rows if row.user_id == user.id or is_quote_reviewer(user, row)]
        return rows
    return list(rows)


def require_quote_access(user, quote):
    workspace_member(user, quote.bounty.stage.workspace.slug)
    if user.id != quote.user_id and not is_lead(user, quote.bounty) and not is_quote_reviewer(user, quote):
        raise NotFound("报价不存在")


def require_open(bounty):
    if (
        bounty.status != "open"
        or not bounty.issue_id
        or bounty.issue.archived_at
        or bounty.issue.deleted_at
        or bounty.issue.is_draft
    ):
        raise ValidationError("当前悬赏不能申请或审批")
    require_finance_open(bounty.stage.workspace, bounty.stage.project_id, bounty.stage_id)


def eligible_applicant(user, bounty):
    require_open(bounty)
    access_level(user, bounty)
    if bounty.member_funded and bounty.funding.owner_id_snapshot == user.id:
        raise ValidationError("不能承接自己出资发布的悬赏")
    if (
        user.id in (bounty.reviewer_id, bounty.independent_reviewer_id)
        or BountyQuote.objects.filter(bounty=bounty, reviewer=user, status="pending_review").exists()
    ):
        raise ValidationError("验收及复核人员不能参与团队分工")
    if Allocation.objects.filter(bounty=bounty, user_id_snapshot=user.id).exists():
        raise ValidationError("已有认领记录，请继续办理原申请")


def can_apply(user, bounty):
    try:
        eligible_applicant(user, bounty)
        return not BountyQuote.objects.filter(bounty=bounty, user_id_snapshot=user.id, status__in=PENDING).exists()
    except APIException:
        return False


def budget_snapshot(bounty):
    from .vc import stage_reserved, wallet

    approved = list(Allocation.objects.filter(bounty=bounty, approved=True).order_by("id").values_list("id", "planned"))
    balance = wallet(bounty.funding.owner_id_snapshot, bounty.stage.project) if bounty.member_funded else None
    if balance:
        balance = {key: balance[key] for key in ("project_available", "earned_available", "earned_debt", "available")}
    owner = bounty.funding.owner if bounty.member_funded else bounty.stage.project.project_lead
    source_available = Decimal(balance["available"]) if balance else bounty.stage.budget - stage_reserved(bounty.stage)
    return {
        "budget": str(bounty.budget),
        "reserved": str(bounty.reserved),
        "stage_available": str(source_available),
        "major": bounty.major,
        "lead_id": str(owner.id) if owner else None,
        "lead_eligible": is_lead(owner, bounty),
        **({"funding": "member", "wallet": balance} if balance else {}),
        "allocations": [[str(key), str(value)] for key, value in approved],
    }


def adjustment(quote, snapshot):
    approved = sum((Decimal(row[1]) for row in snapshot["allocations"]), Decimal("0"))
    additional = max(Decimal("0.00"), approved + quote.vc - Decimal(snapshot["budget"]))
    next_budget = Decimal(snapshot["budget"]) + additional
    requires_review = additional > 0 and bool(
        snapshot["major"] or bounties.vc_major_reasons(next_budget, quote.bounty.stage.budget)
    )
    return {
        "additional": str(additional),
        "next_budget": str(next_budget),
        "source_available": snapshot["stage_available"],
        "requires_review": requires_review,
        "funded": additional <= Decimal(snapshot["stage_available"]),
    }


@transaction.atomic
def submit_quote(user, bounty_id, data):
    bounty = bounties.locked_bounty(bounty_id)
    key = request_key(data.get("request_key"))
    kind = data.get("kind")
    vc = bounties.amount(data.get("vc"))
    deliverable = str(data.get("deliverable", "")).strip()
    basis = str(data.get("basis", "")).strip()
    attachments = data.get("attachment_ids", [])
    if not isinstance(attachments, list) or len(attachments) > 20:
        raise ValidationError("附件列表无效，最多 20 个附件")
    attachment_ids = sorted({str(request_key(value)) for value in attachments})
    snapshot = {
        "kind": kind,
        "vc": str(vc),
        "deliverable": deliverable,
        "basis": basis,
        "attachment_ids": attachment_ids,
    }
    previous = BountyQuote.objects.filter(request_key=key).first()
    if previous:
        if previous.bounty_id != bounty.id or previous.user_id != user.id or previous.request_snapshot != snapshot:
            raise QuoteConflict("请求键已用于其他内容")
        return previous, False
    eligible_applicant(user, bounty)
    if kind not in ("original", "negotiated") or vc <= 0 or not deliverable:
        raise ValidationError("请选择申请方式，填写个人交付内容和正数 VC")
    if len(deliverable) > 4000 or len(basis) > 4000:
        raise ValidationError("交付内容和报价依据分别最多 4000 字")
    if BountyQuote.objects.filter(bounty=bounty, user_id_snapshot=user.id, status__in=PENDING).exists():
        raise QuoteConflict("已有待处理申请")
    available = bounties.claim_available(bounty)
    if kind == "original" and (available <= 0 or vc != available):
        raise QuoteConflict("剩余 VC 已变化，请刷新并确认原价")
    files = BountyQuoteAttachment.objects.filter(id__in=attachment_ids, bounty=bounty, user=user, quote__isnull=True)
    if files.count() != len(attachment_ids):
        raise ValidationError("附件不存在、已使用或不属于本次申请")
    if kind == "negotiated" and not basis and not attachment_ids:
        raise ValidationError("请填写报价依据或上传附件")
    revision = (
        BountyQuote.objects.filter(bounty=bounty, user_id_snapshot=user.id).aggregate(value=Max("revision"))["value"]
        or 0
    ) + 1
    quote = BountyQuote.objects.create(
        bounty=bounty,
        user=user,
        user_id_snapshot=user.id,
        user_name=user.display_name,
        revision=revision,
        kind=kind,
        vc=vc,
        available_at_submission=available,
        deliverable=deliverable,
        basis=basis,
        request_key=key,
        request_snapshot=snapshot,
    )
    files.update(quote=quote)
    audit("bounty.quote_submitted", quote, user, bounty.stage.workspace, revision=revision)
    return quote, True


def finalize_quote(quote, actor, snapshot):
    bounty = quote.bounty
    eligible_applicant(quote.user, bounty)
    change = adjustment(quote, snapshot)
    if not change["funded"]:
        raise ValidationError("悬赏原属项目预算余额不足，无法追加 VC")
    additional = Decimal(change["additional"])
    bounties.amount(bounty.budget + additional)
    if additional:
        from .vc import reserve_additional

        reserve_additional(bounty, additional, actor)
        bounty.budget += additional
        bounty.reserved += additional
        reasons = list(
            dict.fromkeys([*bounty.major_reasons, *bounties.vc_major_reasons(bounty.budget, bounty.stage.budget)])
        )
        bounty.major = bounty.major or bool(reasons)
        bounty.major_reasons = reasons
        if quote.reviewer_id:
            bounty.independent_reviewer_id = quote.reviewer_id
        bounty.save(update_fields=["budget", "reserved", "major", "major_reasons", "independent_reviewer"])
    allocation = Allocation.objects.create(
        bounty=bounty,
        user=quote.user,
        user_id_snapshot=quote.user_id_snapshot,
        user_name=quote.user_name,
        deliverable=quote.deliverable,
        planned=quote.vc,
        approved=True,
        confirmed=True,
    )
    grant_allocation(allocation, actor)
    bounties.ensure_allocation_planning(allocation, actor)
    quote.allocation = allocation
    quote.status = "approved"
    quote.save(update_fields=["allocation", "status"])


@transaction.atomic
def decide_quote(user, bounty_id, quote_id, action, data):
    # Match publication's lock order when changing the stage's reserved balance.
    preliminary = Bounty.objects.select_related("stage").get(id=bounty_id)
    lock(f"finance:{preliminary.stage.workspace_id}")
    bounty = bounties.locked_bounty(bounty_id)
    quote = get_object_or_404(BountyQuote.objects.select_for_update(), bounty=bounty, id=quote_id)
    quote.bounty = bounty
    require_quote_access(user, quote)
    if action == "review":
        if not is_quote_reviewer(user, quote):
            raise NotFound("报价不存在")
    else:
        require_bounty_manager(user, bounty)
    key = request_key(data.get("request_key"))
    snapshot = {
        "action": action,
        "quote_id": str(quote.id),
        "body": {k: v for k, v in data.items() if k != "request_key"},
    }
    previous = Audit.objects.filter(
        workspace_id_snapshot=bounty.stage.workspace_id,
        action__startswith="bounty.quote_",
        details__request_key=str(key),
    ).first()
    if previous:
        if previous.actor_id != user.id or previous.details.get("request_snapshot") != snapshot:
            raise QuoteConflict("请求键已用于其他审批内容")
        return quote, previous.details.get("conflict", False)
    require_open(bounty)
    if not quote.user or not quote.user.is_active:
        raise ValidationError("申请人已失效")
    workspace_member(quote.user, bounty.stage.workspace.slug)
    reason = str(data.get("reason", "")).strip()
    if len(reason) > 4000:
        raise ValidationError("处理意见最多 4000 字")
    conflict = False
    current = budget_snapshot(bounty)
    if action == "reject" or (action == "review" and data.get("decision") == "reject"):
        if quote.status not in PENDING or (action == "review" and quote.status != "pending_review"):
            raise QuoteConflict("该申请已处理")
        if not reason:
            raise ValidationError("请填写驳回意见")
        quote.status = "rejected"
        quote.save(update_fields=["status"])
        event = "rejected"
    elif action == "approve":
        if quote.status != "pending":
            raise QuoteConflict("该申请不在待审批阶段")
        if data.get("expected_budget") != current:
            raise QuoteConflict()
        eligible_applicant(quote.user, bounty)
        change = adjustment(quote, current)
        if not change["funded"]:
            raise ValidationError("悬赏原属项目预算余额不足，无法追加 VC")
        if change["requires_review"]:
            reviewer = bounties.valid_reviewer(
                data.get("reviewer_id") or bounty.independent_reviewer_id, bounty.stage.project
            )
            if (
                reviewer.id == quote.user_id
                or Allocation.objects.filter(bounty=bounty, user=reviewer, approved=True).exists()
            ):
                raise ValidationError("参与者不能复核本人团队任务")
            quote.reviewer = reviewer
            quote.approval_snapshot = current
            quote.status = "pending_review"
            quote.save(update_fields=["reviewer", "approval_snapshot", "status"])
            event = "review_requested"
        else:
            finalize_quote(quote, user, current)
            event = "approved"
    elif action == "review" and data.get("decision") == "approve":
        if quote.status != "pending_review":
            raise QuoteConflict("该申请不在待复核阶段")
        if current != quote.approval_snapshot or data.get("expected_budget") != current:
            quote.status = "pending"
            quote.approval_snapshot = {}
            quote.save(update_fields=["status", "approval_snapshot"])
            conflict = True
            event = "returned"
            reason = "预算或分工已变化，已退回负责人重新审批"
        else:
            finalize_quote(quote, user, current)
            event = "approved"
    else:
        raise ValidationError("审批操作无效")
    audit(
        f"bounty.quote_{event}",
        quote,
        user,
        bounty.stage.workspace,
        reason=reason,
        request_key=str(key),
        request_snapshot=snapshot,
        conflict=conflict,
        budget_snapshot=current,
        status=quote.status,
    )
    return quote, conflict


def close_pending_quotes(bounty, actor, reason):
    for quote in BountyQuote.objects.filter(bounty=bounty, status__in=PENDING):
        quote.status = "closed"
        quote.save(update_fields=["status"])
        audit("bounty.quote_closed", quote, actor, bounty.stage.workspace, reason=reason)
