# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
from unittest.mock import Mock

import pytest

from plane.lab import agent_views

from .test_bounty_quotes import decide, prepare, prepare_major, quote_list, submit_quote

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture
def model(monkeypatch):
    monkeypatch.setattr(agent_views, "_config", lambda: ("test-key", "test-base", "test-model"))
    monkeypatch.setattr(agent_views, "_redis_counter", lambda *args: 0)
    result = Mock(return_value={"intent": "query", "reply": "测试回答"})
    monkeypatch.setattr(agent_views, "_call_deepseek", result)
    monkeypatch.setattr(agent_views, "_call_deepseek_tools", result)
    return result


def _projections(lab, bounty_id, user, model):
    direct = agent_views._read_tool("get_vc_allocations", lab["project"], [], user)["items"]
    response = lab["client"](user).post(
        lab["base"] + "agent/chat/",
        {"project_id": str(lab["project"].id), "message": "查询当前悬赏VC报价明细"},
        format="json",
    )
    assert response.status_code == 200, response.content
    prompt = model.call_args.args[3]
    line = next(line for line in prompt.splitlines() if line.startswith("结构化上下文："))
    facts = json.loads(line.removeprefix("结构化上下文："))["project_facts"]["vc_allocations"]
    return (
        next(row for row in direct if row["bounty_id"] == bounty_id),
        next(row for row in facts if row["bounty_id"] == bounty_id),
        prompt,
    )


@pytest.mark.parametrize("role,can_read", [("member", True), ("lead", True), ("reviewer", False), ("independent", False)])
def test_pending_quote_visibility_matches_native_api_in_tools_and_prompt(laboratory, model, role, can_read):
    lab = laboratory
    bounty, _, _ = prepare_major(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="合成机密议价依据").status_code == 201
    quote_id = quote_list(lab, bounty)["quotes"][0]["id"]
    user = lab[role]
    native_ids = {row["id"] for row in quote_list(lab, bounty, user)["quotes"]}
    assert native_ids == ({quote_id} if can_read else set())
    direct, facts, prompt = _projections(lab, bounty, user, model)
    for projection in (direct, facts):
        assert {row["id"] for row in projection["quotes"]} == native_ids
    if not can_read:
        assert quote_id not in prompt


def test_designated_quote_reviewer_gains_visibility_only_after_assignment(laboratory, model):
    lab = laboratory
    bounty, _, _ = prepare_major(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="合成议价").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    user = lab["independent"]
    direct, facts, prompt = _projections(lab, bounty, user, model)
    assert direct["quotes"] == facts["quotes"] == []
    assert quote["id"] not in prompt
    assigned = decide(lab, bounty, quote, reviewer_id=str(user.id))
    assert assigned.status_code == 200, assigned.content
    assert assigned.json()["status"] == "pending_review"
    direct, facts, _ = _projections(lab, bounty, user, model)
    native_ids = {row["id"] for row in quote_list(lab, bounty, user)["quotes"]}
    assert native_ids == {quote["id"]}
    for projection in (direct, facts):
        assert {row["id"] for row in projection["quotes"]} == native_ids


@pytest.mark.parametrize("role", ["member", "lead", "reviewer", "independent"])
def test_approved_allocation_ids_match_native_detail_in_tools_and_prompt(laboratory, model, role):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty).status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    approved = decide(lab, bounty, quote)
    assert approved.status_code == 200, approved.content
    user = lab[role]
    detail = lab["client"](user).get(lab["base"] + f"bounties/{bounty}/detail/")
    assert detail.status_code == 200, detail.content
    native_ids = {row["id"] for row in detail.json()["allocations"]}
    assert len(native_ids) == 1
    direct, facts, _ = _projections(lab, bounty, user, model)
    for projection in (direct, facts):
        assert {row["id"] for row in projection["allocations"]} == native_ids
