# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
import pytest

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_custom_categories_drive_existing_blocks_and_preserve_manual_override(laboratory):
    lab = laboratory
    client, lead, base = lab["client"](lab["member"]), lab["client"](lab["lead"]), lab["base"]
    category = client.post(base + "categories/", {"name": "海试", "color": "#123ABC"}, format="json")
    assert category.status_code == 201
    category = category.json()
    item = client.post(base + "items/", {"title": "出海采样", "category_id": category["id"]}, format="json")
    assert item.status_code == 201
    times = {"start": "2026-10-09T09:00:00+08:00", "end": "2026-10-09T11:00:00+08:00"}
    block = client.post(base + "calendar/", {"item_id": item.json()["id"], **times}, format="json").json()
    query = "calendar/?start=2026-10-09T00:00:00%2B08:00&end=2026-10-10T00:00:00%2B08:00"
    event = client.get(base + query).json()["events"][0]
    assert event["category_name"] == "海试" and event["category_color"] == "#123abc" and event["color"] == ""
    assert lead.patch(base + f"categories/{category['id']}/", {"name": "窥探"}, format="json").status_code == 404
    assert (
        client.patch(
            base + f"categories/{category['id']}/", {"name": "现场实验", "color": "#abcdef"}, format="json"
        ).status_code
        == 200
    )
    assert client.get(base + query).json()["events"][0]["category_color"] == "#abcdef"
    assert (
        client.patch(
            base + f"calendar/{block['id']}/", {"expected_revision": 1, "color": "#e81295", **times}, format="json"
        ).status_code
        == 200
    )
    assert (
        client.patch(
            base + f"calendar/{block['id']}/",
            {"expected_revision": 2, "split_at": "2026-10-09T10:00:00+08:00"},
            format="json",
        ).status_code
        == 200
    )
    assert all(event["color"] == "#e81295" for event in client.get(base + query).json()["events"])
    hidden = lead.get(base + query + "&team=1").json()["events"]
    assert all(
        event["title"] == "忙碌" and not {"category_id", "category_name", "category_color", "color"}.intersection(event)
        for event in hidden
    )
    assert client.delete(base + f"categories/{category['id']}/").status_code == 204
    events = client.get(base + query).json()["events"]
    assert len(events) == 2 and all(event["category_id"] is None and event["color"] == "#e81295" for event in events)


def test_initial_categories_are_editable_and_deleting_all_does_not_reseed(laboratory):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    planner = client.get(base + "planner/").json()
    assert [row["name"] for row in planner["categories"]] == ["项目任务", "科研", "学习", "带教"]
    category = next(row for row in planner["categories"] if row["id"] == planner["default_category_id"])
    assert (
        client.patch(
            base + f"categories/{category['id']}/", {"name": "实测", "color": "#FEDCBA"}, format="json"
        ).status_code
        == 200
    )
    item = client.post(base + "items/", {"title": "旧接口兼容", "kind": "research"}, format="json").json()["id"]
    row = next(row for row in client.get(base + "planner/").json()["items"] if row["id"] == item)
    assert row["category_name"] == "实测" and row["category_color"] == "#fedcba"
    for category in planner["categories"]:
        assert client.delete(base + f"categories/{category['id']}/").status_code == 204
    after = client.get(base + "planner/").json()
    assert after["categories"] == [] and after["default_category_id"] is None
    assert after["items"][0]["category_id"] is None
    assert client.get(base + "categories/").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "color": "#123456"},
        {"name": " " * 4, "color": "#123456"},
        {"name": "x" * 41, "color": "#123456"},
        {"name": "实验", "color": "blue"},
        {"name": "实验", "color": "#123"},
        {"name": "实验", "color": "#123456;"},
        {"name": "实验", "color": None},
    ],
)
def test_category_validation_is_atomic(laboratory, body):
    lab = laboratory
    client, base = lab["client"](lab["member"]), lab["base"]
    category = client.get(base + "categories/").json()[0]
    assert client.post(base + "categories/", body, format="json").status_code == 400
    assert client.patch(base + f"categories/{category['id']}/", body, format="json").status_code == 400
    assert client.get(base + "categories/").json()[0] == category


def test_category_ownership_workspace_scope_and_project_reference(laboratory):
    from plane.db.models import Issue, Workspace, WorkspaceMember

    lab = laboratory
    client, lead, base = lab["client"](lab["member"]), lab["client"](lab["lead"]), lab["base"]
    category = client.post(base + "categories/", {"name": "海试", "color": "#123456"}, format="json").json()
    assert lead.delete(base + f"categories/{category['id']}/").status_code == 404
    assert (
        lead.post(base + "items/", {"title": "他人类别", "category_id": category["id"]}, format="json").status_code
        == 404
    )
    other = Workspace.objects.create(slug="other-lab", name="Other", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=other, member=lab["member"], role=15)
    other_base = "/api/workspaces/other-lab/lab/"
    assert (
        client.patch(other_base + f"categories/{category['id']}/", {"name": "跨区"}, format="json").status_code == 404
    )
    assert (
        client.post(other_base + "items/", {"title": "跨区", "category_id": category["id"]}, format="json").status_code
        == 404
    )
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="原任务", state=lab["states"]["todo"]
    )
    item = client.post(
        base + "items/", {"issue_id": str(issue.id), "category_id": category["id"]}, format="json"
    ).json()["id"]
    assert client.patch(base + f"items/{item}/", {"category_id": None}, format="json").status_code == 200
    assert client.patch(base + f"items/{item}/", {"category_id": category["id"]}, format="json").status_code == 200
    row = next(row for row in client.get(base + "planner/").json()["items"] if row["id"] == item)
    assert row["issue_id"] == str(issue.id) and row["kind"] == "project" and row["category_name"] == "海试"
    assert client.post(base + "categories/", {"name": "海试", "color": "#111111"}, format="json").status_code == 400
    assert lead.post(base + "categories/", {"name": "海试", "color": "#111111"}, format="json").status_code == 201


def test_category_analytics_and_exports_keep_private_metadata_hidden(laboratory):
    lab = laboratory
    client, lead, base = lab["client"](lab["member"]), lab["client"](lab["lead"]), lab["base"]
    category = client.post(base + "categories/", {"name": "PRIVATE_CATEGORY", "color": "#12abef"}, format="json").json()
    item = client.post(
        base + "items/", {"title": "PRIVATE_TITLE", "category_id": category["id"]}, format="json"
    ).json()["id"]
    client.post(
        base + "calendar/",
        {"item_id": item, "start": "2026-10-09T09:00:00+08:00", "end": "2026-10-09T11:00:00+08:00"},
        format="json",
    )
    query = "?start=2026-10-05&end=2026-10-12"
    own = client.get(base + "analytics/" + query).json()
    chart = next(row for row in own["charts"] if row["id"] == "schedule-kinds")
    assert chart["rows"] == [{"id": category["id"], "label": "PRIVATE_CATEGORY", "hours": 2}]
    for path in (
        "analytics/" + query + "&team=1",
        "analytics/" + query + "&team=1&format=csv",
        "planning-export/?team=1",
        "analytics/drilldown/" + query + "&team=1&chart=schedule-kinds&key=busy",
    ):
        response = lead.get(base + path)
        assert response.status_code == 200
        assert not any(
            secret in response.content.decode()
            for secret in ("PRIVATE_CATEGORY", "PRIVATE_TITLE", category["id"], "#12abef")
        )
    assert client.patch(base + f"items/{item}/", {"public": True}, format="json").status_code == 200
    visible = lead.get(
        base + "calendar/?start=2026-10-09T00:00:00%2B08:00&end=2026-10-10T00:00:00%2B08:00&team=1"
    ).json()["events"][0]
    assert visible["category_name"] == "PRIVATE_CATEGORY" and visible["category_color"] == "#12abef"


def test_concurrent_category_creation_initializes_once_and_rejects_duplicate_names(laboratory):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    from plane.lab.models import Audit, PersonalCategory

    lab, barrier = laboratory, Barrier(2)

    def create():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return (
                lab["client"](lab["member"])
                .post(lab["base"] + "categories/", {"name": "并发实验", "color": "#abcdef"}, format="json")
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: create(), range(2)))
    assert sorted(statuses) == [201, 400]
    assert PersonalCategory.objects.filter(user=lab["member"], workspace=lab["workspace"]).count() == 5
    assert (
        Audit.objects.filter(
            actor=lab["member"], workspace_id_snapshot=lab["workspace"].id, action="planning.categories_initialized"
        ).count()
        == 1
    )
