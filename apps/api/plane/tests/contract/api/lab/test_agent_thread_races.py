# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Use independent PostgreSQL connections while a synthetic provider is paused."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from django.db import close_old_connections

from plane.db.models import Project, ProjectMember
from plane.lab import agent_views
from plane.lab.models import AgentMessage, AgentThread

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.mark.parametrize("round_trip", [False, True])
@pytest.mark.parametrize("paused_stage", ["history", "provider"])
def test_late_model_reply_cannot_cross_a_project_switch(laboratory, monkeypatch, round_trip, paused_stage):
    lab = laboratory
    thread = AgentThread.objects.create(workspace=lab["workspace"], project=lab["project"], user=lab["lead"])
    target = Project.objects.create(workspace=lab["workspace"], name="Beta", identifier="BETA", project_lead=lab["lead"])
    ProjectMember.objects.create(workspace=lab["workspace"], project=target, member=lab["lead"], role=20)
    entered, released = Event(), Event()
    prompts = []
    monkeypatch.setattr(agent_views, "_config", lambda: ("test", "http://llm.invalid", "test"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)

    original_history = agent_views.prepare_history

    def history(*args, **kwargs):
        if paused_stage == "history" and args[1] == "查询旧资料":
            entered.set()
            assert released.wait(20)
        return original_history(*args, **kwargs)

    monkeypatch.setattr(agent_views, "prepare_history", history)

    def model(*args, **kwargs):
        prompts.append(args[3])
        if args[4] == "查询旧资料":
            if paused_stage == "provider":
                entered.set()
                assert released.wait(20)
            return {"intent": "query", "reply": "OLD_PROJECT_A_SECRET_MARKER"}
        return {"intent": "query", "reply": "新项目回答"}

    monkeypatch.setattr(agent_views, "_call_deepseek", model)
    monkeypatch.setattr(agent_views, "_call_deepseek_tools", model)

    def post(message, project_id):
        return lab["client"](lab["lead"]).post(
            lab["base"] + "agent/chat/",
            {"thread_id": str(thread.id), "project_id": str(project_id), "message": message},
            format="json",
        )

    def slow_old_request():
        close_old_connections()
        try:
            return post("查询旧资料", lab["project"].id)
        finally:
            close_old_connections()

    current_project = target
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(slow_old_request)
        try:
            assert entered.wait(20)
            switched = post("切换到 Beta 项目", lab["project"].id)
            assert switched.status_code == 200, switched.data
            assert switched.data["project_id"] == str(target.id)
            if round_trip:
                current_project = lab["project"]
                switched = post("切换到 Acoustics 项目", target.id)
                assert switched.status_code == 200, switched.data
                assert switched.data["project_id"] == str(current_project.id)
        finally:
            released.set()
        old = pending.result(timeout=20)
        assert old.status_code == 409, old.data
        assert "切换" in str(old.data)
    thread.refresh_from_db()
    assert thread.project_id == current_project.id
    assert not AgentMessage.objects.filter(thread=thread, content="OLD_PROJECT_A_SECRET_MARKER").exists()
    result = post("你好", current_project.id)
    assert result.status_code == 200, result.data
    assert result.data["message_id"]
    assert result.data["project_id"] == str(current_project.id)
    assert "OLD_PROJECT_A_SECRET_MARKER" not in prompts[-1]
