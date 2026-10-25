# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Real finance/API narrative with deterministic model responses, not a live-model E2E."""

from decimal import Decimal

import pytest

from plane.lab.agent_facts import finance_facts
from plane.lab.finance_models import FinancialAccount, FinancialOperation
from plane.lab.finance_services import balance
from plane.lab.management_models import latest_records
from plane.lab.models import AgentAction
from .test_agent_actions import chat, mock_chat
from .test_finance import act, receipt
from .test_finance_permissions import grant
from .test_next_actions import actions
from .test_project_budgets import endpoint, payload
from .test_project_management import overview

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def confirm(lab, user, message):
    message_id = message["message_id"]
    response = lab["client"](user).post(lab["base"] + f"agent/messages/{message_id}/confirm/", {}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "executed"
    return response.json()


def test_receipt_to_member_time_lead_review_payroll_and_delegated_payment(laboratory, monkeypatch):
    lab = laboratory
    lead = lab["client"](lab["lead"])
    budget = lead.post(endpoint(lab), payload(), format="json")
    assert budget.status_code == 201, budget.content
    stage = lead.post(
        lab["base"] + "stages/",
        {"project_id": str(lab["project"].id), "name": "工作流验收阶段", "budget": "1000"},
        format="json",
    )
    assert stage.status_code == 201, stage.content
    configured = act(
        lab,
        "stage",
        {
            "stage_id": stage.json()["id"],
            "E": "1000",
            "purposes": [{"name": "执行奖励", "amount": "1000"}],
            "members": [{"user_id": str(lab["member"].id), "b": "0.5", "r": "0.4", "planned_vc": "100"}],
            "upgraded": False,
            "history": [],
        },
    )
    assert configured.status_code == 200, configured.content
    receipt(lab, stage.json()["id"], gross="5000", costs="0", D="1000")
    account = FinancialAccount.objects.get(project=lab["project"], kind="project")
    assert balance(account) == Decimal("4000.00")

    # The ordinary member drafts and confirms their own work; no finance mutation is mocked.
    mock_chat(
        monkeypatch,
        {
            "intent": "time_entry",
            "time": {
                "user_id": str(lab["member"].id),
                "date": "2026-10-23",
                "hours": "2",
                "rate": "100",
                "work": "核对声学标注与质量记录",
            },
        },
    )
    response = chat(lab, lab["member"], "登记工时：今天核对声学标注与质量记录2小时，每小时100元")
    assert response.status_code == 200, response.content
    time_message = response.json()
    assert time_message["draft"]["kind"] == "time"
    saved_time = confirm(lab, lab["member"], time_message)["records"][0]
    assert saved_time["state"] == "submitted" and saved_time["data"]["amount"] == "200.00"
    assert confirm(lab, lab["member"], time_message)["records"][0]["id"] == saved_time["id"]
    assert latest_records(lab["project"].id).filter(kind="cost").count() == 1
    assert finance_facts(lab["lead"], lab["project"])["workflow"]["labor_pending_review"] == 1

    # The lead confirms the version actually presented in the approval draft.
    mock_chat(
        monkeypatch,
        {
            "intent": "approval",
            "approval": {
                "record_id": saved_time["id"],
                "decision": "approved",
                "note": "成果与两小时投入已核对",
            },
        },
    )
    response = chat(lab, lab["lead"], "批准这条工时记录")
    assert response.status_code == 200, response.content
    approval = AgentAction.objects.get(id=response.json()["draft"]["action_id"])
    assert approval.payload["expected_version"] == saved_time["version"]
    executed = lead.post(lab["base"] + f"agent/actions/{approval.id}/execute/", {}, format="json")
    assert executed.status_code == 200, executed.content
    assert executed.json()["result"]["state"] == "approved"

    mock_chat(
        monkeypatch,
        {
            "intent": "payroll",
            "payroll": {
                "user_id": str(lab["member"].id),
                "start": "2026-10-23",
                "end": "2026-10-23",
            },
        },
    )
    response = chat(lab, lab["lead"], "为该成员生成10月23日工资单")
    assert response.status_code == 200, response.content
    wages = confirm(lab, lab["lead"], response.json())["records"][0]
    assert wages["state"] == "ready" and wages["data"]["amount"] == "200.00"
    assert overview(lab)["summary"]["cost"] == "200.00", "Payroll must not create another labor cost"

    # Payment authority is independently delegated; ordinary membership grants no payment rights.
    assert grant(lab, lab["independent"], ["pay"]).status_code == 200
    mock_chat(monkeypatch, {"intent": "payment", "payment": {"kind": "payroll", "record_ids": [wages["id"]]}})
    denied = chat(lab, lab["member"], "支付这张工资单")
    assert denied.status_code == 403, denied.content
    assert balance(account) == Decimal("4000.00")
    pending = actions(lab, lab["independent"])["items"]
    assert any(item["id"] == wages["id"] and item["action"] == "待付款" for item in pending)
    response = chat(lab, lab["independent"], "支付这张工资单")
    assert response.status_code == 200, response.content
    payment_message = response.json()
    assert payment_message["draft"]["kind"] == "payment"
    assert payment_message["draft"]["records"][0]["version"] == wages["version"]
    stolen = lab["client"](lab["member"]).post(
        lab["base"] + f"agent/messages/{payment_message['message_id']}/confirm/", {}, format="json"
    )
    assert stolen.status_code == 400 and balance(account) == Decimal("4000.00")
    paid = confirm(lab, lab["independent"], payment_message)
    repeated = confirm(lab, lab["independent"], payment_message)
    assert repeated["records"] == paid["records"]
    assert paid["records"][0]["state"] == "paid"
    assert balance(account) == Decimal("3800.00")
    assert FinancialOperation.objects.filter(kind="expense").count() == 1
    summary = overview(lab)["summary"]
    assert summary["received"] == "5000.00"
    assert summary["cost"] == summary["paid"] == "200.00"
    assert latest_records(lab["project"].id).filter(kind="payroll").count() == 1
    workflow = finance_facts(lab["lead"], lab["project"])["workflow"]
    assert workflow["payroll_ready_amount"] == "0.00"
    assert not workflow["next_steps"]
    assert not actions(lab, lab["lead"])["items"]
    assert not actions(lab, lab["independent"])["items"]
