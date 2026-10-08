# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import date, datetime
from uuid import UUID

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

import pytest

from plane.db.models import Issue, Project, ProjectMember, State
from plane.lab.models import TimeBlock

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_planner_cards_use_live_issue_metadata_and_no_invented_personal_deadline(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    issue = Issue.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        state=lab["states"]["todo"],
        name="原生任务",
        priority="high",
        target_date=date(2026, 10, 20),
    )
    linked = client.post(base + "items/", {"issue_id": str(issue.id)}, format="json")
    personal = client.post(base + "items/", {"title": "学习规划", "kind": "study"}, format="json")
    assert linked.status_code == personal.status_code == 201
    response = client.get(base + "planner/")
    assert response.status_code == 200
    items = {row["id"]: row for row in response.json()["items"]}
    row = items[linked.json()["id"]]
    assert row["issue_id"] == str(issue.id)
    assert row["project_name"] == "Acoustics"
    assert row["issue_key"] == "OA-1"
    assert row["priority"] == "high"
    assert row["target_date"] == "2026-10-20"
    private = items[personal.json()["id"]]
    assert {key: private[key] for key in ("project_name", "issue_key", "priority", "target_date")} == {
        "project_name": None,
        "issue_key": None,
        "priority": None,
        "target_date": None,
    }

    # Existing task edits must be reflected without copying task metadata into personal items.
    Issue.objects.filter(id=issue.id).update(priority="urgent", target_date=None, name="更新的原生任务")
    current = next(
        item for item in client.get(base + "planner/").json()["items"] if item["id"] == linked.json()["id"]
    )
    assert current["title"] == "更新的原生任务"
    assert current["priority"] == "urgent" and current["target_date"] is None


def test_planner_schedule_counts_live_blocks_and_clips_the_shanghai_week(laboratory, monkeypatch):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    now = datetime.fromisoformat("2026-10-08T12:00:00+08:00")
    monkeypatch.setattr(timezone, "now", lambda: now)
    item = client.post(base + "items/", {"title": "多段排期", "kind": "study"}, format="json").json()["id"]
    empty = client.post(base + "items/", {"title": "尚未排期", "kind": "research"}, format="json").json()["id"]
    # Worked example: this week includes 30 + 60 + 45 + 30 = 165 minutes.
    times = [
        ("2026-10-04T23:30:00+08:00", "2026-10-05T00:30:00+08:00"),
        ("2026-10-08T11:00:00+08:00", "2026-10-08T12:00:00+08:00"),
        ("2026-10-08T11:45:00+08:00", "2026-10-08T12:30:00+08:00"),
        ("2026-10-11T23:30:00+08:00", "2026-10-12T00:30:00+08:00"),
        ("2026-10-19T09:00:00+08:00", "2026-10-19T10:00:00+08:00"),
    ]
    for start, end in times:
        response = client.post(base + "calendar/", {"item_id": item, "start": start, "end": end}, format="json")
        assert response.status_code == 201
    response = client.get(base + "planner/")
    assert response.status_code == 200
    items = {row["id"]: row for row in response.json()["items"]}
    assert items[item]["schedule"] == {
        "future_count": 3,
        "next_start": "2026-10-08T03:45:00+00:00",
        "next_end": "2026-10-08T04:30:00+00:00",
        "week_minutes": 165,
        "total_count": 5,
    }
    assert items[empty]["schedule"] == {
        "future_count": 0,
        "next_start": None,
        "next_end": None,
        "week_minutes": 0,
        "total_count": 0,
    }


def test_planner_does_not_add_queries_for_each_project_task_card(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]

    def add_card(index):
        issue = Issue(
            workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name=f"任务 {index}"
        )
        issue.save(created_by_id=lab["lead"].id)
        assert client.post(base + "items/", {"issue_id": str(issue.id)}, format="json").status_code == 201

    add_card(0)
    assert client.get(base + "planner/").status_code == 200  # Initialize default folders outside measurement.
    with CaptureQueriesContext(connection) as one:
        response = client.get(base + "planner/")
    assert response.status_code == 200 and len(response.json()["items"]) == 1
    for index in range(1, 13):
        add_card(index)
    with CaptureQueriesContext(connection) as many:
        response = client.get(base + "planner/")
    assert response.status_code == 200 and len(response.json()["items"]) == 13
    assert len(many) <= len(one) + 2, f"Queries grew from {len(one)} to {len(many)} for twelve extra cards"


def test_planner_batches_project_choices_members_and_state_mappings(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    assert client.get(base + "planner/").status_code == 200
    with CaptureQueriesContext(connection) as one:
        response = client.get(base + "planner/")
    assert response.status_code == 200 and len(response.json()["projects"]) == 1
    for index in range(6):
        project = Project.objects.create(workspace=lab["workspace"], name=f"项目 {index}", identifier=f"P{index}")
        ProjectMember.objects.create(
            workspace=lab["workspace"], project=project, member=lab["member"], role=15
        )
        State.objects.create(workspace=lab["workspace"], project=project, name="待办", group="unstarted", default=True)
    with CaptureQueriesContext(connection) as many:
        response = client.get(base + "planner/")
    assert response.status_code == 200 and len(response.json()["projects"]) == 7
    added = next(project for project in response.json()["projects"] if project["name"] == "项目 0")
    assert added["members"] == [{"id": str(lab["member"].id), "name": "成员"}]
    assert added["states"][0]["name"] == "待办"
    assert added["mapping"] == {"todo": None, "active": None, "review": None, "done": None}
    assert len(many) <= len(one) + 2, f"Queries grew from {len(one)} to {len(many)} for six extra projects"


def test_next_schedule_uses_start_then_id_and_counts_overlapping_plan_minutes(laboratory, monkeypatch):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    monkeypatch.setattr(timezone, "now", lambda: datetime.fromisoformat("2026-10-08T12:00:00+08:00"))
    item_id = client.post(base + "items/", {"title": "重叠安排", "kind": "research"}, format="json").json()["id"]
    # Deliberately insert the larger id first: creation/database order must not decide the next block.
    for identifier, end in ((2, "2026-10-08T14:00:00+08:00"), (1, "2026-10-08T15:00:00+08:00")):
        TimeBlock.objects.create(
            id=UUID(int=identifier),
            item_id=item_id,
            start=datetime.fromisoformat("2026-10-08T13:00:00+08:00"),
            end=datetime.fromisoformat(end),
        )
    row = client.get(base + "planner/").json()["items"][0]
    assert row["schedule"] == {
        "future_count": 2,
        "next_start": "2026-10-08T05:00:00+00:00",
        "next_end": "2026-10-08T07:00:00+00:00",
        "week_minutes": 180,
        "total_count": 2,
    }


def test_week_uses_shanghai_monday_even_when_the_server_clock_is_utc_sunday(laboratory, monkeypatch):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    monkeypatch.setattr(timezone, "now", lambda: datetime.fromisoformat("2026-10-04T17:00:00+00:00"))
    item_id = client.post(base + "items/", {"title": "跨周安排", "kind": "study"}, format="json").json()["id"]
    for start, end in (
        ("2026-10-04T09:00:00+08:00", "2026-10-04T10:00:00+08:00"),
        ("2026-10-04T23:30:00+08:00", "2026-10-05T02:00:00+08:00"),
        ("2026-10-05T03:00:00+08:00", "2026-10-05T04:00:00+08:00"),
    ):
        assert client.post(
            base + "calendar/", {"item_id": item_id, "start": start, "end": end}, format="json"
        ).status_code == 201
    assert client.get(base + "planner/").json()["items"][0]["schedule"] == {
        "future_count": 2,
        "next_start": "2026-10-04T15:30:00+00:00",
        "next_end": "2026-10-04T18:00:00+00:00",
        "week_minutes": 180,
        "total_count": 3,
    }


def test_schedule_summary_tracks_splits_moves_and_deletes_without_treating_history_as_future(laboratory, monkeypatch):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    monkeypatch.setattr(timezone, "now", lambda: datetime.fromisoformat("2026-10-08T12:00:00+08:00"))
    item_id = client.post(base + "items/", {"title": "动态排期", "kind": "mentoring"}, format="json").json()["id"]
    created = client.post(
        base + "calendar/",
        {"item_id": item_id, "start": "2026-10-08T13:00:00+08:00", "end": "2026-10-08T14:00:00+08:00"},
        format="json",
    )
    assert created.status_code == 201
    path = base + f"calendar/{created.json()['id']}/"
    split = client.patch(path, {"expected_revision": 1, "split_at": "2026-10-08T13:30:00+08:00"}, format="json")
    assert split.status_code == 200
    assert client.get(base + "planner/").json()["items"][0]["schedule"] == {
        "future_count": 2,
        "next_start": "2026-10-08T05:00:00+00:00",
        "next_end": "2026-10-08T05:30:00+00:00",
        "week_minutes": 60,
        "total_count": 2,
    }
    moved = client.patch(
        path,
        {"expected_revision": 2, "start": "2026-10-07T11:00:00+08:00", "end": "2026-10-07T11:30:00+08:00"},
        format="json",
    )
    assert moved.status_code == 200
    assert client.delete(
        base + f"calendar/{split.json()['following_id']}/", {"expected_revision": 1}, format="json"
    ).status_code == 204
    assert client.get(base + "planner/").json()["items"][0]["schedule"] == {
        "future_count": 0,
        "next_start": None,
        "next_end": None,
        "week_minutes": 30,
        "total_count": 1,
    }


def test_metadata_and_schedule_follow_guest_revocation_and_team_busy_redaction(laboratory, monkeypatch):
    lab = laboratory
    client, lead, base = lab["client"](lab["member"]), lab["client"](lab["lead"]), lab["base"]
    monkeypatch.setattr(timezone, "now", lambda: datetime.fromisoformat("2026-10-08T12:00:00+08:00"))
    item_ids = []
    for creator, title in ((lab["lead"], "他人机密任务"), (lab["member"], "本人项目任务")):
        issue = Issue(
            workspace=lab["workspace"],
            project=lab["project"],
            state=lab["states"]["todo"],
            name=title,
            priority="urgent",
            target_date=date(2026, 10, 20),
        )
        issue.save(created_by_id=creator.id)
        response = client.post(base + "items/", {"issue_id": str(issue.id)}, format="json")
        assert response.status_code == 201
        item_ids.append(response.json()["id"])
    private = client.post(base + "items/", {"title": "私人资料", "kind": "study"}, format="json").json()["id"]
    for item_id in [*item_ids, private]:
        assert client.post(
            base + "calendar/",
            {"item_id": item_id, "start": "2026-10-08T13:00:00+08:00", "end": "2026-10-08T14:00:00+08:00"},
            format="json",
        ).status_code == 201
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    response = client.get(base + "planner/")
    assert {row["id"] for row in response.json()["items"]} == {item_ids[1], private}
    assert "他人机密任务" not in response.content.decode()
    own = next(row for row in response.json()["items"] if row["id"] == item_ids[1])
    assert own["issue_key"] == "OA-2" and own["schedule"]["future_count"] == 1
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    response = client.get(base + "planner/")
    assert [row["id"] for row in response.json()["items"]] == [private]
    assert response.json()["items"][0]["schedule"]["total_count"] == 1
    exported = client.get(base + "planning-export/")
    assert exported.status_code == 200
    assert "他人机密任务" not in exported.content.decode() and "本人项目任务" not in exported.content.decode()

    # Workspace administrators retain team access but lose details for revoked projects.
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(is_active=False)
    team = lead.get(
        base + "calendar/?team=1&start=2026-10-05T00:00:00%2B08:00&end=2026-10-12T00:00:00%2B08:00"
    )
    assert team.status_code == 200 and len(team.json()["events"]) == 3
    for event in team.json()["events"]:
        assert event["title"] == "忙碌" and event["editable"] is False
        assert set(event) == {"id", "user_id", "start", "end", "title", "editable"}
    assert "私人资料" not in team.content.decode() and "机密" not in team.content.decode()
