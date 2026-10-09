# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta
from io import BytesIO
from unittest.mock import patch

import pytest
from django.utils import timezone

from plane.db.models import FileAsset, Issue, Page, PageVersion, ProjectMember, ProjectPage, User, WorkspaceMember
from plane.lab.bounty_models import BountyPublication, BountyTaskAccess
from plane.lab.models import Allocation, Folder, PersonalCategory, PersonalItem
from .test_bounties import action, prepare

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def cross_member(lab):
    user = User.objects.create(username="cross-project", email="cross@example.org", display_name="跨项目成员")
    WorkspaceMember.objects.create(workspace=lab["workspace"], member=user, role=15)
    return user


def approve_cross(lab, bounty, user):
    claim = action(lab, user, bounty, "claim", {"planned": "20", "deliverable": "个人实验记录"})
    assert claim.status_code == 200, claim.content
    allocation_id = claim.json()["id"]
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation_id}).status_code == 200
    return allocation_id


def test_hall_public_projection_hides_team_evidence_and_old_unpublished_material(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = cross_member(lab)
    from plane.lab.models import Bounty

    Bounty.objects.filter(id=bounty).update(evidence="私有实验成果")
    Allocation.objects.create(
        bounty_id=bounty,
        user=lab["member"],
        user_id_snapshot=lab["member"].id,
        user_name="另一个组员",
        deliverable="私有分工",
        planned=5,
    )
    client = lab["client"](user)
    records = client.get(lab["base"] + "bounties/").json()
    assert len(records) == 1
    record = records[0]
    assert record["access_level"] == "public" and record["can_claim"]
    assert record["evidence"] == "" and record["allocations"] == [] and record["acceptances"] == []
    assert record["reserved"] is None and record["awarded"] is None
    assert record["issue_key"] == f"OA-{issue.sequence_id}"
    assert client.get(lab["base"] + f"bounties/{bounty}/materials/").status_code == 403
    BountyPublication.objects.filter(bounty_id=bounty).delete()
    assert client.get(lab["base"] + "bounties/").json() == []
    assert client.get(lab["base"] + f"bounties/{bounty}/detail/").status_code == 404
    assert lab["client"](lab["lead"]).get(lab["base"] + "bounties/").status_code == 200


def test_cross_project_confirmation_reuses_planning_and_grants_only_task_access(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = cross_member(lab)
    allocation = approve_cross(lab, bounty, user)
    grant = BountyTaskAccess.objects.get(allocation_id=allocation)
    assert not grant.requires_project_membership
    folder = Folder.objects.create(workspace=lab["workspace"], user=user, name="实验")
    category = PersonalCategory.objects.create(workspace=lab["workspace"], user=user, name="自定", color="#abcdef")
    item = PersonalItem.objects.create(
        workspace=lab["workspace"], user=user, issue=issue, kind="project", folder=folder, category=category
    )
    assert action(lab, user, bounty, "confirm").status_code == 200
    assert action(lab, user, bounty, "confirm").status_code == 200
    assert PersonalItem.objects.filter(user=user, issue=issue).count() == 1
    item.refresh_from_db()
    assert item.folder_id == folder.id and item.category_id == category.id
    assert not ProjectMember.objects.filter(project=lab["project"], member=user).exists()
    client = lab["client"](user)
    planning = client.get(lab["base"] + "planner/").json()
    assert planning["projects"] == [] and len(planning["items"]) == 1
    details = planning["items"][0]
    assert details["bounty_id"] == bounty and details["category_color"] == "#abcdef"
    assert not details["can_edit_issue"]
    assert client.get(lab["base"] + "tasks/").json() == []
    native = f"/api/workspaces/lab/projects/{lab['project'].id}/issues/{issue.id}/"
    assert client.get(native).status_code in (403, 404)
    assert client.patch(lab["base"] + f"items/{item.id}/", {"status": "active"}, format="json").status_code == 404
    instant = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
    block = {"item_id": str(item.id), "start": instant.isoformat(), "end": (instant + timedelta(hours=1)).isoformat()}
    assert client.post(lab["base"] + "calendar/", block, format="json").status_code == 201
    assert action(lab, lab["lead"], bounty, "start").status_code == 200
    assert action(lab, user, bounty, "submit", {"evidence": "可复验结果"}).status_code == 200
    grant.revoked_at = timezone.now()
    grant.save(update_fields=["revoked_at"])
    assert client.get(lab["base"] + "planner/").json()["items"] == []
    assert client.post(lab["base"] + "calendar/", block, format="json").status_code == 404


def test_confirm_automatically_adds_reference_and_public_workflow_hides_other_claims(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = cross_member(lab)
    claim = action(lab, lab["member"], bounty, "claim", {"planned": "1", "deliverable": "内部个人安排"})
    assert claim.status_code == 200
    outsider = lab["client"](user)
    flow = outsider.get(lab["base"] + f"bounties/{bounty}/workflow/").json()
    assert "claim" in [row["action"] for row in flow["actions"]]
    assert not any(row["actor"] == lab["member"].display_name for row in flow["history"])
    claim = action(lab, user, bounty, "claim", {"planned": "19", "deliverable": "独立安排"})
    assert claim.status_code == 200
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": claim.json()["id"]}).status_code == 200
    assert outsider.get(lab["base"] + "inbox/").json()[0]["action"] == "确认开工约定"
    assert action(lab, user, bounty, "confirm").status_code == 200
    item = PersonalItem.objects.get(user=user, issue=issue)
    assert item.kind == "project" and item.category_id


def test_shared_document_is_frozen_specific_version_and_withdrawal_blocks_next_read(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty, user)
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["lead"], name="实验记录")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    first = PageVersion.objects.create(
        workspace=lab["workspace"],
        page=page,
        owned_by=lab["lead"],
        description_html="<p>共享版本</p>",
        description_json={"type": "doc"},
    )
    PageVersion.objects.create(
        workspace=lab["workspace"], page=page, owned_by=lab["lead"], description_html="<p>其他机密版本</p>"
    )
    lead, client = lab["client"](lab["lead"]), lab["client"](user)
    endpoint = lab["base"] + f"bounties/{bounty}/materials/"
    shared = lead.post(endpoint, {"kind": "document_version", "page_version_id": str(first.id)}, format="json")
    assert shared.status_code == 201, shared.content
    detail = endpoint + shared.json()["id"] + "/"
    first.description_html = "<p>修改后的原版本</p>"
    first.save()
    response = client.get(detail)
    assert response.status_code == 200 and response.json()["description_html"] == "<p>共享版本</p>"
    native = lab["base"] + f"projects/{lab['project'].id}/documents/"
    assert client.get(native).status_code == 404
    assert client.delete(detail).status_code == 403
    assert lead.delete(detail).status_code == 204
    assert client.get(detail).status_code == 404
    assert client.get(endpoint).json()["materials"] == []


def test_shared_attachment_stream_and_native_uuid_download_do_not_expand_project_access(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty, user)
    asset = FileAsset.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        issue=issue,
        asset=f"{lab['workspace'].id}/experiment.txt",
        attributes={"name": "experiment.txt"},
        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
        is_uploaded=True,
    )
    lead, client = lab["client"](lab["lead"]), lab["client"](user)
    endpoint = lab["base"] + f"bounties/{bounty}/materials/"
    shared = lead.post(endpoint, {"kind": "attachment", "attachment_id": str(asset.id)}, format="json")
    assert shared.status_code == 201
    assert "attachment_id" not in shared.json()
    detail = endpoint + shared.json()["id"] + "/"
    with patch.object(asset.asset.storage, "open", return_value=BytesIO(b"verified experiment")):
        response = client.get(detail)
        assert response.status_code == 200 and b"".join(response.streaming_content) == b"verified experiment"
    path = f"/api/assets/v2/workspaces/lab/download/{asset.id}/"
    assert client.get(path).status_code == 403
    with patch("plane.app.views.asset.v2.S3Storage") as storage:
        storage.return_value.generate_presigned_url.return_value = "https://storage.example.org/verified"
        assert lead.get(path).status_code == 302
    assert lead.delete(detail).status_code == 204
    assert client.get(detail).status_code == 404


def test_card_metadata_uses_viewers_category_and_requires_native_project_access(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab, budget="20.12")
    user = cross_member(lab)
    approve_cross(lab, bounty, user)
    category = PersonalCategory.objects.create(
        workspace=lab["workspace"], user=lab["member"], name="实验专用", color="#123456"
    )
    PersonalItem.objects.create(
        workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project", category=category
    )
    endpoint = lab["base"] + "task-card-metadata/"
    response = lab["client"](lab["member"]).get(endpoint + f"?project_id={lab['project'].id}")
    assert response.status_code == 200
    assert response.json()["items"][0]["color"] == "#123456"
    assert response.json()["items"][0]["bounty_id"] == bounty
    assert response.json()["items"][0]["bounty_budget"] == "20.12"
    by_issue = lab["client"](lab["member"]).post(endpoint, {"issue_ids": [str(issue.id)]}, format="json")
    assert by_issue.status_code == 200
    assert by_issue.json()["items"][0]["bounty_budget"] == "20.12"
    client = lab["client"](user)
    assert client.get(endpoint + f"?project_id={lab['project'].id}").status_code == 404
    assert client.get(endpoint + f"?issue_ids={issue.id}").json() == {"items": []}
    assert client.post(endpoint, {"issue_ids": [str(issue.id)]}, format="json").json() == {"items": []}


def test_card_metadata_personal_workitem_without_bounty_has_no_quota(laboratory):
    lab = laboratory
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="Ordinary work item", state=lab["states"]["todo"]
    )
    PersonalItem.objects.create(workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project")
    result = lab["client"](lab["member"]).get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}").json()["items"]
    assert len(result) == 1 and result[0]["issue_id"] == str(issue.id)
    assert result[0]["bounty_id"] is None and result[0]["bounty_budget"] is None


def test_old_bounty_requires_explicit_summary_and_never_publishes_old_evidence(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    BountyPublication.objects.filter(bounty_id=bounty).delete()
    user = cross_member(lab)
    data = {
        "public_summary": "可公开的实验任务",
        "public_deliverable": "匿名实验数据",
        "public_criteria": "可重复分析",
        "enabled": True,
        "reason": "负责人核准公开摘要",
    }
    assert action(lab, lab["member"], bounty, "public-summary", data).status_code == 403
    assert action(lab, lab["lead"], bounty, "public-summary", data).status_code == 200
    record = lab["client"](user).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert record["public_summary"] == data["public_summary"]
    assert record["deliverable"] == data["public_deliverable"] and record["evidence"] == ""
    assert (
        action(lab, lab["lead"], bounty, "public-summary", {"enabled": False, "reason": "暂停公示"}).status_code == 200
    )
    assert lab["client"](user).get(lab["base"] + "bounties/").json() == []


def test_busy_calendar_events_have_no_bounty_star_metadata(laboratory):
    from plane.lab.models import TimeBlock

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty, user)
    assert action(lab, user, bounty, "confirm").status_code == 200
    item = PersonalItem.objects.get(user=user, issue=issue)
    begin = timezone.now().replace(minute=0, second=0, microsecond=0)
    TimeBlock.objects.create(item=item, start=begin, end=begin + timedelta(hours=1), color="#abcdef")
    admin = User.objects.create(username="other-admin", email="admin2@example.org", display_name="其他管理员")
    WorkspaceMember.objects.create(workspace=lab["workspace"], member=admin, role=20)
    from urllib.parse import urlencode

    query = urlencode({"team": "1", "start": begin.isoformat(), "end": (begin + timedelta(days=1)).isoformat()})
    hidden = lab["client"](admin).get(lab["base"] + "calendar/?" + query).json()["events"][0]
    assert hidden["title"] == "忙碌" and not hidden["editable"]
    assert not set(hidden).intersection(
        {"bounty_id", "bounty_status", "bounty_detail_url", "color", "category_color", "issue_id"}
    )
    own = lab["client"](user).get(lab["base"] + "calendar/?" + query.replace("team=1", "team=0")).json()["events"][0]
    assert own["bounty_id"] == bounty and own["color"] == "#abcdef"
