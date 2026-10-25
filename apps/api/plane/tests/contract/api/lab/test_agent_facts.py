# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Conversation facts reflect real finance state without duplicate costs or private totals."""

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.exceptions import PermissionDenied

from plane.lab.agent_context import prepare_context
from plane.lab.agent_facts import finance_facts
from plane.lab.agent_views import _read_tool
from plane.lab.finance_models import FinancialAccount
from plane.lab.finance_services import balance
from .test_finance import plan, receipt
from .test_finance_permissions import grant
from .test_project_budgets import endpoint, payload
from .test_project_management import approve, audit_cost, cash, cost, ok, pay, payroll, post

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def facts(lab, user=None):
    return finance_facts(user or lab["lead"], lab["project"])


def step_names(value):
    return {step["action"] for step in value["workflow"]["next_steps"]}


def test_budget_receipt_labor_payroll_and_payment_are_distinct_states(laboratory):
    lab = laboratory
    response = lab["client"](lab["lead"]).post(endpoint(lab), payload(), format="json")
    assert response.status_code == 201, response.content
    value = facts(lab)
    assert value["workflow"]["budget"] == "1900.30"
    assert value["workflow"]["received"] == value["available"] == "0.00"
    stage, _ = plan(lab)
    receipt(lab, stage, gross="5000", costs="0", D="1000")
    account = FinancialAccount.objects.get(project=lab["project"], kind="project")
    value = facts(lab)
    assert value["workflow"]["received"] == "5000.00"
    assert value["available"] == "4000.00"
    row = cost(lab)
    value = facts(lab)
    assert value["workflow"]["labor_pending_review"] == 1
    assert value["workflow"]["labor_ready_for_payroll"] == 0
    assert value["workflow"]["recognized_cost"] == "0.00"
    assert step_names(value) == {"review_labor"}
    approve(lab, row)
    value = facts(lab)
    assert value["workflow"]["recognized_cost"] == "800.80"
    assert value["workflow"]["labor_pending_review"] == 0
    assert value["workflow"]["labor_ready_for_payroll"] == 1
    assert step_names(value) == {"create_payroll"}
    wages = ok(payroll(lab))
    value = facts(lab)
    assert value["pending_payroll"] == "800.80"
    assert value["workflow"]["labor_ready_for_payroll"] == 0
    assert value["workflow"]["recognized_cost"] == "800.80"
    assert step_names(value) == {"pay_payroll"}
    record = next(item for item in value["finance_records"] if item["id"] == wages["id"])
    assert record["kind"] == "payroll" and record["state"] == "ready" and record["version"] == wages["version"]
    ok(pay(lab, wages, account))
    value = facts(lab)
    assert value["pending_payroll"] == "0.00" and value["workflow"]["payroll_ready_count"] == 0
    assert value["workflow"]["labor_ready_for_payroll"] == 0
    assert value["workflow"]["recognized_cost"] == "800.80"
    assert value["available"] == "3199.20" and balance(account) == Decimal("3199.20")
    assert not step_names(value)
    context = prepare_context({"project_facts": value})["project_facts"]
    assert context["workflow"]["currency"] == "CNY"
    assert context["workflow"]["vc_currency"] == "VC"
    assert context["workflow"]["vc_cash_conversion"] is None


def test_cancelled_payroll_is_not_debt_and_releases_labor_for_regeneration(laboratory):
    lab = laboratory
    approve(lab, cost(lab))
    wages = ok(payroll(lab))
    cancelled = ok(post(lab, "payroll", row=wages, action="cancel"))
    value = facts(lab)
    assert value["pending_payroll"] == "0.00"
    assert value["workflow"]["payroll_ready_count"] == 0
    assert value["workflow"]["labor_ready_for_payroll"] == 1
    assert value["workflow"]["recognized_cost"] == "800.80"
    assert step_names(value) == {"create_payroll"}
    new = ok(payroll(lab))
    value = facts(lab)
    assert new["id"] != cancelled["id"]
    assert value["pending_payroll"] == "800.80"
    assert value["workflow"]["payroll_ready_count"] == 1
    assert value["workflow"]["recognized_cost"] == "800.80"


def test_view_only_reader_sees_real_cash_without_payment_permissions(laboratory):
    lab = laboratory
    cash(lab, amount="1234.56")
    approve(lab, cost(lab, hours="1", rate="20"))
    ok(payroll(lab))
    assert grant(lab, lab["independent"], ["view"]).status_code == 200
    value = facts(lab, lab["independent"])
    assert value["available"] == "1234.56"
    assert value["workflow"]["scope"] == "project"
    assert value["pending_payroll"] == "20.00"
    assert value["workflow"]["received"] == "0.00", "Opening cash is not a new receipt"
    assert value["workflow"]["next_steps"] == [{"action": "pay_payroll", "count": 1, "can_act": False}]
    tool = _read_tool("get_finance_summary", lab["project"], [], lab["independent"])
    assert tool["cash_available"] == value["available"]
    assert tool["workflow"] == value["workflow"]


def test_member_facts_contain_only_their_work_and_no_project_amounts(laboratory):
    lab = laboratory
    cash(lab, amount="9876.54")
    mine = approve(lab, cost(lab, hours="1", rate="11", work="本人工作"))
    own_wages = ok(payroll(lab))
    other = approve(lab, cost(lab, user=lab["independent"], hours="2", rate="77", work="同事私有工作"))
    other_wages = ok(
        post(
            lab,
            "payroll",
            {
                "user_id": str(lab["independent"].id),
                "start": "2026-10-01",
                "end": "2026-10-31",
            },
        )
    )
    value = facts(lab, lab["member"])
    assert value["workflow"]["scope"] == "self"
    assert value["available"] is None
    assert all(value["workflow"][key] is None for key in ("received", "budget", "recognized_cost", "cash_available"))
    assert value["pending_payroll"] == "11.00" and value["workflow"]["payroll_ready_count"] == 1
    assert {item["id"] for item in value["finance_records"]} == {mine["id"], own_wages["id"]}
    serialized = json.dumps(value, ensure_ascii=False)
    assert other["id"] not in serialized and other_wages["id"] not in serialized
    assert "同事私有工作" not in serialized and "9876.54" not in serialized
    with pytest.raises(PermissionDenied):
        _read_tool("get_finance_summary", lab["project"], [], lab["member"])


def test_old_payroll_identity_survives_newer_paid_labor_history(laboratory):
    lab = laboratory
    source = cash(lab)
    approve(lab, cost(lab, date="2026-09-01", hours="1", rate="19"))
    old = ok(post(lab, "payroll", {"user_id": str(lab["member"].id), "start": "2026-09-01", "end": "2026-09-01"}))
    for index in range(25):
        day = (date(2026, 10, 1) + timedelta(days=index)).isoformat()
        approve(lab, cost(lab, date=day, hours="1", rate="1"))
        wages = ok(post(lab, "payroll", {"user_id": str(lab["member"].id), "start": day, "end": day}))
        ok(pay(lab, wages, source))
    value = facts(lab)
    assert value["pending_payroll"] == "19.00" and value["workflow"]["payroll_ready_count"] == 1
    assert value["finance_records_truncated"] is True
    assert any(item["id"] == old["id"] and item["version"] == old["version"] for item in value["finance_records"])
    # The identifier must also survive the smaller context budget given to the model.
    context = prepare_context({"project_facts": value})["project_facts"]
    assert any(item.get("id") == old["id"] for item in context["finance_records"])


@pytest.mark.parametrize("category,action", [("labor", "create_payroll"), ("equipment", "pay_reimbursement")])
def test_zero_after_audit_is_not_offered_as_a_payable_next_step(laboratory, category, action):
    lab = laboratory
    row = approve(lab, cost(lab, category=category))
    audit_cost(lab, row, "0")
    value = facts(lab)
    assert value["workflow"]["recognized_cost"] == "0.00"
    record = next(item for item in value["finance_records"] if item["id"] == row["id"])
    assert record["amount"] == "0.00"
    assert action not in step_names(value)


def test_archived_project_preserves_debt_but_does_not_offer_payment_as_actionable(laboratory):
    from django.utils import timezone
    from plane.db.models import Project

    lab = laboratory
    source = cash(lab)
    approve(lab, cost(lab))
    wages = ok(payroll(lab))
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now())
    lab["project"].refresh_from_db()
    assert pay(lab, wages, source).status_code == 400
    value = facts(lab)
    assert value["pending_payroll"] == "800.80"
    assert value["workflow"]["next_steps"] == [{"action": "pay_payroll", "count": 1, "can_act": False}]
