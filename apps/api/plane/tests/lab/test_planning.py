# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from plane.db.models import ProjectMember, Issue

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_default_folders_deletion_and_cross_view_issue_identity(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    base = lab["base"]
    response = client.get(base + "planner/")
    assert [row["name"] for row in response.json()["folders"]] == list("ABCD")
    folder = response.json()["folders"][0]["id"]
    issue = Issue.objects.create(
        project=lab["project"], workspace=lab["workspace"], name="Research", state=lab["states"]["todo"]
    )
    item = client.post(base + "items/", {"issue_id": str(issue.id), "folder_id": folder}, format="json")
    assert item.status_code == 201
    assert client.post(base + "items/", {"issue_id": str(issue.id)}, format="json").status_code == 400
    lead = lab["client"](lab["lead"])
    assert (
        lead.put(
            base + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    assert client.patch(base + f"items/{item.json()['id']}/", {"status": "active"}, format="json").status_code == 200
    issue.refresh_from_db()
    assert issue.state_id == lab["states"]["active"].id
    assert client.delete(base + f"folders/{folder}/").status_code == 204
    row = client.get(base + "planner/").json()["items"][0]
    assert row["folder_id"] is None and row["issue_id"] == str(issue.id) and row["status"] == "active"


def test_private_calendar_is_redacted_on_server_and_split_does_not_change_task_dates(laboratory):
    lab = laboratory
    member = lab["client"](lab["member"])
    lead = lab["client"](lab["lead"])
    base = lab["base"]
    item = member.post(
        base + "items/", {"title": "敏感的个人事项", "description": "不可泄露的资料", "kind": "research"}, format="json"
    ).json()["id"]
    body = {"item_id": item, "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T11:00:00+08:00"}
    block = member.post(base + "calendar/", body, format="json").json()["id"]
    query = "calendar/?team=1&start=2026-10-05T00:00:00%2B08:00&end=2026-10-12T00:00:00%2B08:00"
    response = lead.get(base + query)
    assert response.status_code == 200
    event = response.json()["events"][0]
    assert event["title"] == "忙碌" and "item_id" not in event and "issue_id" not in event
    assert "敏感" not in response.content.decode() and "不可泄露" not in response.content.decode()
    assert lead.patch(base + f"calendar/{block}/", body, format="json").status_code == 404
    assert member.get(base + query).status_code == 403
    assert (
        member.patch(base + f"calendar/{block}/", {"split_at": "2026-10-08T10:00:00+08:00"}, format="json").status_code
        == 200
    )
    assert len(member.get(base + query.replace("team=1", "team=0")).json()["events"]) == 2
    assert member.patch(base + f"items/{item}/", {"public": True}, format="json").status_code == 200
    assert lead.get(base + query).json()["events"][0]["title"] == "敏感的个人事项"


def test_guest_and_revoked_project_membership_cannot_leak_foreign_tasks(laboratory):
    from plane.lab.models import PersonalItem

    lab = laboratory
    client = lab["client"](lab["member"])
    base = lab["base"]
    issue = Issue(
        project=lab["project"], workspace=lab["workspace"], name="Foreign secret", state=lab["states"]["todo"]
    )
    issue.save(created_by_id=lab["lead"].id)
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert client.get(base + "tasks/?q=Foreign").json() == []
    assert client.post(base + "items/", {"issue_id": str(issue.id)}, format="json").status_code == 404
    # A reference created while a member had permission must be hidden after revocation too.
    PersonalItem.objects.create(workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project")
    assert client.get(base + "planner/").json()["items"] == []
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert client.get(base + "tasks/").json() == []
