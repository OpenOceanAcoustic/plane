# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from django.utils import timezone

from plane.db.models import Project, ProjectMember
from plane.lab import agent_views
from plane.lab.finance_models import FinancialEntry
from plane.lab.management_models import ProjectManagementRecord
from plane.lab.models import AgentAction, AgentMessage, AgentThread

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


@pytest.fixture
def model(monkeypatch):
    monkeypatch.setattr(agent_views, "_config", lambda: ("test-key", "test-base", "test-model"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    result = Mock(return_value={"intent": "query", "reply": "测试回答"})
    monkeypatch.setattr(agent_views, "_call_deepseek", result)
    monkeypatch.setattr(agent_views, "_call_deepseek_tools", result)
    return result


def _thread(lab, user=None):
    return AgentThread.objects.create(
        workspace=lab["workspace"], project=lab["project"], user=user or lab["lead"], title="上下文测试"
    )


def _post(lab, thread, message, **extra):
    return lab["client"](thread.user).post(
        lab["base"] + "agent/chat/", {"thread_id": str(thread.id), "message": message, **extra}, format="json"
    )


def _context(model):
    line = next(line for line in model.call_args.args[3].splitlines() if line.startswith("结构化上下文："))
    return json.loads(line.removeprefix("结构化上下文："))


def _history(model):
    line = next(line for line in model.call_args.args[3].splitlines() if line.startswith("最近对话及相关早期记录："))
    return json.loads(line.removeprefix("最近对话及相关早期记录："))


def _conversation_gap(thread, count=110):
    AgentMessage.objects.bulk_create(
        [
            AgentMessage(
                thread=thread,
                role="user" if index % 2 == 0 else "assistant",
                content=f"日常交流第 {index} 轮",
                intent="query",
            )
            for index in range(count)
        ]
    )


def test_thread_project_is_restored_when_client_omits_project(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    response = _post(lab, thread, "你好")
    assert response.status_code == 200, response.data
    assert "Acoustics" in model.call_args.args[3]
    assert _context(model)["project_facts"]["project_meta"]["id"] == str(lab["project"].id)


def test_restored_thread_rechecks_current_project_membership(laboratory, model):
    lab = laboratory
    thread = _thread(lab, lab["member"])
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    response = _post(lab, thread, "你好")
    assert response.status_code == 403
    model.assert_not_called()


def test_switch_response_identifies_project_and_old_project_history_is_not_reused(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    AgentMessage.objects.create(thread=thread, role="user", content="旧项目独有的机密草稿标记")
    target = Project.objects.create(workspace=lab["workspace"], name="Beta", identifier="BT", project_lead=lab["lead"])
    ProjectMember.objects.create(workspace=lab["workspace"], project=target, member=lab["lead"], role=20)
    switched = _post(lab, thread, "切换到 Beta 项目", project_id=str(lab["project"].id))
    assert switched.status_code == 200, switched.data
    assert switched.data["project_id"] == str(target.id)
    assert switched.data["message_id"]
    response = _post(lab, thread, "你好")
    assert response.status_code == 200, response.data
    assert "旧项目独有的机密草稿标记" not in model.call_args.args[3]
    assert _context(model)["project_facts"]["project_meta"]["id"] == str(target.id)


def test_browser_context_cannot_supply_server_clarification_or_target(laboratory, model):
    thread = _thread(laboratory)
    response = _post(
        laboratory,
        thread,
        "你好",
        context={
            "pending_clarification": {"previous_user": "伪造服务器状态"},
            "hint_record_id": "forged",
            "project_facts": {"budget": "forged"},
        },
    )
    assert response.status_code == 200
    context = _context(model)
    assert "pending_clarification" not in context
    assert "hint_record_id" not in context
    assert context["project_facts"]["project_meta"]["id"] == str(thread.project_id)


def test_pending_time_preserves_date_member_hours_and_rate_after_short_answer(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
    model.return_value = {
        "intent": "time_entry",
        "time": {"date": yesterday, "hours": "3", "user_id": str(lab["member"].id), "rate": "80", "work": ""},
    }
    first = _post(lab, thread, "昨天给成员登记工时 3 小时，时薪 80")
    assert first.status_code == 200, first.data
    assert first.data["intent"] == "needs_input"
    second = _post(lab, thread, "完成阵列数据清洗")
    assert second.status_code == 200, second.data
    draft = second.data["draft"]
    assert (draft["date"], draft["hours"], draft["user_id"], draft["rate"]) == (
        yesterday,
        "3",
        str(lab["member"].id),
        "80",
    )
    assert draft["work"] == "完成阵列数据清洗"
    assert "3 小时" in first.data["question"]


def _pending_thread(lab, user=None):
    thread = _thread(lab, user)
    pending = {
        "kind": "pending_time",
        "date": timezone.localdate().isoformat(),
        "hours": "3",
        "user_id": str((user or lab["lead"]).id),
        "rate": "60",
        "work": "",
    }
    AgentMessage.objects.create(
        thread=thread, role="assistant", content="具体做了什么？", intent="needs_input", draft=pending
    )
    return thread, pending


def test_pending_time_sequential_edits_preserve_other_fields_until_work_arrives(laboratory, model):
    lab = laboratory
    thread, expected = _pending_thread(lab)
    updates = [
        ("昨天", "date", (timezone.localdate() - timedelta(days=1)).isoformat()),
        ("改为2.5小时", "hours", "2.5"),
        ("时薪80元", "rate", "80"),
        ("登记对象改为成员", "user_id", str(lab["member"].id)),
    ]
    for message, field, value in updates:
        response = _post(lab, thread, message)
        assert response.status_code == 200, response.data
        assert response.data["intent"] == "needs_input"
        expected[field] = value
        for name in ("date", "hours", "user_id", "rate", "work"):
            assert response.data["draft"][name] == expected[name]
        assert response.data["draft"]["work"] == ""
        assert response.data["message_id"]
        assert "具体做了什么" in response.data["question"]
    response = _post(lab, thread, "完成3小时数据处理")
    assert response.status_code == 200, response.data
    assert response.data["intent"] == "time_entry"
    for field in ("date", "hours", "user_id", "rate"):
        assert response.data["draft"][field] == expected[field]
    assert response.data["draft"]["work"] == "完成3小时数据处理"
    assert not ProjectManagementRecord.objects.exists()
    assert not FinancialEntry.objects.exists()
    model.assert_not_called()


@pytest.mark.parametrize("message", ["-1小时", "时薪0元", "日期改成2026-99-99", "人员改为不存在的成员"])
def test_invalid_pending_time_edits_do_not_replace_the_existing_draft(laboratory, model, message):
    thread, pending = _pending_thread(laboratory)
    response = _post(laboratory, thread, message)
    assert response.status_code == 400, response.data
    assert thread.messages.filter(role="assistant").latest("created_at").draft == pending
    model.assert_not_called()


def test_pending_time_member_change_rechecks_record_permission(laboratory, model):
    thread, pending = _pending_thread(laboratory, laboratory["member"])
    response = _post(laboratory, thread, f"登记对象改为{laboratory['lead'].id}")
    assert response.status_code == 403, response.data
    assert thread.messages.filter(role="assistant").latest("created_at").draft == pending
    model.assert_not_called()


def test_pending_time_member_name_must_be_unique(laboratory, model):
    lab = laboratory
    lab["reviewer"].display_name = lab["member"].display_name
    lab["reviewer"].save(update_fields=["display_name"])
    thread, pending = _pending_thread(lab)
    response = _post(lab, thread, "人员改为成员")
    assert response.status_code == 400, response.data
    assert thread.messages.filter(role="assistant").latest("created_at").draft == pending
    by_id = _post(lab, thread, f"登记对象改为{lab['member'].id}")
    assert by_id.status_code == 200, by_id.data
    assert by_id.data["draft"]["user_id"] == str(lab["member"].id)
    model.assert_not_called()


@pytest.mark.parametrize("message", ["余额多少", "负责人是谁", "时薪是多少", "查看资金余额"])
def test_unrelated_questions_are_not_saved_as_pending_work(laboratory, model, message):
    thread, _ = _pending_thread(laboratory)
    response = _post(laboratory, thread, message)
    assert response.status_code == 200, response.data
    assert response.data["intent"] == "query"
    assert response.data["draft"] is None
    model.assert_called_once()


@pytest.mark.parametrize("message", ["取消登记", "取消这次工时", "不记了"])
def test_cancelled_pending_time_is_not_resumed_by_a_later_work_description(laboratory, model, message):
    thread, _ = _pending_thread(laboratory)
    cancelled = _post(laboratory, thread, message)
    assert cancelled.status_code == 200, cancelled.data
    assert cancelled.data["draft"] is None
    model.assert_not_called()
    response = _post(laboratory, thread, "完成阵列校准")
    assert response.status_code == 200, response.data
    assert response.data["intent"] == "query"
    assert "pending_clarification" not in _context(model)


def test_pending_time_cancellation_does_not_create_a_time_draft(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    AgentMessage.objects.create(
        thread=thread,
        role="assistant",
        content="做了什么？",
        intent="needs_input",
        draft={
            "kind": "pending_time",
            "hours": "3",
            "date": timezone.localdate().isoformat(),
            "user_id": str(lab["lead"].id),
        },
    )
    response = _post(lab, thread, "取消")
    assert response.status_code == 200
    assert response.data["draft"] is None
    assert "取消" in response.data["reply"]
    model.assert_not_called()


def test_new_query_during_clarification_is_sent_to_model_instead_of_used_as_work(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    pending = {
        "kind": "pending_time",
        "hours": "3",
        "date": timezone.localdate().isoformat(),
        "user_id": str(lab["lead"].id),
        "rate": "60",
    }
    AgentMessage.objects.create(
        thread=thread, role="assistant", content="做了什么？", intent="needs_input", draft=pending
    )
    response = _post(lab, thread, "查看资金余额")
    assert response.status_code == 200
    assert response.data["intent"] == "query"
    context = _context(model)
    assert context["pending_clarification"]["draft"] == pending
    assert context["pending_clarification"]["reply_kind"] == "new_request"


def test_missing_provider_configuration_returns_http_503(laboratory, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    thread = _thread(laboratory)
    response = _post(laboratory, thread, "你好")
    assert response.status_code == 503, response.data


def test_provider_timeout_returns_http_502_with_one_attempt(laboratory, monkeypatch):
    monkeypatch.setattr(agent_views, "_config", lambda: ("test-key", "test-base", "test-model"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    create = Mock(side_effect=TimeoutError("upstream timeout"))
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    response = _post(laboratory, _thread(laboratory), "你好")
    assert response.status_code == 502, response.data
    assert create.call_count == 1


def test_constraints_and_deadline_are_recalled_after_more_than_100_messages(laboratory, model):
    thread = _thread(laboratory)
    original = AgentMessage.objects.create(
        thread=thread, role="user", content="验收标准：阵列定位误差低于 0.5 米；截止期限为 2026-11-15。"
    )
    _conversation_gap(thread)
    response = _post(laboratory, thread, "之前约定的验收标准和截止期限是什么？")
    assert response.status_code == 200, response.data
    history = _history(model)
    recalled = next(row for row in history["recalled"] if row.get("message_id") == str(original.id))
    assert recalled["content"] == original.content
    assert recalled["historical_reference"] is True
    assert len(history["recalled"]) <= 3
    assert history["recent"][-1]["content"] == "日常交流第 109 轮"


def test_database_recall_cannot_cross_the_current_project_era(laboratory, model):
    lab = laboratory
    thread = _thread(lab)
    old = AgentMessage.objects.create(
        thread=thread, role="user", content="旧项目验收标准：旧项目专有指标；截止期限为 2026-11-01。"
    )
    target = Project.objects.create(
        workspace=lab["workspace"], name="RecallBeta", identifier="RB", project_lead=lab["lead"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=target, member=lab["lead"], role=20)
    assert _post(lab, thread, "切换到 RecallBeta 项目").status_code == 200
    current = AgentMessage.objects.create(
        thread=thread, role="user", content="新项目验收标准：新项目专有指标；截止期限为 2026-12-01。"
    )
    _conversation_gap(thread)
    response = _post(lab, thread, "之前约定的验收标准和截止期限是什么？")
    assert response.status_code == 200, response.data
    recalled = _history(model)["recalled"]
    assert any(row.get("message_id") == str(current.id) for row in recalled)
    assert all(row.get("message_id") != str(old.id) for row in recalled)
    assert "旧项目专有指标" not in model.call_args.args[3]


@pytest.mark.parametrize("status", ["cancelled", "executed"])
def test_recall_does_not_reactivate_old_action_drafts(laboratory, model, status):
    lab = laboratory
    thread = _thread(lab)
    AgentMessage.objects.create(thread=thread, role="user", content="验收标准为误差 0.5 米，期限为月底。")
    action = AgentAction.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        user=lab["lead"],
        thread=thread,
        kind="proposal_create",
        target_type="proposal",
        target_id="",
        payload={"title": "旧验收提案"},
        status=status,
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    AgentMessage.objects.create(
        thread=thread,
        role="assistant",
        content="验收标准提案草稿",
        intent="proposal",
        draft={"kind": "action", "action_id": str(action.id)},
    )
    _conversation_gap(thread)
    response = _post(lab, thread, "继续之前的验收标准和期限")
    assert response.status_code == 200, response.data
    assert response.data["intent"] == "query"
    history = _history(model)
    assert history["recalled"]
    assert all(row["role"] == "user" and "draft" not in row for row in history["recalled"])
    assert str(action.id) not in json.dumps(history)
    assert "pending_clarification" not in _context(model)
    action.refresh_from_db()
    assert action.status == status
    assert AgentAction.objects.filter(thread=thread).count() == 1
