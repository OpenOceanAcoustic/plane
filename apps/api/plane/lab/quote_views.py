# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from rest_framework.response import Response

from plane.db.models import ProjectMember
from .bounty_access import bounty_access
from .models import Allocation, Audit
from .planning_views import LabView
from . import quotes

LABELS = {
    "bounty.quote_submitted": "提交申请",
    "bounty.quote_review_requested": "负责人同意，待复核",
    "bounty.quote_approved": "批准承接",
    "bounty.quote_rejected": "驳回申请",
    "bounty.quote_returned": "退回重审",
    "bounty.quote_closed": "申请结束",
}


def attachment_data(row):
    return {
        "id": str(row.id),
        "name": row.name,
        "size": row.size,
        "download_path": f"bounties/{row.bounty_id}/quote-attachments/{row.id}/",
    }


def quote_data(row, user):
    lead = quotes.is_lead(user, row.bounty)
    reviewer = quotes.is_quote_reviewer(user, row)
    snapshot = quotes.budget_snapshot(row.bounty) if lead or reviewer else None
    history = Audit.objects.filter(object_id=row.id, action__in=LABELS).order_by("created_at", "id")
    return {
        "id": str(row.id),
        "user_id": str(row.user_id_snapshot),
        "name": row.user_name,
        "revision": row.revision,
        "kind": row.kind,
        "vc": str(row.vc),
        "deliverable": row.deliverable,
        "basis": row.basis,
        "status": row.status,
        "available_at_submission": str(row.available_at_submission),
        "created_at": row.created_at.isoformat(),
        "reviewer_id": str(row.reviewer_id) if row.reviewer_id else None,
        "allocation_id": str(row.allocation_id) if row.allocation_id else None,
        "attachments": [attachment_data(item) for item in row.attachments.all()],
        "history": [
            {
                "id": str(item.id),
                "label": LABELS[item.action],
                "actor": item.actor_name,
                "created_at": item.created_at.isoformat(),
                "reason": item.details.get("reason", ""),
            }
            for item in history
        ],
        "budget_snapshot": snapshot,
        "adjustment": quotes.adjustment(row, snapshot) if snapshot else None,
        "can_approve": lead and row.bounty.status == "open" and row.status == "pending",
        "can_reject": lead and row.bounty.status == "open" and row.status in quotes.PENDING,
        "can_review": reviewer and row.bounty.status == "open" and row.status == "pending_review",
    }


class BountyQuotesView(LabView):
    def get(self, request, slug, pk):
        bounty = bounty_access(request.user, self.workspace, pk)
        lead = quotes.is_lead(request.user, bounty)
        reviewers = []
        if lead:
            members = (
                ProjectMember.objects.filter(
                    project=bounty.stage.project,
                    is_active=True,
                    role__gte=15,
                    member__is_active=True,
                    member__member_workspace__workspace=self.workspace,
                    member__member_workspace__is_active=True,
                )
                .exclude(member_id__in=Allocation.objects.filter(bounty=bounty, approved=True).values("user_id"))
                .select_related("member")
            )
            reviewers = [{"id": str(row.member_id), "name": row.member.display_name} for row in members.distinct()]
        return Response(
            {
                "quotes": [
                    quote_data(row, request.user)
                    for row in sorted(
                        quotes.visible_quotes(request.user, bounty),
                        key=lambda row: (row.created_at, str(row.id)),
                        reverse=True,
                    )
                ],
                "can_apply": quotes.can_apply(request.user, bounty),
                "available": str(quotes.bounties.claim_available(bounty)),
                "reviewers": reviewers,
                "file_size_limit": settings.FILE_SIZE_LIMIT,
            }
        )

    def post(self, request, slug, pk):
        bounty = bounty_access(request.user, self.workspace, pk)
        row, created = quotes.submit_quote(request.user, bounty.id, request.data)
        return Response(quote_data(row, request.user), status=201 if created else 200)


class BountyQuoteDecisionView(LabView):
    def post(self, request, slug, pk, quote_id, action):
        bounty = bounty_access(request.user, self.workspace, pk)
        row, conflict = quotes.decide_quote(request.user, bounty.id, quote_id, action, request.data)
        if conflict:
            return Response({"detail": "预算或分工已变化，已退回负责人重新审批"}, status=409)
        return Response(quote_data(row, request.user))
