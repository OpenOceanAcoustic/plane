# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Current, permission-scoped finance facts for conversation and read tools."""

from decimal import Decimal

from .finance_models import FinancialAccount
from .finance_services import available
from .project_management import finance_overview


def finance_facts(user, project, overview=None):
    overview = finance_overview(user, project) if overview is None else overview
    records = overview.get("records", [])
    can_view = bool(overview.get("can_view_finance"))
    cash = None
    if can_view:
        cash = sum(
            (
                available(row)
                for row in FinancialAccount.objects.filter(
                    workspace=project.workspace, project_id_snapshot=project.id, kind="project"
                )
            ),
            Decimal("0"),
        )
    labor_pending = [
        row
        for row in records
        if row["kind"] == "cost" and row["state"] == "submitted" and row["data"].get("category") == "labor"
    ]

    def recognized_amount(row):
        value = row.get("recognized_amount")
        return Decimal(str(value if value is not None else row["data"].get("amount") or "0"))

    labor_ready = [
        row
        for row in records
        if row["kind"] == "cost"
        and row["state"] == "approved"
        and row["data"].get("category") == "labor"
        and not row.get("payroll_id")
        and recognized_amount(row) > 0
    ]
    payroll_ready = [row for row in records if row["kind"] == "payroll" and row["state"] == "ready"]
    costs_ready = [
        row
        for row in records
        if row["kind"] == "cost"
        and row["state"] == "approved"
        and row["data"].get("category") != "labor"
        and recognized_amount(row) > 0
    ]
    due = sum((Decimal(str(row["data"].get("amount") or "0")) for row in payroll_ready), Decimal("0"))
    # Prefer pending work so old unpaid wages survive a stream of newer closed records.
    visible = [row for row in records if row["kind"] in ("cost", "payroll")]
    priorities = {}
    for priority, group in enumerate((payroll_ready, costs_ready, labor_pending, labor_ready)):
        priorities.update({row["id"]: priority for row in group})
    visible.sort(key=lambda row: priorities.get(row["id"], 4))
    summary = overview.get("summary")
    flow = {
        "scope": "project" if can_view else "self",
        "currency": "CNY",
        "vc_currency": "VC",
        "vc_cash_conversion": None,
        "closed": bool(overview.get("closed")),
        "received": summary.get("received") if summary else None,
        "budget": summary.get("budget") if summary else None,
        "recognized_cost": summary.get("cost") if summary else None,
        "cash_available": f"{cash:.2f}" if cash is not None else None,
        "labor_pending_review": len(labor_pending),
        "labor_ready_for_payroll": len(labor_ready),
        "payroll_ready_count": len(payroll_ready),
        "payroll_ready_amount": f"{due:.2f}",
        "reimbursements_ready_count": len(costs_ready),
        "next_steps": [],
    }
    if labor_pending:
        flow["next_steps"].append(
            {"action": "review_labor", "count": len(labor_pending), "can_act": bool(overview.get("can_approve"))}
        )
    if labor_ready:
        flow["next_steps"].append(
            {"action": "create_payroll", "count": len(labor_ready), "can_act": bool(overview.get("can_approve"))}
        )
    if payroll_ready:
        flow["next_steps"].append(
            {"action": "pay_payroll", "count": len(payroll_ready), "can_act": bool(overview.get("can_pay"))}
        )
    if costs_ready:
        flow["next_steps"].append(
            {"action": "pay_reimbursement", "count": len(costs_ready), "can_act": bool(overview.get("can_pay"))}
        )
    if overview.get("closed"):
        for step in flow["next_steps"]:
            step["can_act"] = False
    return {
        "workflow": flow,
        "available": flow["cash_available"],
        "pending_payroll": flow["payroll_ready_amount"],
        "finance_record_count": len(visible),
        "finance_records_truncated": len(visible) > 24,
        "finance_records": [
            {
                "id": row["id"],
                "kind": row["kind"],
                "state": row["state"],
                "version": row["version"],
                "title": row["data"].get("work") or ("工资单" if row["kind"] == "payroll" else ""),
                "date": row["data"].get("date") or row["data"].get("start") or "",
                "hours": row["data"].get("hours") or "",
                "amount": str(recognized_amount(row)) if row["kind"] == "cost" else row["data"].get("amount") or "",
                "user_name": row["data"].get("user_name") or "",
                "payroll_id": row.get("payroll_id"),
            }
            for row in visible[:24]
        ],
    }
