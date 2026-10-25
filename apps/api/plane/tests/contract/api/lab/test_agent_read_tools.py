# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from rest_framework.exceptions import PermissionDenied

from plane.lab import agent_views

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def test_finance_read_tool_respects_the_same_view_permission_as_finance_pages(laboratory):
    lab = laboratory
    with pytest.raises(PermissionDenied):
        agent_views._read_tool("get_finance_summary", lab["project"], [], lab["member"])
    assert agent_views._read_tool("get_finance_summary", lab["project"], [], lab["lead"])["cash_available"] == "0.00"


def test_workspace_search_returns_matching_members_and_requires_a_query(laboratory):
    lab = laboratory
    result = agent_views._read_tool(
        "search_workspace_users", lab["project"], [], lab["member"], {"query": "lead@example.org"}
    )
    assert [row["id"] for row in result["items"]] == [str(lab["lead"].id)]
    assert agent_views._read_tool("search_workspace_users", lab["project"], [], lab["member"], [])["items"] == []


def _completion(content=None, calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=calls or []))])


def test_invalid_final_json_retains_fetched_facts_for_repair_pass(monkeypatch, laboratory):
    call = SimpleNamespace(id="tool-1", function=SimpleNamespace(name="get_project_meta", arguments="{}"))
    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=Mock(side_effect=[_completion(calls=[call]), _completion(content="invalid JSON")])
            )
        )
    )
    monkeypatch.setattr(agent_views, "OpenAI", Mock(return_value=client))
    final = Mock(return_value={"intent": "query", "reply": "根据已读取资料回答"})
    monkeypatch.setattr(agent_views, "_call_deepseek", final)
    lab = laboratory
    result = agent_views._call_deepseek_tools(
        "unused", "unused", "mock", "system", "负责人是谁", lab["project"], [], lab["member"]
    )
    assert "Acoustics" in final.call_args.args[3]
    assert "负责人" in final.call_args.args[3]
    assert result["_tools_used"] == ["get_project_meta"]


@pytest.mark.parametrize("reply", ["[]", "null", '"text"'])
def test_non_object_model_response_uses_controlled_fallback(monkeypatch, laboratory, reply):
    client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(return_value=_completion(content=reply))))
    )
    monkeypatch.setattr(agent_views, "OpenAI", Mock(return_value=client))
    monkeypatch.setattr(agent_views, "_call_deepseek", Mock(return_value={"intent": "query", "reply": "已恢复"}))
    lab = laboratory
    assert (
        agent_views._call_deepseek_tools(
            "unused", "unused", "mock", "system", "查询", lab["project"], [], lab["member"]
        )["reply"]
        == "已恢复"
    )


def test_malformed_tool_arguments_do_not_raise_attribute_error(monkeypatch, laboratory):
    call = SimpleNamespace(id="tool-1", function=SimpleNamespace(name="search_workspace_users", arguments="[]"))
    create = Mock(
        side_effect=[_completion(calls=[call]), _completion(content='{"intent":"needs_input","question":"搜索谁？"}')]
    )
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    lab = laboratory
    result = agent_views._call_deepseek_tools(
        "unused", "unused", "mock", "system", "搜索成员", lab["project"], [], lab["member"]
    )
    assert result["intent"] == "needs_input"


def test_finance_permission_denial_is_returned_as_unavailable_tool_data(monkeypatch, laboratory):
    call = SimpleNamespace(id="tool-1", function=SimpleNamespace(name="get_finance_summary", arguments="{}"))
    create = Mock(
        side_effect=[_completion(calls=[call]), _completion(content='{"intent":"query","reply":"没有财务查看权限"}')]
    )
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    lab = laboratory
    result = agent_views._call_deepseek_tools(
        "unused", "unused", "mock", "system", "余额", lab["project"], [], lab["member"]
    )
    tool_message = create.call_args.kwargs["messages"][-1]
    assert '"available":false' in tool_message["content"]
    assert "cash_available" not in tool_message["content"]
    assert result["_tools_used"] == ["get_finance_summary"]


@pytest.mark.parametrize("tool_mode", [False, True])
def test_network_failure_returns_502_without_repeating_request(monkeypatch, laboratory, tool_mode):
    create = Mock(side_effect=TimeoutError("upstream timeout"))
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    with pytest.raises(agent_views.AgentProviderError) as error:
        if tool_mode:
            lab = laboratory
            agent_views._call_deepseek_tools(
                "unused", "unused", "mock", "system", "查询", lab["project"], [], lab["member"]
            )
        else:
            agent_views._call_deepseek("unused", "unused", "mock", "system", "查询")
    assert error.value.status_code == 502
    assert create.call_count == 1


def test_json_format_incompatibility_can_retry_without_response_format(monkeypatch):
    class FormatUnsupported(Exception):
        status_code = 400

    create = Mock(
        side_effect=[
            FormatUnsupported("response_format is not supported"),
            _completion(content='{"intent":"query","reply":"ok"}'),
        ]
    )
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    assert agent_views._call_deepseek("unused", "unused", "mock", "system", "查询")["reply"] == "ok"
    assert "response_format" in create.call_args_list[0].kwargs
    assert "response_format" not in create.call_args_list[1].kwargs


def test_unassigned_task_totals_cover_more_than_the_returned_page(laboratory):
    from django.utils import timezone
    from plane.db.models import Issue

    lab = laboratory
    rows = [
        Issue(
            workspace=lab["workspace"],
            project=lab["project"],
            name=f"Task {i}",
            sequence_id=i + 1,
            state=lab["states"]["todo"],
        )
        for i in range(55)
    ]
    rows.extend(
        [
            Issue(
                workspace=lab["workspace"],
                project=lab["project"],
                name="Finished",
                sequence_id=56,
                state=lab["states"]["done"],
            ),
            Issue(
                workspace=lab["workspace"],
                project=lab["project"],
                name="Archived",
                sequence_id=57,
                state=lab["states"]["todo"],
                archived_at=timezone.now(),
            ),
            Issue(
                workspace=lab["workspace"],
                project=lab["project"],
                name="Draft",
                sequence_id=58,
                state=lab["states"]["todo"],
                is_draft=True,
            ),
        ]
    )
    Issue.objects.bulk_create(rows)
    result = agent_views._read_tool("list_unassigned_issues", lab["project"], [], lab["member"])
    assert result["count"] == 55
    assert len(result["items"]) == 50
    assert result["truncated"] is True
    facts = agent_views._task_facts(lab["project"], lab["member"])
    assert facts["active"] == 55
    assert facts["unassigned"] == 55
    assert len(facts["unassigned_tasks"]) == 10
