# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

import pytest

from plane.db.models import Issue, IssueActivity, IssueAssignee
from plane.lab.models import ProjectFlow

from .test_bounties import action, prepare

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_referenced_project_status_uses_native_states_without_a_lab_flow(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    issue = Issue.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        name="Referenced project task",
        state=lab["states"]["active"],
    )
    item = client.post(base + "items/", {"issue_id": str(issue.id)}, format="json")
    assert item.status_code == 201
    path = base + f"items/{item.json()['id']}/"
    assert not ProjectFlow.objects.filter(project=lab["project"]).exists()

    old_state, old_version = issue.state_id, issue.updated_at
    for status in ("todo", "active", "done"):
        response = client.patch(path, {"status": status}, format="json")
        assert response.status_code == 200, response.content
        issue.refresh_from_db()
        assert issue.state_id == lab["states"][status].id
        assert issue.updated_at > old_version
        assert issue.updated_by_id == lab["member"].id
        assert bool(issue.completed_at) == (status == "done")
        row = next(row for row in client.get(base + "planner/").json()["items"] if row["id"] == item.json()["id"])
        assert row["status"] == status and row["issue_id"] == str(issue.id)
        activity = IssueActivity.objects.filter(issue=issue, field="state").latest("created_at")
        assert activity.actor_id == lab["member"].id
        assert activity.old_identifier == old_state
        assert activity.new_identifier == issue.state_id
        old_state, old_version = issue.state_id, issue.updated_at

    assert IssueActivity.objects.filter(issue=issue, field="state").count() == 3
    assert client.patch(path, {"status": "done"}, format="json").status_code == 200
    assert IssueActivity.objects.filter(issue=issue, field="state").count() == 3
    # A dedicated review state still needs an explicit mapping; do not silently
    # alias review to the first started state of a native project.
    assert client.patch(path, {"status": "review"}, format="json").status_code == 400
    issue.refresh_from_db()
    assert issue.state_id == lab["states"]["done"].id
    assert IssueActivity.objects.filter(issue=issue, field="state").count() == 3
    assert not ProjectFlow.objects.filter(project=lab["project"]).exists()


def test_open_bounty_planning_state_changes_explain_team_start_without_mutating_task_or_budget(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    lead, base = lab["client"](lab["lead"]), lab["base"]
    item = lead.post(base + "items/", {"issue_id": str(issue.id)}, format="json")
    assert item.status_code == 201
    path = base + f"items/{item.json()['id']}/"
    original = lead.get(base + f"bounties/{bounty}/detail/").json()
    assert original["status"] == "open" and original["allocations"] == []

    for status in ("active", "review", "done"):
        response = lead.patch(path, {"status": status}, format="json")
        assert response.status_code == 400, response.content
        assert "团队开工" in str(response.json()) and "悬赏详情" in str(response.json())
        row = next(row for row in lead.get(base + "planner/").json()["items"] if row["id"] == item.json()["id"])
        assert row["status"] == "todo"
        current = lead.get(base + f"bounties/{bounty}/detail/").json()
        assert current["status"] == "open"
        assert (current["budget"], current["reserved"], current["awarded"]) == (
            original["budget"],
            original["reserved"],
            original["awarded"],
        )
    assert lead.patch(path, {"status": "todo"}, format="json").status_code == 200


def test_confirmed_bounty_requires_explicit_start_submission_and_independent_acceptance(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    member, base = lab["client"](lab["member"]), lab["base"]
    claimed = action(lab, lab["member"], bounty, "claim", {"planned": "20", "deliverable": "Dataset"})
    assert claimed.status_code == 200
    allocation = claimed.json()["id"]
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code == 200
    assert action(lab, lab["member"], bounty, "confirm").status_code == 200
    item = next(row for row in member.get(base + "planner/").json()["items"] if row["issue_id"] == str(issue.id))
    path = base + f"items/{item['id']}/"
    ready = member.patch(path, {"status": "done"}, format="json")
    assert ready.status_code == 400 and "团队开工" in str(ready.json())
    assert action(lab, lab["member"], bounty, "start").status_code == 403
    assert action(lab, lab["lead"], bounty, "start").status_code == 200

    for status in ("done", "review", "todo"):
        response = member.patch(path, {"status": status}, format="json")
        assert response.status_code == 400, response.content
        assert "提交成果验收" in str(response.json())
        item = next(row for row in member.get(base + "planner/").json()["items"] if row["id"] == item["id"])
        assert item["status"] == "active"
        current = member.get(base + f"bounties/{bounty}/detail/").json()
        assert current["status"] == "active" and current["awarded"] == "0"
        assert current["budget"] == "20.00" and current["reserved"] == "20.00"
    assert member.patch(path, {"status": "active"}, format="json").status_code == 200

    assert action(lab, lab["member"], bounty, "submit", {"evidence": "Dataset v1"}).status_code == 200
    response = member.patch(path, {"status": "done"}, format="json")
    assert response.status_code == 400 and "独立验收" in str(response.json())
    acceptance = {
        "request_key": str(uuid.uuid4()),
        "result": "pass",
        "reason": "Evidence verified",
        "targets": {allocation: "20"},
    }
    assert action(lab, lab["member"], bounty, "accept", acceptance).status_code == 403
    assert action(lab, lab["reviewer"], bounty, "accept", acceptance).status_code == 200
    assert member.patch(path, {"status": "done"}, format="json").status_code == 200
    response = member.patch(path, {"status": "active"}, format="json")
    assert response.status_code == 400 and "更正" in str(response.json())
    final = member.get(base + f"bounties/{bounty}/detail/").json()
    assert final["status"] == "done" and final["awarded"] == "20.00"


def test_native_work_limit_explains_parallel_tasks_without_unrelated_finance_or_acceptance_reasons(laboratory):
    lab = laboratory
    member, base = lab["client"](lab["member"]), lab["base"]
    configured = lab["client"](lab["lead"]).put(
        base + f"flows/{lab['project'].id}/",
        {key: str(state.id) for key, state in lab["states"].items()},
        format="json",
    )
    assert configured.status_code == 200
    for index in range(3):
        issue = Issue.objects.create(
            workspace=lab["workspace"],
            project=lab["project"],
            name=f"Parallel task {index}",
            state=lab["states"]["todo"],
        )
        IssueAssignee.objects.create(
            workspace=lab["workspace"], project=lab["project"], issue=issue, assignee=lab["member"]
        )
        item = member.post(base + "items/", {"issue_id": str(issue.id)}, format="json")
        assert item.status_code == 201
        response = member.patch(base + f"items/{item.json()['id']}/", {"status": "active"}, format="json")
        if index < 2:
            assert response.status_code == 200, response.content
        else:
            assert response.status_code == 409
            assert "并行上限" in response.json()["error"]
            assert "冻结预算" not in response.json()["error"] and "独立验收" not in response.json()["error"]
            current = next(
                row for row in member.get(base + "planner/").json()["items"] if row["id"] == item.json()["id"]
            )
            assert current["status"] == "todo"
