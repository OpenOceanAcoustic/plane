# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""AI confirmations obey the same finance and task boundaries as direct actions."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import ProjectMember
from plane.lab.agent_views import execute_agent_action
from plane.lab.finance_models import FinancialOperation
from plane.lab.finance_services import balance
from plane.lab.management_models import latest_records
from plane.lab.models import AgentAction, AgentAnnotation, AgentThread, Allocation, Bounty, CashBounty
from .test_bounties import action as bounty_action, prepare, start
from .test_finance import act
from .test_project_management import cash, cost, ok, post

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def prepared(lab, kind, target_type="cost", target_id="", payload=None, user=None):
    user = user or lab["lead"]
    thread = AgentThread.objects.create(workspace=lab["workspace"], project=lab["project"], user=user)
    return AgentAction.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        user=user,
        thread=thread,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        payload=payload or {},
        expires_at=timezone.now() + timedelta(minutes=10),
    )


def execute(lab, action, user=None):
    return lab["client"](user or lab["lead"]).post(
        lab["base"] + f"agent/actions/{action.id}/execute/", {}, format="json"
    )


def mock_chat(monkeypatch, payload):
    import plane.lab.agent_views as views

    monkeypatch.setattr(views, "_config", lambda: ("test", "http://llm.invalid", "test"))
    monkeypatch.setattr(views, "_redis_counter", lambda *args: 1)
    monkeypatch.setattr(views, "_call_deepseek", lambda *args, **kwargs: payload)
    monkeypatch.setattr(views, "_call_deepseek_tools", lambda *args, **kwargs: payload)


def chat(lab, user, message, **extra):
    return lab["client"](user).post(
        lab["base"] + "agent/chat/", {"project_id": str(lab["project"].id), "message": message, **extra}, format="json"
    )


def test_team_vc_cannot_be_paid_as_cash_even_by_finance_owner(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    allocation = start(lab, bounty)
    source = cash(lab)
    before = balance(source)
    draft = prepared(lab, "bounty_team_action", "team_bounty", bounty, {"action": "pay", "allocation_id": allocation})
    response = execute(lab, draft)
    assert response.status_code == 400, response.content
    assert "VC" in str(response.json())
    assert balance(source) == before
    assert not FinancialOperation.objects.filter(kind="expense").exists()
    assert Allocation.objects.get(id=allocation).paid_at is None
    draft.refresh_from_db()
    assert draft.status == "prepared"


def test_team_payment_request_guides_to_cash_settlement_without_action(laboratory, monkeypatch):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    mock_chat(monkeypatch, {"intent": "bounty_team", "bounty_team": {"bounty_id": bounty, "action": "pay"}})
    response = chat(lab, lab["lead"], "发放团队悬赏奖金")
    assert response.status_code == 200, response.content
    assert response.json()["intent"] == "query"
    assert "核准人民币" in response.json()["reply"]
    assert not AgentAction.objects.exists()


def test_designated_reviewer_can_prepare_and_confirm_team_acceptance(laboratory, monkeypatch):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    start(lab, bounty)
    assert bounty_action(lab, lab["member"], bounty, "submit", {"evidence": "dataset:v1"}).status_code == 200
    mock_chat(
        monkeypatch,
        {"intent": "bounty_team", "bounty_team": {"bounty_id": bounty, "action": "accept", "note": "核查通过"}},
    )
    response = chat(lab, lab["reviewer"], "验收团队悬赏")
    assert response.status_code == 200, response.content
    draft = AgentAction.objects.get(id=response.json()["draft"]["action_id"])
    assert execute(lab, draft, lab["reviewer"]).status_code == 200
    assert Bounty.objects.get(id=bounty).status == "done"


def test_lead_is_not_automatically_the_designated_acceptance_reviewer(laboratory, monkeypatch):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    mock_chat(monkeypatch, {"intent": "bounty_team", "bounty_team": {"bounty_id": bounty, "action": "accept"}})
    response = chat(lab, lab["lead"], "验收团队悬赏")
    assert response.status_code == 403, response.content
    assert not AgentAction.objects.exists()


def test_cost_approval_rejects_a_new_submitted_revision(laboratory):
    lab = laboratory
    row = cost(lab)
    draft = prepared(lab, "approve_cost", target_id=row["id"], payload={"expected_version": row["version"]})
    revised = ok(post(lab, "cost", {**row["data"], "hours": "9"}, row=row))
    response = execute(lab, draft)
    assert response.status_code == 400, response.content
    current = latest_records(lab["project"].id).get(object_key=row["id"])
    assert current.version == revised["version"] and current.state == "submitted"


def test_batch_approval_is_atomic_when_a_later_record_is_stale(laboratory):
    lab = laboratory
    first = cost(lab, date="2026-10-17")
    second = cost(lab)
    draft = prepared(
        lab,
        "batch_approve_cost",
        "cost_batch",
        first["id"],
        {
            "record_ids": [first["id"], second["id"]],
            "expected_versions": {first["id"]: first["version"], second["id"]: second["version"]},
        },
    )
    ok(post(lab, "cost", {**second["data"], "hours": "9"}, row=second))
    response = execute(lab, draft)
    assert response.status_code == 400, response.content
    assert latest_records(lab["project"].id).get(object_key=first["id"]).state == "submitted"
    draft.refresh_from_db()
    assert draft.status == "prepared"


def test_approval_preparation_keeps_the_version_shown_to_user(laboratory, monkeypatch):
    lab = laboratory
    row = cost(lab)
    mock_chat(monkeypatch, {"intent": "approval", "approval": {"record_id": row["id"], "decision": "approved"}})
    response = chat(lab, lab["lead"], "批准这条工时")
    assert response.status_code == 200, response.content
    draft = AgentAction.objects.get(id=response.json()["draft"]["action_id"])
    assert draft.payload["expected_version"] == row["version"]


def test_confirmations_are_serialized_and_do_not_duplicate_annotations(laboratory):
    lab = laboratory
    row = cost(lab)
    draft = prepared(
        lab, "annotate_cost", target_id=row["id"], payload={"note": "核对凭证", "expected_version": row["version"]}
    )
    barrier = Barrier(2)

    def confirm():
        close_old_connections()
        try:
            action = AgentAction.objects.get(id=draft.id)
            barrier.wait(timeout=10)
            return execute_agent_action(action, lab["lead"], lab["workspace"])
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: confirm(), range(2)))
    assert all(result["status"] == "executed" for result in results)
    assert AgentAnnotation.objects.filter(target_id=row["id"]).count() == 1


def test_action_execution_rechecks_revoked_project_membership(laboratory):
    lab = laboratory
    row = cost(lab)
    draft = prepared(
        lab, "annotate_cost", target_id=row["id"], payload={"note": "备注", "expected_version": row["version"]}
    )
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(is_active=False)
    assert execute(lab, draft).status_code == 403
    assert not AgentAnnotation.objects.exists()


def test_unassigned_query_forces_a_read_tool_without_preparing_assignment(laboratory, monkeypatch):
    import plane.lab.agent_views as views

    lab = laboratory
    mock_chat(monkeypatch, {"intent": "query", "reply": "没有待指派工作项"})
    calls = []

    def call(*args, **kwargs):
        calls.append(kwargs.get("forced_tool"))
        return {"intent": "query", "reply": "没有待指派工作项"}

    monkeypatch.setattr(views, "_call_deepseek_tools", call)
    response = chat(lab, lab["lead"], "查看有哪些无人负责的工作项")
    assert response.status_code == 200, response.content
    assert calls == ["list_unassigned_issues"]
    assert not AgentAction.objects.exists()


def test_linked_cash_bounty_payment_cannot_be_reversed_without_task_state(laboratory):
    lab = laboratory
    source = cash(lab)
    row = CashBounty.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        title="现金任务",
        deliverable="数据",
        amount="20",
        status="accepted",
        publisher=lab["lead"],
        reviewer=lab["lead"],
        claimed_by=lab["member"],
        evidence="dataset:v1",
    )
    response = lab["client"](lab["lead"]).post(lab["base"] + f"cash-bounties/{row.id}/pay/", {}, format="json")
    assert response.status_code == 200, response.content
    row.refresh_from_db()
    before = balance(source)
    response = act(lab, "reverse", {"operation_id": str(row.payment_operation_id), "evidence": "bank:correction"})
    assert response.status_code == 400, response.content
    assert balance(source) == before
    row.refresh_from_db()
    assert row.status == "paid" and row.paid_at is not None


def test_quote_confirmation_uses_the_budget_snapshot_shown_in_the_draft(laboratory, monkeypatch):
    from .test_bounty_quotes import submit_quote

    lab = laboratory
    bounty, _, _ = prepare(lab)
    response = submit_quote(lab, bounty)
    assert response.status_code == 201, response.content
    quote_id = response.json()["id"]
    mock_chat(
        monkeypatch,
        {
            "intent": "bounty_quote_review",
            "bounty_quote_review": {"bounty_id": bounty, "quote_id": quote_id, "decision": "approve"},
        },
    )
    response = chat(lab, lab["lead"], "批准这个团队悬赏报价")
    assert response.status_code == 200, response.content
    draft = AgentAction.objects.get(id=response.json()["draft"]["action_id"])
    assert draft.payload["expected_budget"]["allocations"] == []
    claimed = bounty_action(lab, lab["independent"], bounty, "claim", {"planned": "5", "deliverable": "补充分析"})
    assert claimed.status_code == 200, claimed.content
    assert (
        bounty_action(lab, lab["lead"], bounty, "approve", {"allocation_id": claimed.json()["id"]}).status_code == 200
    )
    response = execute(lab, draft)
    assert response.status_code == 409, response.content
    assert not Allocation.objects.filter(bounty_id=bounty, user=lab["member"]).exists()


def test_legacy_team_cash_payment_is_protected_from_unlinked_reversal(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    allocation = Allocation.objects.get(id=start(lab, bounty))
    source = cash(lab)
    payment = act(
        lab,
        "expense",
        {
            "account_id": str(source.id),
            "amount": "20",
            "purpose": "历史团队奖金",
            "evidence": "bank:legacy-payment",
        },
    )
    assert payment.status_code == 200, payment.content
    allocation.payment_operation_id = payment.json()["operation_id"]
    allocation.paid_at = timezone.now()
    allocation.save(update_fields=["payment_operation", "paid_at"])
    before = balance(source)
    response = act(
        lab, "reverse", {"operation_id": str(allocation.payment_operation_id), "evidence": "bank:correction"}
    )
    assert response.status_code == 400, response.content
    assert balance(source) == before


def test_member_cannot_prepare_an_annotation_revealing_another_members_cost(laboratory, monkeypatch):
    lab = laboratory
    other = cost(lab, user=lab["independent"], work="私有费用内容")
    mock_chat(monkeypatch, {"intent": "annotate", "annotation": {"record_id": other["id"], "note": "请核对"}})
    response = chat(lab, lab["member"], "批注这条费用")
    assert response.status_code == 200, response.content
    assert response.json()["intent"] == "needs_input"
    assert "私有费用内容" not in response.content.decode()
    assert not AgentAction.objects.exists()


def test_annotation_rechecks_record_visibility_when_finance_grant_is_revoked(laboratory):
    from .test_finance_permissions import grant

    lab = laboratory
    other = cost(lab, user=lab["independent"])
    assert grant(lab, lab["member"], ["view"]).status_code == 200
    draft = prepared(
        lab,
        "annotate_cost",
        target_id=other["id"],
        user=lab["member"],
        payload={
            "note": "核对",
            "expected_version": other["version"],
        },
    )
    assert grant(lab, lab["member"], []).status_code == 200
    assert execute(lab, draft, lab["member"]).status_code == 403
    assert not AgentAnnotation.objects.exists()


def test_explicit_missing_approval_target_does_not_select_another_record(laboratory, monkeypatch):
    import uuid

    lab = laboratory
    cost(lab)
    mock_chat(monkeypatch, {"intent": "approval", "approval": {"record_id": str(uuid.uuid4()), "decision": "approved"}})
    response = chat(lab, lab["lead"], "批准指定的工时记录")
    assert response.status_code == 200, response.content
    assert response.json()["intent"] == "needs_input"
    assert not AgentAction.objects.exists()
