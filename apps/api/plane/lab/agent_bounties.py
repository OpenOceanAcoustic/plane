# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only

"""Read-only cash bounty facts, scoped exactly like the cash bounty page."""

from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework.exceptions import ValidationError

from .cash_bounties import row_data, visible_cash_bounties
from .models import CashBounty


def cash_bounty_facts(user, workspace, project=None, *, query="", status=""):
    rows = visible_cash_bounties(user, workspace)
    if project is not None:
        rows = rows.filter(project=project)
    query = str(query or "").strip()[:100]
    if query:
        rows = rows.filter(Q(title__icontains=query) | Q(project__name__icontains=query))
    if status:
        if status not in CashBounty.STATUSES:
            raise ValidationError("现金悬赏状态无效")
        rows = rows.filter(status=status)
    rows = rows.select_related("project", "publisher", "reviewer", "claimed_by").order_by(
        Case(
            When(status="open", then=Value(0)),
            When(status__in=("claimed", "submitted", "accepted"), then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
        "-created_at",
        "id",
    )
    count = rows.count()
    items = []
    for row in rows[:20]:
        data = row_data(row, user)
        items.append(
            {
                "id": str(row.id),
                "kind": "cash",
                "project_id": str(row.project_id),
                "project": row.project.name,
                "title": row.title,
                "amount": str(row.amount),
                "unit": "¥",
                "status": row.status,
                "can_claim": data["can_claim"],
                "deliverable": row.deliverable,
                "criteria": row.criteria,
                "url": f"/{workspace.slug}/lab/cash?bounty_id={row.id}",
            }
        )
    return {
        "available": True,
        "scope": "project" if project else "workspace",
        "project_id": str(project.id) if project else None,
        "count": count,
        "truncated": count > len(items),
        "items": items,
    }
