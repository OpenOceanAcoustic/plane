# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from plane.db.models import Issue, ProjectMember
from .test_bounties import action, prepare, start

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]

QUERY = "?start=2026-10-05&end=2026-10-12"


def charts(response):
    assert response.status_code == 200
    return {row["id"]: row for row in response.json()["charts"]}


def test_twelve_charts_use_actual_project_records_and_permissions(laboratory):
    lab = laboratory
    issue = Issue.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        name="Visible study",
        state=lab["states"]["done"],
        start_date=date(2026, 10, 5),
        target_date=date(2026, 10, 8),
    )
    Issue.objects.filter(id=issue.id).update(
        created_at=datetime(2026, 10, 5, 16, tzinfo=ZoneInfo("UTC")),
        completed_at=datetime(2026, 10, 7, 16, tzinfo=ZoneInfo("UTC")),
    )
    client = lab["client"](lab["member"])
    data = charts(client.get(lab["base"] + "analytics/" + QUERY))
    assert len(data) == 12
    assert next(row for row in data["project-status"]["rows"] if row["id"] == "done")["count"] == 1
    assert data["project-completion"]["rows"][0]["percentage"] == 100
    trend = {row["id"]: row for row in data["project-trend"]["rows"]}
    assert trend["2026-10-06"]["created"] == 1
    assert trend["2026-10-08"]["completed"] == 1
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    hidden = client.get(lab["base"] + "analytics/" + QUERY)
    assert "Visible study" not in hidden.content.decode()
    assert charts(hidden)["project-completion"]["rows"] == []


def test_schedule_charts_clip_time_count_overlap_and_redact_private_details(laboratory):
    lab = laboratory
    member, lead = lab["client"](lab["member"]), lab["client"](lab["lead"])
    item = member.post(
        lab["base"] + "items/",
        {"title": "NEVER_EXPOSE_PRIVATE_TITLE", "description": "secret payload", "kind": "study"},
        format="json",
    ).json()["id"]
    for block_start, block_end in (
        ("2026-10-08T09:00:00+08:00", "2026-10-08T11:00:00+08:00"),
        ("2026-10-08T10:00:00+08:00", "2026-10-08T12:00:00+08:00"),
    ):
        assert (
            member.post(
                lab["base"] + "calendar/", {"item_id": item, "start": block_start, "end": block_end}, format="json"
            ).status_code
            == 201
        )
    response = lead.get(lab["base"] + "analytics/" + QUERY + "&team=1")
    data = charts(response)
    hours = next(row for row in data["schedule-hours"]["rows"] if row["user_id"] == str(lab["member"].id))
    assert hours["hours"] == 4
    overlap = next(row for row in data["schedule-overlap"]["rows"] if row["id"] == "2026-10-08")
    assert overlap["overlap_hours"] == 1 and overlap["busy_hours"] == 3
    assert "NEVER_EXPOSE" not in response.content.decode() and "secret payload" not in response.content.decode()
    assert {row["id"] for row in data["schedule-kinds"]["rows"]} == {"busy"}
    assert member.get(lab["base"] + "analytics/" + QUERY + "&team=1").status_code == 403
    details = lead.get(lab["base"] + "analytics/drilldown/" + QUERY + "&team=1&chart=schedule-hours&key=" + hours["id"])
    assert details.status_code == 200
    assert "NEVER_EXPOSE" not in details.content.decode() and "item_id" not in details.content.decode()
    assert all(row["title"] == "忙碌" and row["url"] is None for row in details.json()["records"])


def test_analytics_exports_and_bad_ranges_do_not_bypass_permissions(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    item = client.post(lab["base"] + "items/", {"title": "=HYPERLINK(unsafe)", "kind": "study"}, format="json").json()[
        "id"
    ]
    client.post(
        lab["base"] + "calendar/",
        {"item_id": item, "start": "2026-10-08T09:00:00+08:00", "end": "2026-10-08T10:00:00+08:00"},
        format="json",
    )
    csv_response = client.get(
        lab["base"]
        + "analytics/drilldown/"
        + QUERY
        + "&chart=schedule-hours&key="
        + str(lab["member"].id)
        + ":2026-10-05&format=csv"
    )
    assert csv_response.status_code == 200 and csv_response["Content-Type"].startswith("text/csv")
    assert "'=HYPERLINK" in csv_response.content.decode()
    assert client.get(lab["base"] + "analytics/?start=bad&end=2026-10-12").status_code == 400
    assert client.get(lab["base"] + "analytics/?start=2026-10-12&end=2026-10-05").status_code == 400
    assert client.get(lab["base"] + "analytics/" + QUERY + "&user_id=" + str(lab["lead"].id)).status_code == 403


def test_member_hours_are_separate_monday_weeks_and_clip_cross_week_blocks(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    item = client.post(lab["base"] + "items/", {"title": "周边界科研", "kind": "research"}, format="json").json()["id"]
    assert (
        client.post(
            lab["base"] + "calendar/",
            {"item_id": item, "start": "2026-10-11T23:00:00+08:00", "end": "2026-10-12T02:00:00+08:00"},
            format="json",
        ).status_code
        == 201
    )
    chart = charts(client.get(lab["base"] + "analytics/?start=2026-10-05&end=2026-10-19"))["schedule-hours"]
    assert [(row["week"], row["hours"]) for row in chart["rows"]] == [("2026-10-05", 1), ("2026-10-12", 2)]
    for row in chart["rows"]:
        response = client.get(
            lab["base"] + "analytics/drilldown/?start=2026-10-05&end=2026-10-19&chart=schedule-hours&key=" + row["id"]
        )
        assert response.status_code == 200
        assert sum(record["value"] for record in response.json()["records"]) == row["hours"]


def test_vc_charts_follow_delta_ledger_reversals_and_preserve_deleted_task_snapshots(laboratory):
    import uuid

    lab = laboratory
    bounty, issue, _ = prepare(lab, stage_budget="100")
    allocation = start(lab, bounty)
    lead = lab["client"](lab["lead"])
    for result, amount in (("partial", "10"), ("negative", "20")):
        assert action(lab, lab["member"], bounty, "submit", {"evidence": "reproducible dataset"}).status_code == 200
        body = {
            "request_key": str(uuid.uuid4()),
            "result": result,
            "reason": "independent check",
            "targets": {allocation: amount},
        }
        assert action(lab, lab["reviewer"], bounty, "accept", body).status_code == 200
        assert action(lab, lab["reviewer"], bounty, "accept", body).status_code == 200
    entries = lead.get(lab["base"] + "ledger/").json()
    first = next(row for row in entries if row["delta"] == "10.00")
    reverse_body = {"request_key": str(uuid.uuid4()), "reason": "audit correction"}
    assert lead.post(lab["base"] + f"ledger/{first['id']}/reverse/", reverse_body, format="json").status_code == 200
    query = QUERY + "&project_id=" + str(lab["project"].id)
    data = charts(lead.get(lab["base"] + "analytics/" + query))
    budget = data["vc-budget"]["rows"][0]
    assert budget["budget"] == 100 and budget["awarded"] == 10
    assert budget["available"] + budget["reserved"] + budget["awarded"] == 100
    participant = data["vc-participants"]["rows"][0]
    assert participant["planned"] == 20 and participant["awarded"] == 10
    assert sum(row["awarded"] for row in data["vc-trend"]["rows"]) == 20
    assert sum(row["reversed"] for row in data["vc-trend"]["rows"]) == 10
    assert {row["id"]: row["count"] for row in data["vc-acceptance"]["rows"]} == {"partial": 1, "negative": 1}
    assert charts(lead.get(lab["base"] + "analytics/" + QUERY))["vc-participants"]["rows"] == []
    issue.delete(soft=False)
    details = lead.get(
        lab["base"] + "analytics/drilldown/" + query + "&chart=vc-participants&key=" + str(lab["member"].id)
    )
    assert details.status_code == 200
    assert "Team task" in details.content.decode()
    assert all(row["url"] is None for row in details.json()["records"])
