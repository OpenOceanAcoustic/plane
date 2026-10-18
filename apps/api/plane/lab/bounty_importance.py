# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Publisher-selected importance and serialized changes before team work starts."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from .auth import audit
from .finance_services import require_finance_open
from .models import Allocation, Audit, BountyQuote
from .permissions import require_bounty_manager
from .vc import parse_key

EDITABLE = ("open", "publication_review")


class ImportanceConflict(APIException):
    status_code = 409
    default_detail = "悬赏状态或重要级别已变化，请刷新后重试"


def selected_major(data):
    value = data.get("major", False)
    if not isinstance(value, bool):
        raise ValidationError("重要级别无效，请选择普通或重大")
    return value


def importance_state(bounty):
    return {
        "major": bounty.major,
        "status": bounty.status,
        "independent_reviewer_id": str(bounty.independent_reviewer_id) if bounty.independent_reviewer_id else None,
    }


@transaction.atomic
def change_importance(user, bounty_id, data):
    from .bounties import locked_bounty, valid_reviewer

    bounty = locked_bounty(bounty_id)
    require_bounty_manager(user, bounty)
    require_finance_open(bounty.stage.workspace, bounty.stage.project_id, bounty.stage_id)
    if "major" not in data:
        raise ValidationError("请选择重要级别")
    key = parse_key(data.get("request_key"))
    major = selected_major(data)
    try:
        reviewer_id = str(parse_key(data.get("independent_reviewer_id"))) if major else None
    except ValidationError as error:
        raise ValidationError("请选择有效复核人") from error
    snapshot = {
        "bounty_id": str(bounty.id),
        "major": major,
        "reviewer_id": reviewer_id,
        "expected_state": data.get("expected_state"),
    }
    previous = Audit.objects.filter(
        workspace_id_snapshot=bounty.stage.workspace_id,
        action="bounty.importance_changed",
        details__request_key=str(key),
    ).first()
    if previous:
        if previous.actor_id != user.id or previous.details.get("request_snapshot") != snapshot:
            raise ImportanceConflict("请求键已用于其他重要级别调整")
        return bounty
    if (
        bounty.status not in EDITABLE
        or not bounty.issue_id
        or bounty.issue.archived_at
        or bounty.issue.deleted_at
        or bounty.issue.is_draft
    ):
        raise ValidationError("仅可在开工前调整重要级别")
    before = importance_state(bounty)
    if data.get("expected_state") != before:
        raise ImportanceConflict()
    reviewer = valid_reviewer(reviewer_id, bounty.stage.project) if major else None
    if reviewer and (
        Allocation.objects.filter(bounty=bounty, user=reviewer, approved=True).exists()
        or BountyQuote.objects.filter(bounty=bounty, user=reviewer, status__in=("pending", "pending_review")).exists()
    ):
        raise ValidationError("申请人或已批准参与者不能担任复核人")
    if before["major"] == major and before["independent_reviewer_id"] == (str(reviewer.id) if reviewer else None):
        return bounty
    previous_reasons = list(bounty.major_reasons)
    bounty.major = major
    bounty.major_reasons = ["publisher"] if major else []
    bounty.independent_reviewer = reviewer
    bounty.status = "publication_review" if major else "open"
    if not major and not bounty.published_at:
        bounty.published_at = timezone.now()
    bounty.save(update_fields=["major", "major_reasons", "independent_reviewer", "status", "published_at"])
    for quote in BountyQuote.objects.select_for_update().filter(bounty=bounty, status="pending_review"):
        quote.status = "pending"
        quote.approval_snapshot = {}
        quote.save(update_fields=["status", "approval_snapshot"])
        audit(
            "bounty.quote_returned",
            quote,
            user,
            bounty.stage.workspace,
            reason="任务重要级别已调整，退回重新审批",
            status="pending",
        )
    audit(
        "bounty.importance_changed",
        bounty,
        user,
        bounty.stage.workspace,
        reason="发布人设为重大任务" if major else "发布人设为普通任务",
        previous_reasons=previous_reasons,
        before=before,
        after=importance_state(bounty),
        request_key=str(key),
        request_snapshot=snapshot,
    )
    return bounty
