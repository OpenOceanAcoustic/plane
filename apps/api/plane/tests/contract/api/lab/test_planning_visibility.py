# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest

from plane.db.models import User, Workspace, WorkspaceMember
from plane.lab.bounty_models import BountyPublication
from plane.lab.models import PersonalItem
from .test_bounties import action, prepare

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_visibility_migration_preserves_old_personal_scope_and_backfills_bounty_publication(laboratory):
    from importlib import import_module
    from django.apps import apps
    from django.db import connection

    lab = laboratory
    private = PersonalItem.objects.create(user=lab["member"], workspace=lab["workspace"], title="私有", public=False)
    legacy = PersonalItem.objects.create(
        user=lab["member"], workspace=lab["workspace"], title="原负责人公开", public=True
    )
    bounty, _, _ = prepare(lab)
    BountyPublication.objects.filter(bounty_id=bounty).delete()
    migrate = import_module("plane.lab.migrations.0017_planning_visibility").preserve_visibility_and_publish_bounties
    with connection.schema_editor() as editor:
        migrate(apps, editor)
    private.refresh_from_db()
    legacy.refresh_from_db()
    assert private.visibility == "private" and legacy.visibility == "leads"
    publication = BountyPublication.objects.get(bounty_id=bounty)
    assert publication.enabled and publication.deliverable and publication.criteria
    assert len(shared(lab, lab["lead"])) == 1 and shared(lab, lab["reviewer"]) == []


def create(lab, visibility="private", recipients=None):
    client = lab["client"](lab["member"])
    response = client.post(
        lab["base"] + "items/",
        {
            "title": "规划内容",
            "description": "实验详细计划",
            "visibility": visibility,
            "shared_user_ids": recipients or [],
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    identifier = response.json()["id"]
    block = client.post(
        lab["base"] + "calendar/",
        {"item_id": identifier, "start": "2026-10-12T09:00:00+08:00", "end": "2026-10-12T10:00:00+08:00"},
        format="json",
    )
    assert block.status_code == 201
    return identifier, block.json()["id"]


def shared(lab, user):
    return lab["client"](user).get(lab["base"] + "planner/").json()["shared_items"]


def calendar(lab, user):
    response = lab["client"](user).get(
        lab["base"] + "calendar/?team=1&start=2026-10-12T00:00:00%2B08:00&end=2026-10-13T00:00:00%2B08:00"
    )
    assert response.status_code == 200, response.content
    return response.json()["events"]


@pytest.mark.parametrize("visibility", ["private", "organization", "selected"])
def test_item_scope_filters_feed_details_calendar_and_is_read_only(laboratory, visibility):
    lab = laboratory
    recipients = [str(lab["reviewer"].id)] if visibility == "selected" else []
    identifier, block = create(lab, visibility, recipients)
    for user in (lab["lead"], lab["reviewer"], lab["independent"]):
        allowed = visibility == "organization" or visibility == "selected" and user == lab["reviewer"]
        client = lab["client"](user)
        assert bool(shared(lab, user)) is allowed
        response = client.get(lab["base"] + f"items/{identifier}/")
        assert response.status_code == (200 if allowed else 404)
        events = calendar(lab, user)
        assert any(event["title"] == "规划内容" for event in events) is allowed
        if allowed:
            assert response.json()["description"] == "实验详细计划"
            assert not response.json()["editable"] and response.json()["shared_user_ids"] == []
            assert all(not event["editable"] and "revision" not in event for event in events)
        elif user == lab["lead"]:
            assert len(events) == 1 and events[0]["title"] == "忙碌" and "item_id" not in events[0]
        else:
            assert events == []
        for method, endpoint, body in [
            ("patch", f"items/{identifier}/", {"title": "越权"}),
            ("delete", f"items/{identifier}/", {}),
            ("patch", f"calendar/{block}/", {"expected_revision": 1}),
            ("delete", f"calendar/{block}/", {"expected_revision": 1}),
            ("post", "calendar/", {"item_id": identifier}),
        ]:
            assert getattr(client, method)(lab["base"] + endpoint, body, format="json").status_code == 404
    assert PersonalItem.objects.get(id=identifier).title == "规划内容"


def test_target_revocation_and_current_workspace_membership_apply_immediately(laboratory):
    lab = laboratory
    identifier, _ = create(lab, "selected", [str(lab["reviewer"].id), str(lab["independent"].id)])
    owner = lab["client"](lab["member"])
    endpoint = lab["base"] + f"items/{identifier}/"
    assert len(shared(lab, lab["reviewer"])) == len(shared(lab, lab["independent"])) == 1
    assert (
        owner.patch(
            endpoint, {"visibility": "selected", "shared_user_ids": [str(lab["independent"].id)]}, format="json"
        ).status_code
        == 200
    )
    assert shared(lab, lab["reviewer"]) == [] and calendar(lab, lab["reviewer"]) == []
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["independent"]).update(is_active=False)
    assert lab["client"](lab["independent"]).get(endpoint).status_code == 403
    assert owner.patch(endpoint, {"visibility": "organization"}, format="json").status_code == 200
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert shared(lab, lab["reviewer"]) == []
    assert lab["client"](lab["reviewer"]).get(endpoint).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"visibility": "selected", "shared_user_ids": []},
        {"visibility": "unknown"},
        {"visibility": "selected", "shared_user_ids": ["bad-id"]},
        {"visibility": "selected", "shared_user_ids": "bad"},
    ],
)
def test_invalid_sharing_does_not_partially_update_item(laboratory, body):
    lab = laboratory
    identifier, _ = create(lab)
    response = lab["client"](lab["member"]).patch(
        lab["base"] + f"items/{identifier}/", {"title": "不应保存", **body}, format="json"
    )
    assert response.status_code == 400
    assert PersonalItem.objects.get(id=identifier).title == "规划内容"


def test_foreign_workspace_targets_are_rejected_and_legacy_public_stays_lead_only(laboratory):
    lab = laboratory
    user = User.objects.create(username="other-org", email="other@example.org")
    organization = Workspace.objects.create(name="其他组织", slug="other", owner=user)
    WorkspaceMember.objects.create(workspace=organization, member=user, role=20)
    client = lab["client"](lab["member"])
    assert (
        client.post(
            lab["base"] + "items/",
            {"title": "无效授权", "visibility": "selected", "shared_user_ids": [str(user.id)]},
            format="json",
        ).status_code
        == 400
    )
    assert (
        client.post(lab["base"] + "items/", {"title": "旧公开事项", "public": True}, format="json").status_code == 201
    )
    assert len(shared(lab, lab["lead"])) == 1
    assert shared(lab, lab["reviewer"]) == []


def test_published_bounty_is_organization_visible_and_cannot_be_made_private(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = User.objects.create(username="org-only", email="org-only@example.org")
    WorkspaceMember.objects.create(workspace=lab["workspace"], member=user, role=15)
    client = lab["client"](user)
    BountyPublication.objects.filter(bounty_id=bounty).update(enabled=False)
    records = client.get(lab["base"] + "bounties/").json()
    assert len(records) == 1 and records[0]["visibility"] == "organization"
    assert records[0]["access_level"] == "public" and records[0]["evidence"] == "" and records[0]["allocations"] == []
    assert action(lab, lab["lead"], bounty, "public-summary", {"enabled": False, "reason": "隐藏"}).status_code == 400
    assert client.get(lab["base"] + f"bounties/{bounty}/materials/").status_code == 403
    BountyPublication.objects.filter(bounty_id=bounty).delete()
    assert client.get(lab["base"] + f"bounties/{bounty}/detail/").status_code == 200
    linked = (
        lab["client"](lab["member"])
        .post(lab["base"] + "items/", {"issue_id": str(issue.id)}, format="json")
        .json()["id"]
    )
    assert (
        lab["client"](lab["member"])
        .patch(lab["base"] + f"items/{linked}/", {"visibility": "private"}, format="json")
        .status_code
        == 400
    )
