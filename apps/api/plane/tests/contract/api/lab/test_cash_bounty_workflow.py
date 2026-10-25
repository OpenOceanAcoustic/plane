# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only
from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.lab import agent_views
from plane.lab.models import AgentAction, AgentThread, CashBounty
from plane.lab.finance_models import FinancialOperation
from plane.lab.finance_services import balance
from .test_project_receipts import received, project_account

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def task(lab, **extra):
    return {
        "project_id": str(lab["project"].id),
        "title": "现金悬赏页面人工测试",
        "amount": "5.00",
        "target": "/lab/lab/cash，桌面和手机浏览器",
        "steps": "切换筛选，查看详情，检查长文本布局",
        "deliverable": "浏览器版本、复现步骤、截图和覆盖清单",
        "criteria": "桌面和手机各一轮，每个问题可重现",
        **extra,
    }


def publish(lab, **extra):
    response = lab["client"](lab["lead"]).post(lab["base"] + "cash-bounties/", task(lab, **extra), format="json")
    assert response.status_code == 201, response.content
    return response.json()["id"]


def action(lab, pk, name, user=None, **data):
    return lab["client"](user or lab["lead"]).post(lab["base"] + f"cash-bounties/{pk}/{name}/", data, format="json")


@pytest.mark.parametrize("field", ["target", "steps", "deliverable", "criteria"])
def test_publishing_requires_actionable_scope_steps_deliverable_and_acceptance(laboratory, field):
    lab = laboratory
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "cash-bounties/", task(lab, **{field: "  "}), format="json"
    )
    assert response.status_code == 400
    assert not CashBounty.objects.exists()


def test_full_fixed_cash_workflow_keeps_acceptance_separate_from_payment(laboratory):
    lab = laboratory
    received(lab, gross="11", costs="0")
    source = project_account(lab)
    pk = publish(lab)
    row = CashBounty.objects.get(id=pk)
    assert "/lab/lab/cash" in row.deliverable and "操作步骤" in row.deliverable and "覆盖清单" in row.deliverable
    assert row.criteria == task(lab)["criteria"]
    assert action(lab, pk, "claim", lab["member"], amount="1").status_code == 200
    row.refresh_from_db()
    assert row.amount == Decimal("5")
    assert action(lab, pk, "submit", lab["member"], evidence="合成测试报告及截图").status_code == 200
    assert action(lab, pk, "accept", lab["member"]).status_code == 403
    assert action(lab, pk, "pay", payment_evidence="synthetic-transfer").status_code == 400
    assert action(lab, pk, "accept", note="测试报告符合约定").status_code == 200
    assert balance(source) == Decimal("11") and not FinancialOperation.objects.filter(kind="expense").exists()
    assert action(lab, pk, "pay", lab["member"], payment_evidence="fake").status_code == 403
    assert action(lab, pk, "pay").status_code == 400
    proof = "流程测试记账，未实际转账，合成凭证 TEST-001"
    result = action(lab, pk, "pay", payment_evidence=proof)
    assert result.status_code == 200, result.content
    row.refresh_from_db()
    assert row.status == "paid" and row.paid_at and row.accepted_at
    assert balance(source) == Decimal("6")
    operation = row.payment_operation
    assert operation.evidence == proof and operation.evidence != row.evidence
    assert operation.payload["payee_id"] == str(lab["member"].id)
    assert result.json()["payment_operation_id"] == str(operation.id)
    assert action(lab, pk, "pay").status_code == 200
    assert balance(source) == Decimal("6") and FinancialOperation.objects.filter(kind="expense").count() == 1


def test_failed_payment_leaves_accepted_task_unpaid_and_does_not_write_expense(laboratory):
    lab = laboratory
    received(lab, gross="1", costs="0")
    pk = publish(lab)
    assert action(lab, pk, "claim", lab["member"]).status_code == 200
    assert action(lab, pk, "submit", lab["member"], evidence="合成报告").status_code == 200
    assert action(lab, pk, "accept", note="验收通过").status_code == 200
    response = action(lab, pk, "pay", payment_evidence="流程测试记账，未实际转账")
    assert response.status_code == 400
    row = CashBounty.objects.get(id=pk)
    assert row.status == "accepted" and row.paid_at is None and row.payment_operation_id is None
    assert balance(project_account(lab)) == Decimal("1")
    assert not FinancialOperation.objects.filter(kind="expense").exists()


def prepared(lab, kind, payload, target=""):
    thread = AgentThread.objects.create(
        workspace=lab["workspace"], project=lab["project"], user=lab["lead"], title="合成测试"
    )
    return AgentAction.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        user=lab["lead"],
        thread=thread,
        kind=kind,
        target_type="cash_bounty",
        target_id=target,
        payload=payload,
        expires_at=timezone.now() + timedelta(minutes=10),
    )


def test_confirming_an_incomplete_ai_draft_cannot_publish_a_vague_bounty(laboratory):
    lab = laboratory
    payload = task(lab)
    payload.pop("steps")
    draft = prepared(lab, "bounty_create", payload)
    with pytest.raises(ValidationError):
        agent_views.execute_bounty_action(draft, lab["lead"], lab["workspace"])
    assert not CashBounty.objects.exists()
    draft.payload = task(lab)
    draft.save(update_fields=["payload"])
    result = agent_views.execute_bounty_action(draft, lab["lead"], lab["workspace"])
    row = CashBounty.objects.get(id=result["result"]["id"])
    assert row.status == "open" and "操作步骤" in row.deliverable


def test_ai_asks_for_missing_scope_and_steps_before_creating_an_action(laboratory, monkeypatch):
    lab = laboratory
    monkeypatch.setattr(agent_views, "_config", lambda: ("test", "test", "test"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    model = Mock(
        return_value={
            "intent": "cash_bounty",
            "bounty": {"action": "create", "title": "UI点击测试", "amount": "5", "deliverable": "一个可用页面"},
        }
    )
    monkeypatch.setattr(agent_views, "_call_deepseek_tools", model)
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "agent/chat/", {"project_id": str(lab["project"].id), "message": "发布5元现金悬赏"}, format="json"
    )
    assert response.status_code == 200, response.content
    assert response.data["intent"] == "needs_input"
    assert all(label in response.data["question"] for label in ("任务入口与范围", "操作步骤", "验收标准"))
    assert not AgentAction.objects.exists() and not CashBounty.objects.exists()
