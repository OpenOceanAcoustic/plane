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
        member.patch(
            base + f"calendar/{block}/",
            {"expected_revision": 1, "split_at": "2026-10-08T10:00:00+08:00"},
            format="json",
        ).status_code
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


def test_cross_project_references_and_calendar_never_change_native_dates(laboratory):
    from datetime import date
    from plane.db.models import Project, State

    lab = laboratory
    member = lab["client"](lab["member"])
    project = Project.objects.create(workspace=lab["workspace"], name="Field study", identifier="FS")
    ProjectMember.objects.create(workspace=lab["workspace"], project=project, member=lab["member"], role=15)
    state = State.objects.create(
        workspace=lab["workspace"], project=project, name="Waiting", group="unstarted", default=True
    )
    issue = Issue.objects.create(
        workspace=lab["workspace"],
        project=project,
        name="Cross-project reference",
        state=state,
        start_date=date(2026, 9, 1),
        target_date=date(2026, 12, 31),
    )
    response = member.post(lab["base"] + "items/", {"issue_id": str(issue.id)}, format="json")
    assert response.status_code == 201
    row = member.get(lab["base"] + "planner/").json()["items"][0]
    assert row["project_id"] == str(project.id) and row["issue_id"] == str(issue.id)
    body = {"item_id": response.json()["id"], "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T11:00:00+08:00"}
    block = member.post(lab["base"] + "calendar/", body, format="json").json()["id"]
    assert (
        member.patch(
            lab["base"] + f"calendar/{block}/",
            {"expected_revision": 1, "split_at": "2026-10-08T10:00:00+08:00"},
            format="json",
        ).status_code
        == 200
    )
    assert (
        member.patch(
            lab["base"] + f"calendar/{block}/",
            {"expected_revision": 2, "start": "2026-10-09T09:00:00+08:00", "end": "2026-10-09T10:00:00+08:00"},
            format="json",
        ).status_code
        == 200
    )
    issue.refresh_from_db()
    assert issue.start_date == date(2026, 9, 1) and issue.target_date == date(2026, 12, 31)


def test_calendar_revision_rejects_stale_updates_splits_and_deletes(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    item = client.post(base + "items/", {"title": "并发排期", "kind": "study"}, format="json").json()["id"]
    created = client.post(
        base + "calendar/",
        {"item_id": item, "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T11:00:00+08:00"},
        format="json",
    )
    assert created.status_code == 201
    block = created.json()
    assert block["revision"] == 1
    path = base + f"calendar/{block['id']}/"
    moved = client.patch(
        path,
        {"expected_revision": 1, "start": "2026-10-08T10:00:00+08:00", "end": "2026-10-08T12:00:00+08:00"},
        format="json",
    )
    assert moved.status_code == 200 and moved.json()["revision"] == 2
    assert (
        client.patch(path, {"expected_revision": 1, "split_at": "2026-10-08T11:00:00+08:00"}, format="json").status_code
        == 409
    )
    assert client.delete(path, {"expected_revision": 1}, format="json").status_code == 409
    split = client.patch(path, {"expected_revision": 2, "split_at": "2026-10-08T11:00:00+08:00"}, format="json")
    assert split.status_code == 200 and split.json()["revision"] == 3
    assert split.json()["following_revision"] == 1
    assert client.delete(path, {"expected_revision": 3}, format="json").status_code == 204
    events = client.get(base + "calendar/?start=2026-10-08T00:00:00%2B08:00&end=2026-10-09T00:00:00%2B08:00").json()[
        "events"
    ]
    assert len(events) == 1 and events[0]["start"].startswith("2026-10-08T03:00:00")


def test_team_project_filter_does_not_classify_or_expose_private_busy_blocks(laboratory):
    lab = laboratory
    client, lead, base = lab["client"](lab["member"]), lab["client"](lab["lead"]), lab["base"]
    item = client.post(
        base + "items/", {"title": "绝不能出现在筛选结果的秘密", "kind": "research"}, format="json"
    ).json()["id"]
    block = client.post(
        base + "calendar/",
        {"item_id": item, "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T10:00:00+08:00"},
        format="json",
    ).json()
    query = (
        f"calendar/?team=1&project_id={lab['project'].id}&user_id={lab['member'].id}"
        "&start=2026-10-01T00:00:00%2B08:00&end=2026-11-12T00:00:00%2B08:00"
    )
    response = lead.get(base + query)
    assert response.status_code == 200
    event = response.json()["events"][0]
    assert event["title"] == "忙碌" and event["user_id"] == str(lab["member"].id)
    assert event["editable"] is False and event["id"] != block["id"]
    assert not {"item_id", "project_id", "kind", "revision", "description"}.intersection(event)
    assert "绝不能" not in response.content.decode()


def test_folder_order_and_delete_preserve_personal_item_through_public_api(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    folders = client.get(base + "planner/").json()["folders"]
    ids = [row["id"] for row in reversed(folders)]
    assert client.put(base + "folders/", {"ids": ids}, format="json").status_code == 200
    assert [row["id"] for row in client.get(base + "planner/").json()["folders"]] == ids
    item = client.post(
        base + "items/", {"title": "保留的学习事项", "kind": "study", "folder_id": ids[0]}, format="json"
    ).json()["id"]
    assert client.patch(base + f"folders/{ids[0]}/", {"name": "学习"}, format="json").status_code == 200
    assert client.delete(base + f"folders/{ids[0]}/").status_code == 204
    row = next(row for row in client.get(base + "planner/").json()["items"] if row["id"] == item)
    assert row["folder_id"] is None and row["title"] == "保留的学习事项"


def test_concurrent_calendar_saves_accept_only_one_revision(laboratory):
    from concurrent.futures import ThreadPoolExecutor
    from django.db import connections

    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    item = client.post(base + "items/", {"title": "并发修改", "kind": "study"}, format="json").json()["id"]
    block = client.post(
        base + "calendar/",
        {"item_id": item, "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T10:00:00+08:00"},
        format="json",
    ).json()

    def save(hour):
        try:
            worker = lab["client"](lab["member"])
            return worker.patch(
                base + f"calendar/{block['id']}/",
                {
                    "expected_revision": 1,
                    "start": f"2026-10-08T{hour}:00:00+08:00",
                    "end": f"2026-10-08T{hour}:30:00+08:00",
                },
                format="json",
            ).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(save, ("11", "12")))
    assert sorted(statuses) == [200, 409]
    events = client.get(base + "calendar/?start=2026-10-08T00:00:00%2B08:00&end=2026-10-09T00:00:00%2B08:00").json()[
        "events"
    ]
    assert len(events) == 1 and events[0]["revision"] == 2


def test_task_picker_project_filter_enforces_scope_before_returning_results(laboratory):
    from plane.db.models import Project, State

    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    original = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="同项目任务", state=lab["states"]["todo"]
    )
    foreign_project = Project.objects.create(workspace=lab["workspace"], name="另一项目", identifier="OTHER")
    membership = ProjectMember.objects.create(
        workspace=lab["workspace"], project=foreign_project, member=lab["member"], role=15
    )
    state = State.objects.create(
        workspace=lab["workspace"], project=foreign_project, name="todo", group="unstarted", default=True
    )
    Issue.objects.create(workspace=lab["workspace"], project=foreign_project, name="另一个项目的任务", state=state)
    response = client.get(base + f"tasks/?project_id={lab['project'].id}")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(original.id)]
    membership.is_active = False
    membership.save(update_fields=["is_active"])
    assert client.get(base + f"tasks/?project_id={foreign_project.id}").status_code == 404
    assert client.get(base + "tasks/?project_id=bad-id").status_code == 400
