# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Server shortcuts obey action locks and project boundaries on real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from django.db import close_old_connections

from plane.db.models import Project, ProjectMember
from plane.lab import agent_views
from plane.lab.models import AgentAction, AgentAnnotation, AgentMessage, AgentThread
from .test_agent_actions import chat, execute, mock_chat, prepared
from .test_project_management import cost

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def action_message(action, thread=None):
    return AgentMessage.objects.create(
        thread=thread or action.thread,
        role="assistant",
        content="请确认这张草稿",
        intent="approval",
        draft={"kind": "action", "action_id": str(action.id)},
    )


def test_cancel_cannot_overwrite_a_concurrently_executed_action(laboratory, monkeypatch):
    lab = laboratory
    row = cost(lab)
    action = prepared(
        lab, "annotate_cost", target_id=row["id"], payload={"note": "只写一次", "expected_version": row["version"]}
    )
    message = action_message(action)
    mock_chat(monkeypatch, {"intent": "query"})
    locked, release, cancellation_save = Event(), Event(), Event()
    original_execute = agent_views._execute_agent_action_locked
    original_save = AgentAction.save

    def pause_execution(*args, **kwargs):
        locked.set()
        assert release.wait(15)
        return original_execute(*args, **kwargs)

    def observe_cancellation(instance, *args, **kwargs):
        if instance.status == "cancelled":
            cancellation_save.set()
        return original_save(instance, *args, **kwargs)

    monkeypatch.setattr(agent_views, "_execute_agent_action_locked", pause_execution)
    monkeypatch.setattr(AgentAction, "save", observe_cancellation)

    def separate_connection(fn):
        close_old_connections()
        try:
            return fn()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        confirming = pool.submit(separate_connection, lambda: execute(lab, action))
        try:
            assert locked.wait(15)
            cancelling = pool.submit(
                separate_connection,
                lambda: chat(lab, lab["lead"], "取消", thread_id=str(action.thread_id), message_id=str(message.id)),
            )
            # Without the cancellation lock this reaches save(prepared->cancelled)
            # before blocking on the executing transaction's UPDATE lock.
            cancellation_save.wait(1)
        finally:
            release.set()
        assert confirming.result(timeout=15).status_code == 200
        response = cancelling.result(timeout=15)
        assert response.status_code == 400, response.content
    action.refresh_from_db()
    assert action.status == "executed"
    assert AgentAnnotation.objects.filter(target_id=row["id"]).count() == 1


def test_historical_draft_cannot_cancel_an_action_from_another_thread(laboratory, monkeypatch):
    lab = laboratory
    action = prepared(lab, "annotate_cost", payload={"note": "保留"})
    other = AgentThread.objects.create(workspace=lab["workspace"], project=lab["project"], user=lab["lead"])
    message = action_message(action, other)
    mock_chat(monkeypatch, {"intent": "query"})
    response = chat(lab, lab["lead"], "取消", thread_id=str(other.id), message_id=str(message.id))
    assert response.status_code == 400, response.content
    action.refresh_from_db()
    assert action.status == "prepared"


@pytest.mark.parametrize("answer", ["取消", "确认"])
def test_server_action_reply_cannot_cross_a_project_switch(laboratory, monkeypatch, answer):
    lab = laboratory
    row = cost(lab)
    action = prepared(
        lab, "annotate_cost", target_id=row["id"], payload={"note": "旧项目备注", "expected_version": row["version"]}
    )
    message = action_message(action)
    target = Project.objects.create(
        workspace=lab["workspace"], name="Beta", identifier="BETA", project_lead=lab["lead"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=target, member=lab["lead"], role=20)
    mock_chat(monkeypatch, {"intent": "query"})
    entered, release = Event(), Event()
    original_begin = agent_views.begin_chat_turn

    def paused_begin(*args, **kwargs):
        result = original_begin(*args, **kwargs)
        entered.set()
        assert release.wait(15)
        return result

    monkeypatch.setattr(agent_views, "begin_chat_turn", paused_begin)

    def old_request():
        close_old_connections()
        try:
            return chat(lab, lab["lead"], answer, thread_id=str(action.thread_id), message_id=str(message.id))
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(old_request)
        try:
            assert entered.wait(15)
            switched = chat(lab, lab["lead"], "切换到 Beta 项目", thread_id=str(action.thread_id))
            assert switched.status_code == 200, switched.content
        finally:
            release.set()
        response = pending.result(timeout=15)
        assert response.status_code == 409, response.content
    action.refresh_from_db()
    assert action.status == "prepared"
    assert not AgentAnnotation.objects.exists()
    assert not AgentMessage.objects.filter(thread=action.thread, intent="action_result").exists()


@pytest.mark.parametrize("answer", ["取消", "确认"])
def test_server_action_reply_returns_persisted_message_and_project(laboratory, monkeypatch, answer):
    lab = laboratory
    row = cost(lab)
    action = prepared(
        lab, "annotate_cost", target_id=row["id"], payload={"note": "测试备注", "expected_version": row["version"]}
    )
    message = action_message(action)
    mock_chat(monkeypatch, {"intent": "query"})
    response = chat(lab, lab["lead"], answer, thread_id=str(action.thread_id), message_id=str(message.id))
    assert response.status_code == 200, response.content
    payload = response.json()
    saved = AgentMessage.objects.get(id=payload["message_id"])
    assert saved.content == payload["reply"]
    assert payload["project_id"] == str(lab["project"].id)
    assert payload["project_name"] == lab["project"].name


def test_append_rejects_late_card_from_another_project(laboratory):
    lab = laboratory
    other = Project.objects.create(workspace=lab["workspace"], name="Beta", identifier="BETA", project_lead=lab["lead"])
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["lead"], role=20)
    thread = AgentThread.objects.create(workspace=lab["workspace"], project=other, user=lab["lead"])
    data = {
        "thread_id": str(thread.id),
        "project_id": str(lab["project"].id),
        "content": "旧项目质量",
        "draft": {"kind": "quality", "project_id": str(lab["project"].id)},
    }
    client = lab["client"](lab["lead"])
    assert client.post(lab["base"] + "agent/messages/", data, format="json").status_code == 400
    assert not thread.messages.exists()
    data["project_id"] = str(other.id)
    response = client.post(lab["base"] + "agent/messages/", data, format="json")
    assert response.status_code == 200, response.content
    assert thread.messages.get().draft["project_id"] == str(other.id)


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_reselecting_approval_rechecks_revoked_finance_grant(laboratory, monkeypatch, decision):
    from .test_finance_permissions import grant

    lab = laboratory
    delegate = lab["independent"]
    original = cost(lab)
    private = cost(lab, work="SECRET_TARGET_WORK", date="2026-10-16")
    assert grant(lab, delegate, ["approve"]).status_code == 200
    mock_chat(monkeypatch, {"intent": "approval", "approval": {"record_id": original["id"], "decision": decision}})
    generated = chat(lab, delegate, "审批该工时")
    assert generated.status_code == 200, generated.content
    payload = generated.json()
    action = AgentAction.objects.get(id=payload["draft"]["action_id"])
    assert grant(lab, delegate, []).status_code == 200
    response = chat(
        lab, delegate, f"不是这条，是 {private['id']}", thread_id=payload["thread_id"], message_id=payload["message_id"]
    )
    assert response.status_code == 403, response.content
    assert "SECRET_TARGET_WORK" not in str(response.json())
    action.refresh_from_db()
    assert action.status == "prepared"
    assert AgentAction.objects.filter(thread=action.thread).count() == 1
    # Losing approval access must still allow withdrawing the old draft.
    cancelled = chat(lab, delegate, "取消", thread_id=payload["thread_id"], message_id=payload["message_id"])
    assert cancelled.status_code == 200, cancelled.content
    action.refresh_from_db()
    assert action.status == "cancelled"
