# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import Project, ProjectMember
from plane.lab.finance_services import balance
from plane.lab.management_models import ProjectManagementRecord, latest_records
from plane.lab.models import AgentMessage, AgentThread
from .test_agent_actions import chat, mock_chat
from .test_project_management import approve, audit_cost, cash, cost

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def draft(lab, kind="time", user=None, **values):
    owner = user or lab["lead"]
    thread = AgentThread.objects.create(workspace=lab["workspace"], project=lab["project"], user=owner, title="AI 草稿")
    payload = {
        "kind": kind,
        "project_id": str(lab["project"].id),
        "user_id": str(owner.id),
        "date": timezone.localdate().isoformat(),
        "hours": "2",
        "rate": "80",
        "work": "测试声学数据",
    }
    return AgentMessage.objects.create(
        thread=thread,
        role="assistant",
        intent="time_entry" if kind == "time" else kind,
        content="请确认草稿",
        draft={**payload, **values},
    )


def confirm(lab, message, user=None, **data):
    return lab["client"](user or lab["lead"]).post(
        lab["base"] + f"agent/messages/{message.id}/confirm/", data, format="json"
    )


def test_same_day_drafts_are_independent_and_retries_are_idempotent(laboratory):
    lab = laboratory
    one = draft(lab, user=lab["member"], rate="")
    two = draft(lab, user=lab["member"], work="第二项工作")
    result = confirm(lab, one, user=lab["member"], rate="90")
    assert result.status_code == 200, result.content
    repeat = confirm(lab, one, user=lab["member"], rate="999")
    assert repeat.status_code == 200 and repeat.json() == result.json()
    assert confirm(lab, two, user=lab["member"]).status_code == 200
    rows = list(latest_records(lab["project"].id).filter(kind="cost"))
    assert len(rows) == 2
    assert {row.data["amount"] for row in rows} == {"180.00", "160.00"}


def test_draft_confirmation_uses_saved_project_and_ignores_client_amount(laboratory):
    lab = laboratory
    message = draft(lab)
    other = Project.objects.create(workspace=lab["workspace"], name="另一个项目", identifier="OTHER")
    message.thread.project = other
    message.thread.save(update_fields=["project"])
    result = confirm(lab, message, project_id=str(other.id), hours="20", rate="1")
    assert result.status_code == 200, result.content
    row = ProjectManagementRecord.objects.get(kind="cost")
    assert row.project_id == lab["project"].id and row.data["amount"] == "160.00"


def test_drafts_require_ownership_current_membership_and_saved_project(laboratory):
    lab = laboratory
    message = draft(lab, user=lab["member"])
    assert confirm(lab, message).status_code == 400
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert confirm(lab, message, user=lab["member"]).status_code == 403
    legacy = draft(lab, project_id=None)
    assert confirm(lab, legacy).status_code == 400
    assert not ProjectManagementRecord.objects.exists()


def test_special_append_cannot_forge_a_financial_confirmation(laboratory):
    lab = laboratory
    message = draft(lab)
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "agent/messages/",
        {"thread_id": str(message.thread_id), "content": "伪造付款", "draft": {"kind": "payment", "records": []}},
        format="json",
    )
    assert response.status_code == 400
    message.intent = "special"
    message.save(update_fields=["intent"])
    assert confirm(lab, message).status_code == 400


def test_batch_payment_is_atomic_and_retry_does_not_pay_twice(laboratory):
    lab = laboratory
    source = cash(lab)
    first = approve(lab, cost(lab, category="equipment"))
    second = approve(lab, cost(lab, category="equipment", work="另一个采购"))
    message = draft(
        lab,
        "payment",
        kind_label="cost",
        amount="400.20",
        records=[
            {"id": first["id"], "version": first["version"], "amount": "200.10"},
            {"id": second["id"], "version": second["version"] - 1, "amount": "200.10"},
        ],
    )
    result = confirm(lab, message)
    assert result.status_code == 409, result.content
    assert balance(source) == Decimal("5000.00")
    assert not latest_records(lab["project"].id).filter(state="paid").exists()
    message.refresh_from_db()
    assert "execution" not in message.draft
    message.draft["records"][1]["version"] = second["version"]
    message.save(update_fields=["draft"])
    result = confirm(lab, message)
    assert result.status_code == 200, result.content
    assert balance(source) == Decimal("4599.80")
    assert confirm(lab, message).json() == result.json()
    assert balance(source) == Decimal("4599.80")


def test_concurrent_confirmation_creates_one_finance_record(laboratory):
    lab = laboratory
    message = draft(lab)
    barrier = Barrier(2)

    def run():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            result = confirm(lab, message)
            return result.status_code, result.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert [status for status, _ in results] == [200, 200], results
    assert results[0][1] == results[1][1]
    assert ProjectManagementRecord.objects.filter(kind="cost").count() == 1


def test_payroll_confirmation_and_refresh_preserve_result(laboratory):
    lab = laboratory
    approve(lab, cost(lab))
    message = draft(lab, "payroll", user_id=str(lab["member"].id), start="2026-10-01", end="2026-10-31")
    result = confirm(lab, message)
    assert result.status_code == 200, result.content
    assert confirm(lab, message).json() == result.json()
    history = lab["client"](lab["lead"]).get(lab["base"] + f"agent/threads/{message.thread_id}/")
    assert history.json()["messages"][0]["draft"]["execution"]["status"] == "executed"
    assert latest_records(lab["project"].id).filter(kind="payroll").count() == 1


def test_tool_card_can_start_a_new_persisted_thread(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    response = client.post(lab["base"] + "agent/threads/", {"project_id": str(lab["project"].id)}, format="json")
    assert response.status_code == 201, response.content
    thread_id = response.json()["id"]
    response = client.post(
        lab["base"] + "agent/messages/",
        {
            "thread_id": thread_id,
            "project_id": str(lab["project"].id),
            "content": "质量检查",
            "draft": {"kind": "quality", "data": {"counts": {"missing": 1}}},
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    history = client.get(lab["base"] + f"agent/threads/{thread_id}/").json()
    assert history["messages"][0]["draft"]["project_id"] == str(lab["project"].id)


def test_payment_draft_uses_audited_payable_amount(laboratory, monkeypatch):
    lab = laboratory
    account = cash(lab)
    row = approve(lab, cost(lab, category="equipment"))
    audit_cost(lab, row, "120.00")
    mock_chat(monkeypatch, {"intent": "payment", "payment": {"kind": "cost", "record_ids": [row["id"]]}})
    response = chat(lab, lab["lead"], "支付该采购报销")
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["draft"]["amount"] == payload["draft"]["records"][0]["amount"] == "120.00"
    message = AgentMessage.objects.get(id=payload["message_id"])
    result = confirm(lab, message)
    assert result.status_code == 200, result.content
    assert result.json()["records"][0]["data"]["paid_amount"] == "120.00"
    assert balance(account) == Decimal("4880.00")


def test_audit_after_payment_draft_requires_reconfirmation_and_rolls_back_batch(laboratory, monkeypatch):
    lab = laboratory
    account = cash(lab)
    first = approve(lab, cost(lab, category="equipment"))
    second = approve(lab, cost(lab, category="equipment", work="另一个采购"))
    mock_chat(
        monkeypatch, {"intent": "payment", "payment": {"kind": "cost", "record_ids": [first["id"], second["id"]]}}
    )
    response = chat(lab, lab["lead"], "支付这两笔采购报销")
    assert response.status_code == 200, response.content
    message = AgentMessage.objects.get(id=response.json()["message_id"])
    # Keep one valid payment first to prove the entire batch rolls back.
    message.draft["records"].sort(key=lambda item: item["id"] != first["id"])
    message.save(update_fields=["draft"])
    audit_cost(lab, second, "100.00")
    assert latest_records(lab["project"].id).get(object_key=second["id"]).version == second["version"]
    result = confirm(lab, message)
    assert result.status_code == 409, result.content
    assert "金额已有变化" in str(result.json())
    assert balance(account) == Decimal("5000.00")
    assert not latest_records(lab["project"].id).filter(state="paid").exists()
    message.refresh_from_db()
    assert "execution" not in message.draft
    regenerated = chat(lab, lab["lead"], "重新生成两笔采购支付草稿")
    assert regenerated.status_code == 200, regenerated.content
    new_message = AgentMessage.objects.get(id=regenerated.json()["message_id"])
    assert new_message.draft["amount"] == "300.10"
    assert confirm(lab, new_message).status_code == 200
    assert balance(account) == Decimal("4699.90")
