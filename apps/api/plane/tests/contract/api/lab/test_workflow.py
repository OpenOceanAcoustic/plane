# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from decimal import Decimal
import uuid

import pytest

from plane.db.models import Issue, ProjectMember
from plane.lab.models import Allocation, Audit, Bounty, Ledger, Stage
from django.utils import timezone

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def make_bounty(lab, **values):
    task = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="流程实验", state=lab["states"]["todo"]
    )
    stage = Stage.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=lab["project"].id,
        project_name=lab["project"].name,
        name="实验阶段",
        budget=Decimal("100"),
        frozen_at=timezone.now(),
    )
    return Bounty.objects.create(
        stage=stage,
        issue=task,
        issue_id_snapshot=task.id,
        title=task.name,
        deliverable="记录",
        criteria="可复验",
        budget=Decimal("20"),
        reserved=Decimal("20"),
        publisher=lab["lead"],
        reviewer=lab["reviewer"],
        status="open",
        **values,
    )


def test_workflow_projects_existing_state_and_permission_actions_without_writes(laboratory):
    lab = laboratory
    bounty = make_bounty(lab)
    path = lab["base"] + f"bounties/{bounty.id}/workflow/"
    before = Audit.objects.count()
    member = lab["client"](lab["member"]).get(path)
    assert member.status_code == 200
    body = member.json()
    assert body["current_node"] == "claim"
    assert "claim" in [row["action"] for row in body["actions"]]
    assert "accept" not in [row["action"] for row in body["actions"]]
    lead = lab["client"](lab["lead"]).get(path).json()
    start = next(row for row in lead["actions"] if row["action"] == "start")
    assert not start["enabled"] and start["reason"]
    assert Audit.objects.count() == before
    bounty.refresh_from_db()
    assert bounty.status == "open"


def test_confirmation_history_and_independent_actions_are_role_specific(laboratory):
    lab = laboratory
    bounty = make_bounty(lab)
    allocation = Allocation.objects.create(
        bounty=bounty,
        user=lab["member"],
        user_id_snapshot=lab["member"].id,
        user_name=lab["member"].display_name,
        deliverable="证据",
        planned=10,
        approved=True,
    )
    Audit.objects.create(
        workspace_id_snapshot=lab["workspace"].id,
        actor=lab["lead"],
        actor_name="负责人",
        action="bounty.claim_approved",
        object_id=allocation.id,
    )
    path = lab["base"] + f"bounties/{bounty.id}/workflow/"
    body = lab["client"](lab["member"]).get(path).json()
    assert body["current_node"] == "confirm"
    assert "confirm" in [row["action"] for row in body["actions"]]
    assert body["history"][0]["label"] == "认领获批"
    bounty.status = "review"
    bounty.save(update_fields=["status"])
    body = lab["client"](lab["reviewer"]).get(path).json()
    assert "accept" in [row["action"] for row in body["actions"]]
    assert "accept" not in [row["action"] for row in lab["client"](lab["member"]).get(path).json()["actions"]]
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert lab["client"](lab["member"]).get(path).status_code == 404


def test_reversal_action_belongs_to_project_lead_and_disappears_after_correction(laboratory):
    lab = laboratory
    bounty = make_bounty(lab)
    allocation = Allocation.objects.create(
        bounty=bounty,
        user=lab["member"],
        user_id_snapshot=lab["member"].id,
        user_name=lab["member"].display_name,
        deliverable="证据",
        planned=20,
        approved=True,
    )
    entry = Ledger.objects.create(
        bounty=bounty,
        allocation=allocation,
        delta=10,
        actor=lab["reviewer"],
        actor_name="验收人",
        reason="部分通过",
        task_snapshot={"id": str(bounty.issue_id), "title": bounty.title},
        participant_snapshot={"name": "成员"},
        request_key=uuid.uuid4(),
    )
    path = lab["base"] + f"bounties/{bounty.id}/workflow/"
    lead = lab["client"](lab["lead"])
    body = lead.get(path).json()
    assert next(row for row in body["actions"] if row["action"] == "reverse")["body"]["ledger_id"] == str(entry.id)
    assert "reverse" not in [row["action"] for row in lab["client"](lab["reviewer"]).get(path).json()["actions"]]
    assert (
        lead.post(
            lab["base"] + f"ledger/{entry.id}/reverse/",
            {
                "reason": "复查更正",
                "request_key": str(uuid.uuid4()),
            },
            format="json",
        ).status_code
        == 200
    )
    body = lead.get(path).json()
    assert "reverse" not in [row["action"] for row in body["actions"]]
    assert any(row["node_id"] == "reversal" for row in body["history"])


def begin_workflow(lab, major=False):
    lead = lab["client"](lab["lead"])
    assert (
        lead.put(
            lab["base"] + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    bounty = make_bounty(lab, major=major, independent_reviewer=lab["independent"] if major else None)

    def post(user, verb, data=None):
        response = lab["client"](user).post(lab["base"] + f"bounties/{bounty.id}/{verb}/", data or {}, format="json")
        assert response.status_code == 200, response.content
        return response

    allocation = post(lab["member"], "claim", {"deliverable": "复验记录", "planned": "20"}).json()["id"]
    post(lab["lead"], "approve", {"allocation_id": allocation})
    post(lab["member"], "confirm")
    post(lab["lead"], "start")
    return bounty, allocation, post


def test_partial_resubmit_and_pass_preserve_visited_results_then_reopen_to_acceptance(laboratory):
    lab = laboratory
    bounty, allocation, post = begin_workflow(lab)
    post(lab["member"], "submit", {"evidence": "首轮证据"})
    post(
        lab["reviewer"],
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "partial",
            "reason": "部分达到约定目标",
            "targets": {allocation: "10"},
        },
    )
    post(lab["member"], "submit", {"evidence": "复验补充证据"})
    post(
        lab["reviewer"],
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "pass",
            "reason": "全部达到约定目标",
            "targets": {allocation: "20"},
        },
    )
    path = lab["base"] + f"bounties/{bounty.id}/workflow/"
    lead = lab["client"](lab["lead"])
    graph = lead.get(path).json()
    states = {row["id"]: row["state"] for row in graph["nodes"]}
    assert graph["current_node"] == "done" and states["done"] == "current"
    assert states["partial"] == "completed" and states["rework"] == "upcoming"
    assert [row["created_at"] for row in graph["history"]] == sorted(row["created_at"] for row in graph["history"])
    entry = Ledger.objects.filter(bounty=bounty, delta__gt=0).order_by("created_at").first()
    assert (
        lead.post(
            lab["base"] + f"ledger/{entry.id}/reverse/",
            {
                "request_key": str(uuid.uuid4()),
                "reason": "贡献更正后复验",
            },
            format="json",
        ).status_code
        == 200
    )
    graph = lead.get(path).json()
    assert next(row for row in graph["actions"] if row["action"] == "reopen")["node_id"] == "acceptance"
    post(lab["lead"], "reopen", {"reason": "独立复验更正贡献"})
    graph = lead.get(path).json()
    states = {row["id"]: row["state"] for row in graph["nodes"]}
    assert graph["current_node"] == "acceptance" and states["acceptance"] == "current"
    assert states["done"] == "completed" and states["partial"] == "completed"
    assert graph["history"][-1]["label"] == "重新打开验收"
    assert graph["history"][-1]["node_id"] == "acceptance"
    assert {"id": "reversal-acceptance", "source": "reversal", "target": "acceptance"} in graph["edges"]
    assert not any(row["source"] == "reversal" and row["target"] == "active" for row in graph["edges"])


def test_major_result_node_becomes_visited_only_after_independent_approval(laboratory):
    lab = laboratory
    bounty, allocation, post = begin_workflow(lab, major=True)
    post(lab["member"], "submit", {"evidence": "重大任务证据"})
    acceptance = post(
        lab["reviewer"],
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "rework",
            "reason": "复核返工结果",
            "targets": {},
        },
    ).json()["id"]
    path = lab["base"] + f"bounties/{bounty.id}/workflow/"
    client = lab["client"](lab["lead"])
    graph = client.get(path).json()
    assert graph["current_node"] == "major_review"
    assert next(row for row in graph["nodes"] if row["id"] == "rework")["state"] == "upcoming"
    post(lab["independent"], "acceptance-review", {"acceptance_id": acceptance, "reason": "同意返工"})
    graph = client.get(path).json()
    assert graph["current_node"] == "rework"
    post(lab["member"], "submit", {"evidence": "返工完成"})
    accepted = post(
        lab["reviewer"],
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "pass",
            "reason": "达到约定目标",
            "targets": {allocation: "20"},
        },
    ).json()["id"]
    graph = client.get(path).json()
    assert next(row for row in graph["nodes"] if row["id"] == "done")["state"] == "upcoming"
    post(lab["independent"], "acceptance-review", {"acceptance_id": accepted, "reason": "同意通过"})
    graph = client.get(path).json()
    assert graph["current_node"] == "done"
    assert next(row for row in graph["nodes"] if row["id"] == "rework")["state"] == "completed"


@pytest.mark.parametrize("major", [False, True])
def test_flow_arrows_require_major_reviews_before_claim_and_outcomes(laboratory, major):
    lab = laboratory
    bounty = make_bounty(lab, major=major)
    graph = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty.id}/workflow/").json()
    edges = {(row["source"], row["target"]) for row in graph["edges"]}
    assert (("publication", "claim") in edges) is (not major)
    for outcome in ("done", "partial", "rework", "rejected"):
        assert (("acceptance", outcome) in edges) is (not major)
        assert (("major_review", outcome) in edges) is major
    assert (("publication", "publication_review") in edges) is major
    assert (("publication_review", "claim") in edges) is major
    assert (("acceptance", "major_review") in edges) is major
