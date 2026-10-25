# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
from datetime import date

import pytest

from plane.lab.agent_context import (
    bounded_value,
    clarification_reply_kind,
    json_text,
    pending_time_update,
    prepare_context,
    prepare_history,
    recall_terms,
)

pytestmark = pytest.mark.unit


def test_large_old_plan_cannot_displace_the_latest_correction():
    rows = [
        {
            "role": "assistant",
            "content": "旧项目计划",
            "draft": {"stages": [{"tasks": ["很长的任务说明" * 100] * 30}] * 5},
        },
        {"role": "user", "content": "改为昨天 3 小时，成员仍是小王"},
        {"role": "assistant", "content": "具体做了什么？", "intent": "needs_input"},
    ]
    history = prepare_history(rows)
    assert history["recent"][-2]["content"] == rows[-2]["content"]
    assert history["recent"][-1]["content"] == rows[-1]["content"]
    assert len(json_text(history)) <= 11000
    assert json.loads(json_text(history)) == history


def test_clarification_fields_survive_large_rosters_and_project_facts():
    pending = {
        "question": "做了什么？",
        "previous_user": "昨天给小王登记 3 小时",
        "draft": {"date": "2026-10-22", "hours": "3", "user_id": "member-id", "rate": "80"},
    }
    context = prepare_context(
        {
            "page_context": {"page": "/finance", "notes": "页面提示" * 10000},
            "pending_clarification": pending,
            "project_facts": {
                "finance_records": [{"id": str(i), "title": "工作" * 1000} for i in range(100)],
                "workspace_members": [{"id": str(i), "name": "成员" * 100} for i in range(200)],
            },
        }
    )
    assert context["pending_clarification"] == pending
    assert len(json_text(context)) <= 14000
    assert json.loads(json_text(context)) == context


def test_recall_recovers_a_relevant_decision_outside_recent_turns():
    rows = [{"role": "user", "content": "水声阵列项目的验收指标是误差低于 0.5 米"}]
    rows.extend({"role": "user", "content": f"普通讨论 {i}"} for i in range(40))
    history = prepare_history(rows, "水声阵列的验收指标是什么？")
    assert history["recalled"][0]["content"] == rows[0]["content"]
    assert history["recent"][-1]["content"] == rows[-1]["content"]


def test_truncated_tools_keep_valid_json_and_signal_missing_items():
    data = {"items": [{"id": str(i), "title": "任务" * 2000} for i in range(200)]}
    result = bounded_value(data, 1800)
    assert len(json_text(result)) <= 1800
    assert "omitted" in json_text(result)
    assert json.loads(json_text(result)) == result


@pytest.mark.parametrize("text", ["取消", "算了", "不用了", "取消这条"])
def test_cancellation_is_not_work_description(text):
    assert clarification_reply_kind(text) == "cancel"


@pytest.mark.parametrize("text", ["查看资金余额", "改成 3 小时", "新建任务", "负责人是谁？"])
def test_new_request_is_not_blindly_inserted_into_pending_draft(text):
    assert clarification_reply_kind(text) == "new_request"


def test_a_short_work_description_can_complete_the_draft():
    assert clarification_reply_kind("完成阵列数据清洗和误差校验") == "answer"


def test_database_recall_terms_and_external_references_are_bounded():
    terms = recall_terms("继续之前的验收标准、截止期限和预算要求，water acoustics array target milestone")
    assert 0 < len(terms) <= 8
    assert "验收" in terms and "截止" in terms
    recent = [{"role": "user", "content": "最新修正优先"}]
    older = [{"id": str(index), "role": "user", "content": f"验收标准 {index}"} for index in range(30)]
    history = prepare_history(recent, "验收标准", earlier=older)
    assert history["recent"][-1]["content"] == "最新修正优先"
    assert len(history["recalled"]) <= 3
    assert all(row["historical_reference"] for row in history["recalled"])


@pytest.mark.parametrize("budget", [4, 16, 32, 64, 128, 2400])
def test_bounded_value_respects_even_small_budgets_with_escaped_text(budget):
    data = {"\u0000" * 200: ['\u0000\n\t\\"' * 4000] * 15}
    value = bounded_value(data, budget)
    assert len(json_text(value)) <= budget
    assert json.loads(json_text(value)) == value


@pytest.mark.parametrize("budget", [64, 128, 512, 14000])
def test_context_serialized_budget_includes_wrappers_and_omission_markers(budget):
    escaped = '\u0000\n\t\\"' * 4000
    context = prepare_context(
        {
            "pending_clarification": {"question": escaped, "draft": {"hours": "3"}},
            "hint_record_id": escaped,
            "page_context": {"notes": escaped},
            "project_facts": {key: [escaped] * 50 for key in ("summary", "tasks", "budget", "workspace_members")},
        },
        max_chars=budget,
    )
    assert len(json_text(context)) <= budget
    assert json.loads(json_text(context)) == context


@pytest.mark.parametrize("budget", [128, 512, 11000])
def test_latest_escaped_message_is_shortened_instead_of_dropped(budget):
    content = "最新回答：" + "\u0000" * 4000
    rows = [{"role": "user", "content": content, "intent": "\u0000" * 4000}]
    history = prepare_history(rows, max_chars=budget)
    assert history["recent"][-1]["content"].startswith("最新回答：")
    assert len(json_text(history)) <= budget
    assert json.loads(json_text(history)) == history


@pytest.mark.parametrize("function,budget", [(bounded_value, 3), (prepare_context, 63), (prepare_history, 63)])
def test_impossible_json_budgets_are_rejected(function, budget):
    with pytest.raises(ValueError):
        function({}, max_chars=budget)


@pytest.mark.parametrize(
    "message,expected",
    [
        ("昨天", {"date": "2026-10-22"}),
        ("日期改到前天。", {"date": "2026-10-21"}),
        ("改为2026-10-20", {"date": "2026-10-20"}),
        ("3小时", {"hours": "3"}),
        ("工时改成 2.5 小时", {"hours": "2.5"}),
        ("时薪80元", {"rate": "80"}),
        ("费率调整为 82.50 元/小时", {"rate": "82.50"}),
        ("80元/小时", {"rate": "80"}),
        ("登记对象改为小王", {"member_selector": "小王"}),
    ],
)
def test_pending_time_recognizes_only_explicit_whole_field_updates(message, expected):
    assert pending_time_update(message, date(2026, 10, 23)) == expected


@pytest.mark.parametrize(
    "message",
    [
        "完成3小时数据处理",
        "昨天完成阵列校准",
        "与成员改为线上同步进度",
        "80元",
        "日期改为昨天，工时改为3小时",
        "查看资金余额",
    ],
)
def test_pending_time_parser_does_not_reinterpret_work_or_combined_requests(message):
    assert pending_time_update(message, date(2026, 10, 23)) is None
