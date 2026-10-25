# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only

from unittest.mock import Mock

import pytest

from plane.db.models import Project, ProjectMember
from plane.lab import agent_views
from plane.lab.models import CashBounty
from .test_agent_context_api import _context
from .test_next_actions import actions

pytestmark = [pytest.mark.django_db, pytest.mark.contract]


def cash(lab, **overrides):
    return CashBounty.objects.create(
        **{
            "workspace": lab["workspace"],
            "project": lab["project"],
            "publisher": lab["lead"],
            "reviewer": lab["lead"],
            "title": "UI点击测试",
            "deliverable": "提交浏览器、复现步骤和截图",
            "criteria": "覆盖成功、失败和移动端三种状态",
            "amount": "5.00",
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "status,actor,label",
    [
        ("open", "member", "可领取"),
        ("claimed", "member", "待提交"),
        ("submitted", "lead", "待验收"),
        ("accepted", "lead", "待付款"),
        ("proposed", "lead", "待审批"),
    ],
)
def test_workbench_cash_actions_link_to_accessible_cash_records(laboratory, status, actor, label):
    lab = laboratory
    row = cash(lab, status=status, publisher=lab["member"], claimed_by=lab["member"] if status != "open" else None)
    item = next(item for item in actions(lab, lab[actor])["items"] if item["id"] == str(row.id))
    assert item["kind"] == "cash" and item["action"] == label
    assert item["url"] == f"/lab/lab/cash?bounty_id={row.id}"
    response = lab["client"](lab[actor]).get(lab["base"] + f"cash-bounties/{row.id}/")
    assert response.status_code == 200 and response.data["title"] == row.title


def test_unapproved_cash_bounties_have_the_same_visibility_in_list_detail_and_ai(laboratory):
    lab = laboratory
    row = cash(lab, status="proposed", publisher=lab["independent"])
    client = lab["client"](lab["member"])
    assert client.get(lab["base"] + "cash-bounties/").json() == []
    assert client.get(lab["base"] + f"cash-bounties/{row.id}/").status_code == 404
    assert agent_views._read_tool("list_cash_bounties", lab["project"], [], lab["member"])["items"] == []
    for user in (lab["lead"], lab["independent"]):
        assert lab["client"](user).get(lab["base"] + f"cash-bounties/{row.id}/").status_code == 200


def test_workspace_cash_query_covers_accessible_projects_and_respects_revocation(laboratory):
    lab = laboratory
    first = cash(lab)
    project = Project.objects.create(
        workspace=lab["workspace"], name="第二项目", identifier="B", project_lead=lab["lead"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=project, member=lab["member"], role=15)
    second = cash(lab, project=project, title="算法反馈测试")
    tool = lambda project=None: agent_views._read_tool(
        "list_cash_bounties",
        project,
        [],
        lab["member"],
        {"scope": "project" if project else "workspace"},
        workspace=lab["workspace"],
    )
    result = tool()
    assert result["scope"] == "workspace" and result["count"] == 2
    assert {row["id"] for row in result["items"]} == {str(first.id), str(second.id)}
    assert {row["id"] for row in tool(lab["project"])["items"]} == {str(first.id)}
    ProjectMember.objects.filter(project=project, member=lab["member"]).update(is_active=False)
    assert {row["id"] for row in tool()["items"]} == {str(first.id)}
    assert lab["client"](lab["member"]).get(lab["base"] + f"cash-bounties/{second.id}/").status_code == 404


def test_cash_query_can_find_older_records_outside_the_context_page(laboratory):
    lab = laboratory
    target = cash(lab)
    for index in range(24):
        cash(lab, title=f"其他任务{index}")
    result = agent_views._read_tool("list_cash_bounties", lab["project"], [], lab["member"])
    assert result["count"] == 25 and result["truncated"] is True
    assert str(target.id) not in {row["id"] for row in result["items"]}
    result = agent_views._read_tool("list_cash_bounties", lab["project"], [], lab["member"], {"query": "UI点击测试"})
    assert result["count"] == 1 and result["truncated"] is False
    assert result["items"][0]["id"] == str(target.id)
    assert result["items"][0]["url"] == f"/lab/lab/cash?bounty_id={target.id}"
    assert result["items"][0]["can_claim"] is True


def test_cash_context_prioritizes_open_tasks_over_newer_paid_history(laboratory):
    lab = laboratory
    target = cash(lab)
    for index in range(24):
        cash(lab, title=f"已付历史{index}", status="paid")
    result = agent_views._read_tool("list_cash_bounties", lab["project"], [], lab["member"])
    assert result["items"][0]["id"] == str(target.id)
    assert result["truncated"] is True


@pytest.mark.parametrize("scoped", [False, True])
def test_chat_receives_real_cash_bounties_with_or_without_selected_project(laboratory, monkeypatch, scoped):
    lab = laboratory
    row = cash(lab)
    cash(lab, status="proposed", title="隐藏的提议", publisher=lab["independent"])
    monkeypatch.setattr(agent_views, "_config", lambda: ("test", "test", "test"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    model = Mock(return_value={"intent": "query", "reply": "已找到现金悬赏"})
    monkeypatch.setattr(agent_views, "_call_deepseek_tools", model)
    response = lab["client"](lab["member"]).post(
        lab["base"] + "agent/chat/",
        {
            "message": "有哪些现金悬赏？",
            **({"project_id": str(lab["project"].id)} if scoped else {}),
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    facts = _context(model)["project_facts"]["cash_bounties"]
    assert facts["available"] is True and facts["scope"] == "workspace"
    assert facts["count"] == 1 and facts["items"][0]["id"] == str(row.id)
    assert "隐藏的提议" not in model.call_args.args[3]
    assert model.call_args.kwargs["workspace"] == lab["workspace"]
    assert model.call_args.kwargs["forced_tool"] == "list_cash_bounties"


def test_workspace_tool_finds_cash_tasks_even_when_a_different_project_is_selected(laboratory):
    lab = laboratory
    row = cash(lab)
    other = Project.objects.create(
        workspace=lab["workspace"], name="空项目", identifier="EMPTY", project_lead=lab["lead"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["member"], role=15)
    result = agent_views._read_tool("list_cash_bounties", other, [], lab["member"], workspace=lab["workspace"])
    assert result["scope"] == "workspace" and result["items"][0]["id"] == str(row.id)
    result = agent_views._read_tool(
        "list_cash_bounties", other, [], lab["member"], {"scope": "project"}, workspace=lab["workspace"]
    )
    assert result["scope"] == "project" and result["count"] == 0


def test_workspace_cash_query_never_crosses_workspace(laboratory):
    from plane.db.models import Workspace, WorkspaceMember

    lab = laboratory
    visible = cash(lab)
    other_workspace = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=other_workspace, member=lab["member"], role=15)
    project = Project.objects.create(
        workspace=other_workspace, name="外部项目", identifier="X", project_lead=lab["lead"]
    )
    ProjectMember.objects.create(workspace=other_workspace, project=project, member=lab["member"], role=15)
    cash(lab, workspace=other_workspace, project=project, title="其他工作区的任务")
    result = agent_views._read_tool("list_cash_bounties", None, [], lab["member"], workspace=lab["workspace"])
    assert result["count"] == 1 and result["items"][0]["id"] == str(visible.id)


def test_tool_loop_supplies_cash_facts_without_a_selected_project(laboratory, monkeypatch):
    from types import SimpleNamespace
    from .test_agent_read_tools import _completion

    lab = laboratory
    row = cash(lab)
    call = SimpleNamespace(
        id="cash-query", function=SimpleNamespace(name="list_cash_bounties", arguments='{"query":"UI点击测试"}')
    )
    create = Mock(
        side_effect=[_completion(calls=[call]), _completion(content='{"intent":"query","reply":"已找到任务"}')]
    )
    monkeypatch.setattr(
        agent_views,
        "OpenAI",
        Mock(return_value=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))),
    )
    result = agent_views._call_deepseek_tools(
        "test", "test", "test", "system", "查询现金悬赏", None, [], lab["member"], workspace=lab["workspace"]
    )
    tool_message = create.call_args.kwargs["messages"][-1]["content"]
    assert str(row.id) in tool_message and row.title in tool_message
    assert result["_tools_used"] == ["list_cash_bounties"]
