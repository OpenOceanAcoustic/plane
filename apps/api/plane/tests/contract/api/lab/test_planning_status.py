# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest

from plane.db.models import Issue, IssueActivity
from plane.lab.models import ProjectFlow

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
