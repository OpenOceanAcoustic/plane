# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from decimal import Decimal

import pytest

from plane.db.models import Issue, ProjectMember, WorkspaceMember
from plane.lab.models import Acceptance, Audit, Bounty, Ledger
from .test_bounties import action, prepare, start

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def publish_major(lab, reviewer, independent):
    _, _, body = prepare(lab)
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="Shared review roles", state=lab["states"]["todo"]
    )
    return lab["client"](lab["lead"]).post(
        lab["base"] + "bounties/",
        {
            **body,
            "issue_id": str(issue.id),
            "budget": "40",
            "reviewer_id": str(reviewer.id),
            "independent_reviewer_id": str(independent.id),
        },
        format="json",
    )


def test_same_lead_can_publish_accept_and_review_without_skipping_major_steps(laboratory):
    lab = laboratory
    response = publish_major(lab, lab["lead"], lab["lead"])
    assert response.status_code == 201, response.content
    bounty_id = response.json()["id"]
    bounty = Bounty.objects.get(id=bounty_id)
    assert bounty.major and bounty.status == "publication_review"
    assert not Ledger.objects.filter(bounty=bounty).exists()
    assert action(lab, lab["member"], bounty_id, "claim", {"planned": "40", "deliverable": "Report"}).status_code == 400
    assert action(lab, lab["reviewer"], bounty_id, "publication-review", {"reason": "Wrong role"}).status_code == 403
    reviewed = action(lab, lab["lead"], bounty_id, "publication-review", {"reason": "Publication checked"})
    assert reviewed.status_code == 200, reviewed.content
    bounty.refresh_from_db()
    assert bounty.status == "open"
    allocation = start(lab, bounty_id, planned="40")
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "Dataset"}).status_code == 200
    acceptance_response = action(
        lab,
        lab["lead"],
        bounty_id,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "Meets criteria", "targets": {allocation: "40"}},
    )
    assert acceptance_response.status_code == 200, acceptance_response.content
    acceptance = Acceptance.objects.get(id=acceptance_response.json()["id"])
    bounty.refresh_from_db()
    assert bounty.status == "acceptance_review" and acceptance.approved_at is None
    assert not Ledger.objects.filter(bounty=bounty).exists()
    final_review = action(
        lab, lab["lead"], bounty_id, "acceptance-review", {"acceptance_id": str(acceptance.id), "reason": "Final check"}
    )
    assert final_review.status_code == 200, final_review.content
    bounty.refresh_from_db()
    acceptance.refresh_from_db()
    assert bounty.status == "done" and acceptance.approved_at
    assert acceptance.reviewer_id == acceptance.independent_reviewer_id == lab["lead"].id
    assert sum(Ledger.objects.filter(bounty=bounty).values_list("delta", flat=True)) == Decimal("40")
    assert (
        Audit.objects.filter(action="bounty.publication_review", actor=lab["lead"], object_id=str(bounty.id)).count()
        == 1
    )
    assert (
        Audit.objects.filter(action="bounty.acceptance_review", actor=lab["lead"], object_id=str(acceptance.id)).count()
        == 1
    )


def test_same_nonpublisher_can_accept_and_review(laboratory):
    lab = laboratory
    response = publish_major(lab, lab["reviewer"], lab["reviewer"])
    assert response.status_code == 201, response.content
    bounty = Bounty.objects.get(id=response.json()["id"])
    assert bounty.reviewer_id == bounty.independent_reviewer_id == lab["reviewer"].id
    assert action(lab, lab["reviewer"], bounty.id, "publication-review", {"reason": "Checked"}).status_code == 200
    assert (
        action(lab, lab["reviewer"], bounty.id, "claim", {"planned": "1", "deliverable": "Own task"}).status_code == 400
    )


@pytest.mark.parametrize("invalid", ["project_inactive", "workspace_inactive", "role", "user_inactive"])
def test_shared_review_roles_still_require_eligible_current_members(laboratory, invalid):
    lab = laboratory
    _, _, body = prepare(lab)
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="Invalid reviewer", state=lab["states"]["todo"]
    )
    if invalid == "project_inactive":
        ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    elif invalid == "workspace_inactive":
        WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["reviewer"]).update(is_active=False)
    elif invalid == "role":
        ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(role=5)
    else:
        lab["reviewer"].is_active = False
        lab["reviewer"].save(update_fields=["is_active"])
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "bounties/",
        {**body, "issue_id": str(issue.id), "budget": "40", "independent_reviewer_id": str(lab["reviewer"].id)},
        format="json",
    )
    assert response.status_code == 400
    assert "有效成员" in str(response.data)
