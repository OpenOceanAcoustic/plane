# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta
from urllib.parse import urlencode

import pytest
from django.utils import timezone

from plane.lab.models import PersonalItem, TimeBlock
from .test_bounties import action, prepare
from .test_bounty_public_access import approve_cross, cross_member

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_native_readable_archived_reference_can_open_overview_without_editing(laboratory):
    lab = laboratory
    _, issue, _ = prepare(lab)
    issue.archived_at = timezone.now()
    issue.save(update_fields=["archived_at"])
    item = PersonalItem.objects.create(workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project")
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
    TimeBlock.objects.create(item=item, start=start, end=start + timedelta(hours=1))
    client = lab["client"](lab["member"])
    row = client.get(lab["base"] + "planner/").json()["items"][0]
    assert row["can_open_issue"] is True
    assert row["can_edit_issue"] is False
    assert row["archived"] is True
    query = urlencode({"start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat(), "team": 0})
    response = client.get(lab["base"] + "calendar/?" + query)
    assert response.status_code == 200
    event = response.json()["events"][0]
    assert event["can_open_issue"] is True
    assert event["can_edit_issue"] is False


def test_confirmed_task_grant_does_not_allow_native_issue_overview(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty, user)
    assert action(lab, user, bounty, "confirm").status_code == 200
    client = lab["client"](user)
    row = client.get(lab["base"] + "planner/").json()["items"][0]
    assert row["bounty_id"] == bounty
    assert row["can_open_issue"] is False
    assert row["can_edit_issue"] is False
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
    assert client.post(
        lab["base"] + "calendar/",
        {"item_id": row["id"], "start": start.isoformat(), "end": (start + timedelta(hours=1)).isoformat()},
        format="json",
    ).status_code == 201
    query = urlencode({"start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat(), "team": 0})
    response = client.get(lab["base"] + "calendar/?" + query)
    assert response.status_code == 200
    event = response.json()["events"][0]
    assert event["can_open_issue"] is False
    assert event["can_edit_issue"] is False
