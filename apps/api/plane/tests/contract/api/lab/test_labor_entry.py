# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime, timezone as datetime_timezone

import pytest
from django.db import close_old_connections

from plane.lab.management_models import ProjectManagementRecord
from plane.db.models import ProjectMember
from .test_project_management import approve, cost, ok, overview, path, post

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def team_body(lab, **values):
    return {
        "record_id": str(uuid.uuid4()),
        "expected_version": 0,
        "request_key": str(uuid.uuid4()),
        "data": {"name": "研发团队", "member_ids": [str(lab["lead"].id), str(lab["member"].id)]},
        **values,
    }


def team_post(lab, body, user=None):
    return lab["client"](user or lab["lead"]).post(
        lab["base"] + f"projects/{lab['project'].id}/labor-teams/", body, format="json"
    )


def batch_body(lab, **data):
    return {
        "kind": "cost",
        "action": "save-batch",
        "record_id": str(uuid.uuid4()),
        "expected_version": 0,
        "request_key": str(uuid.uuid4()),
        "data": {
            "category": "labor",
            "date": "2026-10-19",
            "work": "财务与质量管理开发",
            "lines": [
                {"user_id": str(lab["lead"].id), "hours": "5x8", "rate": "150"},
                {"user_id": str(lab["member"].id), "hours": "5×6", "rate": "100.10"},
            ],
            **data,
        },
    }


def batch_post(lab, body, user=None):
    return lab["client"](user or lab["lead"]).post(path(lab), body, format="json")


def test_cost_defaults_to_workspace_today_and_accepts_empty_optional_fields(laboratory, monkeypatch):
    monkeypatch.setattr("django.utils.timezone.now", lambda: datetime(2026, 10, 18, 17, tzinfo=datetime_timezone.utc))
    lab = laboratory
    row = ok(
        post(
            lab,
            "cost",
            {"category": "equipment", "user_id": str(lab["member"].id), "work": "设备费用", "actual_amount": "500"},
            reason="",
        )
    )
    assert row["data"]["date"] == "2026-10-19"
    assert row["reason"] == "" and row["data"]["evidence"] == ""
    assert overview(lab)["today"] == "2026-10-19"


def test_weekly_multiplication_has_explicit_period_and_cannot_be_partially_paid(laboratory):
    lab = laboratory
    row = cost(lab, hours="5 x 8", rate="150", date="2026-10-19")
    assert row["data"]["hours"] == "40.00" and row["data"]["amount"] == "6000.00"
    assert row["data"]["end_date"] == "2026-10-23" and row["data"]["hours_expression"] == "5x8"
    approve(lab, row)
    truncated = post(lab, "payroll", {"user_id": str(lab["member"].id), "start": "2026-10-19", "end": "2026-10-20"})
    assert truncated.status_code == 400
    full = ok(post(lab, "payroll", {"user_id": str(lab["member"].id), "start": "2026-10-19", "end": "2026-10-23"}))
    assert full["data"]["amount"] == "6000.00"
    assert full["data"]["lines"][0]["end_date"] == "2026-10-23"


@pytest.mark.parametrize("expression", ["0x8", "367x8", "5x25", "5x0", "5/8", "5x8x2", "__import__('os')", "5x-8"])
def test_invalid_work_hour_expressions_are_rejected(laboratory, expression):
    assert (
        post(
            laboratory,
            "cost",
            {
                "category": "labor",
                "user_id": str(laboratory["member"].id),
                "date": "2026-10-19",
                "work": "开发",
                "hours": expression,
                "rate": "150",
            },
        ).status_code
        == 400
    )


def test_period_approval_preserves_daily_limits_and_old_single_day_records(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="5*8", date="2026-10-19"))
    extra = cost(lab, hours="17", date="2026-10-21")
    assert post(lab, "cost", {"result": "approved", "note": "确认"}, row=extra, action="review").status_code == 400
    approve(lab, cost(lab, hours="16", date="2026-10-21"))


@pytest.mark.parametrize("end", [123, {}, "2026-02-30"])
def test_invalid_period_end_is_a_validation_error(laboratory, end):
    lab = laboratory
    assert (
        post(
            lab,
            "cost",
            {
                "category": "labor",
                "user_id": str(lab["member"].id),
                "date": "2026-10-19",
                "end_date": end,
                "work": "开发",
                "hours": "5x8",
                "rate": "150",
            },
        ).status_code
        == 400
    )


def test_teams_are_project_scoped_versioned_and_require_delegated_record_permission(laboratory):
    lab = laboratory
    body = team_body(lab)
    row = ok(team_post(lab, body))
    assert overview(lab)["teams"][0]["data"]["name"] == "研发团队"
    assert team_post(lab, body).json()["version_id"] == row["version_id"]
    assert team_post(lab, team_body(lab), user=lab["member"]).status_code == 403
    revised = team_body(lab, record_id=row["id"], expected_version=1)
    revised["data"]["member_ids"] = [str(lab["member"].id)]
    assert ok(team_post(lab, revised))["version"] == 2
    stale = team_body(lab, record_id=row["id"], expected_version=1)
    assert team_post(lab, stale).status_code == 409
    assert overview(lab, user=lab["member"])["teams"] == []
    duplicate = team_body(lab)
    assert team_post(lab, duplicate).status_code == 400


def test_batch_save_is_atomic_and_exactly_idempotent(laboratory):
    lab = laboratory
    team = ok(team_post(lab, team_body(lab)))
    body = batch_body(lab, team_id=team["id"])
    result = ok(batch_post(lab, body))
    assert result["total"] == "9003.00" and len(result["records"]) == 2
    assert {row["data"]["team_name"] for row in result["records"]} == {"研发团队"}
    assert ok(batch_post(lab, body)) == result
    assert ProjectManagementRecord.objects.filter(kind="cost").count() == 2
    body["data"]["work"] = "不同正文"
    assert batch_post(lab, body).status_code == 409


def test_team_rejects_inactive_project_members_and_cross_endpoint_request_keys(laboratory):
    lab = laboratory
    row = cost(lab)
    source = ProjectManagementRecord.objects.get(id=row["version_id"])
    assert team_post(lab, source.request_snapshot).status_code == 409
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert team_post(lab, team_body(lab)).status_code == 404
    assert not ProjectManagementRecord.objects.filter(kind="team").exists()


def test_batch_invalid_or_unauthorized_member_rolls_back_every_row(laboratory):
    lab = laboratory
    body = batch_body(lab)
    body["data"]["lines"][1]["rate"] = "-1"
    assert batch_post(lab, body).status_code == 400
    assert ProjectManagementRecord.objects.filter(kind__in=("cost", "labor-batch")).count() == 0
    assert batch_post(lab, batch_body(lab), user=lab["member"]).status_code == 403
    assert ProjectManagementRecord.objects.filter(kind="cost").count() == 0
    duplicate = batch_body(lab)
    duplicate["data"]["lines"][1]["user_id"] = duplicate["data"]["lines"][0]["user_id"]
    assert batch_post(lab, duplicate).status_code == 400


def test_concurrent_batch_retries_create_each_cost_once(laboratory):
    lab = laboratory
    body = batch_body(lab)
    barrier = Barrier(2)

    def submit():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return batch_post(lab, body).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert results == [201, 201]
    assert ProjectManagementRecord.objects.filter(kind="cost").count() == 2
