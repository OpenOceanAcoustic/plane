# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from django.db import IntegrityError, close_old_connections, transaction
from plane.db.models import Issue, IssueAssignee
from plane.lab.models import Allocation, Ledger

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def prepare(lab, budget="20", stage_budget="1000", title="Team task"):
    lead = lab["client"](lab["lead"])
    base = lab["base"]
    assert (
        lead.put(
            base + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    stage = lead.post(
        base + "stages/", {"project_id": str(lab["project"].id), "name": "Q4", "budget": stage_budget}, format="json"
    )
    assert stage.status_code == 201, stage.content
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name=title, state=lab["states"]["todo"]
    )
    body = {
        "stage_id": stage.json()["id"],
        "issue_id": str(issue.id),
        "budget": budget,
        "deliverable": "Data and report",
        "criteria": "Reproducible evidence",
        "reviewer_id": str(lab["reviewer"].id),
        "independent_reviewer_id": str(lab["independent"].id),
    }
    published = lead.post(base + "bounties/", body, format="json")
    assert published.status_code == 201, published.content
    return published.json()["id"], issue, body


def action(lab, user, bounty, verb, body=None):
    return lab["client"](user).post(lab["base"] + f"bounties/{bounty}/{verb}/", body or {}, format="json")


def start(lab, bounty, planned="20"):
    claim = action(lab, lab["member"], bounty, "claim", {"planned": planned, "deliverable": "Analysis"})
    assert claim.status_code == 200, claim.content
    allocation = claim.json()["id"]
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code == 200
    assert action(lab, lab["lead"], bounty, "start").status_code == 400
    assert action(lab, lab["member"], bounty, "confirm").status_code == 200
    response = action(lab, lab["lead"], bounty, "start")
    assert response.status_code == 200, response.content
    return allocation


def test_partial_acceptance_is_delta_only_and_reversal_keeps_snapshots(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    allocation = start(lab, bounty)
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "Dataset v1"}).status_code == 200
    partial = {
        "request_key": str(uuid.uuid4()),
        "result": "partial",
        "reason": "Half complete",
        "targets": {allocation: "10"},
    }
    assert action(lab, lab["member"], bounty, "accept", partial).status_code == 403
    assert action(lab, lab["reviewer"], bounty, "accept", partial).status_code == 200
    assert action(lab, lab["reviewer"], bounty, "accept", partial).status_code == 200
    assert Ledger.objects.count() == 1 and sum(row.delta for row in Ledger.objects.all()) == 10
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "Dataset v2"}).status_code == 200
    final = {
        "request_key": str(uuid.uuid4()),
        "result": "negative",
        "reason": "Valid exploration met the agreed criterion",
        "targets": {allocation: "20"},
    }
    assert action(lab, lab["reviewer"], bounty, "accept", final).status_code == 200
    assert action(lab, lab["reviewer"], bounty, "accept", final).status_code == 200
    assert list(Ledger.objects.order_by("created_at").values_list("delta", flat=True)) == [Decimal("10"), Decimal("10")]
    entry = Ledger.objects.order_by("created_at").first()
    payload = {"request_key": str(uuid.uuid4()), "reason": "Correction after independent audit"}
    lead = lab["client"](lab["lead"])
    assert lead.post(lab["base"] + f"ledger/{entry.id}/reverse/", payload, format="json").status_code == 200
    assert lead.post(lab["base"] + f"ledger/{entry.id}/reverse/", payload, format="json").status_code == 200
    assert Ledger.objects.count() == 3 and sum(row.delta for row in Ledger.objects.all()) == 10
    with pytest.raises(IntegrityError), transaction.atomic():
        Ledger.objects.filter(id=entry.id).update(delta=999)
    issue.delete(soft=False)
    entry.refresh_from_db()
    assert (
        entry.task_snapshot["title"] == "Team task" and entry.participant_snapshot["name"] == lab["member"].display_name
    )
    exported = lead.get(lab["base"] + "ledger/?format=csv")
    assert exported.status_code == 200 and "Team task" in exported.content.decode()


def test_major_publication_and_acceptance_require_second_independent_review(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab, budget="40")
    assert action(lab, lab["member"], bounty, "claim", {"planned": "40", "deliverable": "Report"}).status_code == 400
    assert action(lab, lab["lead"], bounty, "publication-review", {"reason": "Approve"}).status_code == 403
    assert (
        action(
            lab, lab["independent"], bounty, "publication-review", {"reason": "Independent publication check"}
        ).status_code
        == 200
    )
    allocation = start(lab, bounty, planned="40")
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "Deliverable"}).status_code == 200
    acceptance = action(
        lab,
        lab["reviewer"],
        bounty,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "Meets criteria", "targets": {allocation: "40"}},
    )
    assert acceptance.status_code == 200
    assert Ledger.objects.count() == 0
    assert (
        action(
            lab,
            lab["independent"],
            bounty,
            "acceptance-review",
            {"acceptance_id": acceptance.json()["id"], "reason": "Independent acceptance check"},
        ).status_code
        == 200
    )
    assert sum(row.delta for row in Ledger.objects.all()) == 40


def test_native_state_bulk_assignment_and_concurrency_cannot_bypass_wip(laboratory):
    lab = laboratory
    lead = lab["client"](lab["lead"])
    assert (
        lead.put(
            lab["base"] + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    issues = []
    for number in range(3):
        issue = Issue.objects.create(
            workspace=lab["workspace"], project=lab["project"], name=f"Ordinary {number}", state=lab["states"]["todo"]
        )
        IssueAssignee.objects.create(
            workspace=lab["workspace"], project=lab["project"], issue=issue, assignee=lab["member"]
        )
        issues.append(issue)
    issues[0].state = lab["states"]["active"]
    issues[0].save()

    def begin(index):
        close_old_connections()
        try:
            with transaction.atomic():
                Issue.objects.filter(id=issues[index].id).update(state=lab["states"]["active"])
            return True
        except IntegrityError:
            return False
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(begin, (1, 2)))
    assert sorted(outcomes) == [False, True]
    assert Issue.objects.filter(state=lab["states"]["active"]).count() == 2
    third = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="Imported started task", state=lab["states"]["active"]
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        IssueAssignee.objects.bulk_create(
            [IssueAssignee(workspace=lab["workspace"], project=lab["project"], issue=third, assignee=lab["member"])]
        )


def test_parallel_publications_cannot_exceed_frozen_stage_budget(laboratory):
    lab = laboratory
    bounty, issue, body = prepare(lab, budget="20", stage_budget="30")

    def publish(index):
        close_old_connections()
        try:
            task = Issue.objects.create(
                workspace=lab["workspace"], project=lab["project"], name=f"Extra {index}", state=lab["states"]["todo"]
            )
            return (
                lab["client"](lab["lead"])
                .post(lab["base"] + "bounties/", {**body, "issue_id": str(task.id), "budget": "10"}, format="json")
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(publish, (1, 2)))
    assert sorted(outcomes) == [201, 400]


def test_self_acceptance_is_rejected_even_if_participant_added_through_other_channel(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    start(lab, bounty, planned="19")
    Allocation.objects.create(
        bounty_id=bounty,
        user=lab["reviewer"],
        user_id_snapshot=lab["reviewer"].id,
        user_name="Reviewer",
        deliverable="Extra",
        planned=1,
        approved=True,
        confirmed=True,
    )
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "Report"}).status_code == 200
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {"request_key": str(uuid.uuid4()), "result": "rework", "reason": "Self review"},
        ).status_code
        == 403
    )


def test_parallel_claim_approvals_cannot_exceed_team_budget(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab, budget="20")
    claims = []
    for user in (lab["member"], lab["lead"]):
        response = action(lab, user, bounty, "claim", {"planned": "15", "deliverable": "Independent portion"})
        assert response.status_code == 200
        claims.append(response.json()["id"])

    def approve(allocation):
        close_old_connections()
        try:
            return action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(approve, claims)) == [200, 400]
    assert sum(row.planned for row in Allocation.objects.filter(bounty_id=bounty, approved=True)) == 15


def test_stale_or_foreign_action_references_return_controlled_errors(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": str(uuid.uuid4())}).status_code == 404
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": "invalid"}).status_code == 400
    assert action(lab, lab["member"], bounty, "confirm").status_code == 404


def test_one_major_task_per_person_and_revoked_participant_cannot_start(laboratory):
    from plane.db.models import ProjectMember

    lab = laboratory
    first, _, _ = prepare(lab, budget="40")
    assert action(lab, lab["independent"], first, "publication-review", {"reason": "Checked"}).status_code == 200
    start(lab, first, planned="40")
    second, _, _ = prepare(lab, budget="40", title="Second major task")
    assert action(lab, lab["independent"], second, "publication-review", {"reason": "Checked"}).status_code == 200
    claim = action(lab, lab["member"], second, "claim", {"planned": "40", "deliverable": "Report"})
    assert claim.status_code == 200
    assert action(lab, lab["lead"], second, "approve", {"allocation_id": claim.json()["id"]}).status_code == 200
    assert action(lab, lab["member"], second, "confirm").status_code == 200
    assert action(lab, lab["lead"], second, "start").status_code == 409
    assert Issue.objects.filter(state=lab["states"]["active"]).count() == 1
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert action(lab, lab["lead"], second, "start").status_code == 404


def assigned_task(lab, title, state="active", user=None):
    with transaction.atomic():
        issue = Issue.objects.create(
            workspace=lab["workspace"], project=lab["project"], name=title, state=lab["states"][state]
        )
        IssueAssignee.objects.create(
            workspace=lab["workspace"], project=lab["project"], issue=issue, assignee=user or lab["member"]
        )
    return issue


def test_expired_wip_exception_allows_finishing_and_unrelated_edits_but_no_new_work(laboratory):
    from datetime import timedelta
    from django.utils import timezone
    from plane.lab.models import WIPException, WorkspacePolicy

    lab = laboratory
    WorkspacePolicy.objects.create(workspace=lab["workspace"])
    exception = WIPException.objects.create(
        workspace=lab["workspace"],
        user=lab["member"],
        approver=lab["lead"],
        reason="Approved parallel work",
        active_limit=4,
        major_limit=1,
        expires_at=timezone.now() + timedelta(days=1),
    )
    tasks = [assigned_task(lab, f"Approved {index}") for index in range(4)]
    WIPException.objects.filter(id=exception.id).update(expires_at=timezone.now() - timedelta(seconds=1))
    # Other members can continue working, and the over-limit member can close one at a time.
    unrelated = assigned_task(lab, "Other member", user=lab["reviewer"])
    Issue.objects.filter(id=unrelated.id).update(name="Still editable")
    Issue.objects.filter(id=tasks[0].id).update(state=lab["states"]["done"])
    with pytest.raises(IntegrityError), transaction.atomic():
        assigned_task(lab, "Cannot expand overage")
    Issue.objects.filter(id=tasks[1].id).update(state=lab["states"]["done"])
    with pytest.raises(IntegrityError), transaction.atomic():
        assigned_task(lab, "Third remains prohibited")
    Issue.objects.filter(id=tasks[2].id).update(state=lab["states"]["done"])
    assigned_task(lab, "Within ordinary quota again")


def test_rejection_closes_work_releases_unused_budget_and_preserves_partial_contribution(laboratory):
    from plane.lab.models import Bounty

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    allocation = start(lab, bounty)
    action(lab, lab["member"], bounty, "submit", {"evidence": "Partial evidence"})
    partial = {
        "request_key": str(uuid.uuid4()),
        "result": "partial",
        "reason": "First portion verified",
        "targets": {allocation: "10"},
    }
    assert action(lab, lab["reviewer"], bounty, "accept", partial).status_code == 200
    action(lab, lab["member"], bounty, "submit", {"evidence": "Remaining evidence"})
    rejected = {
        "request_key": str(uuid.uuid4()),
        "result": "reject",
        "reason": "Remaining portion does not meet criteria",
    }
    assert action(lab, lab["reviewer"], bounty, "accept", rejected).status_code == 200
    assert action(lab, lab["reviewer"], bounty, "accept", rejected).status_code == 200
    closed = Bounty.objects.get(id=bounty)
    assert closed.status == "rejected" and closed.reserved == 10
    assert Allocation.objects.get(id=allocation).closed
    assert total_awarded(bounty) == 10
    issue.refresh_from_db()
    assert issue.state_id == lab["states"]["todo"].id
    assigned_task(lab, "Next 1")
    assigned_task(lab, "Next 2")
    with pytest.raises(IntegrityError), transaction.atomic():
        assigned_task(lab, "Next 3")


def total_awarded(bounty):
    return sum(row.delta for row in Ledger.objects.filter(bounty_id=bounty))


def test_completed_bounty_reopening_cannot_bypass_native_wip(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    allocation = start(lab, bounty)
    action(lab, lab["member"], bounty, "submit", {"evidence": "Finished"})
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "Verified", "targets": {allocation: "20"}},
        ).status_code
        == 200
    )
    assigned_task(lab, "Current 1")
    assigned_task(lab, "Current 2")
    with pytest.raises(IntegrityError), transaction.atomic():
        Issue.objects.filter(id=issue.id).update(state=lab["states"]["active"])


def test_native_edit_and_bounty_submission_do_not_deadlock(laboratory):
    from threading import Barrier

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    start(lab, bounty)
    barrier = Barrier(2)

    def edit_native():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            with transaction.atomic():
                return Issue.objects.filter(id=issue.id).update(name="Native edited title")
        finally:
            close_old_connections()

    def submit_bounty():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return action(lab, lab["member"], bounty, "submit", {"evidence": "Report"}).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        editing = pool.submit(edit_native)
        submitting = pool.submit(submit_bounty)
        assert editing.result(timeout=20) == 1
        assert submitting.result(timeout=20) == 200


def test_full_wip_never_blocks_accounting_correction_and_reacceptance_adds_only_delta(laboratory):
    from plane.lab.models import Bounty

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    allocation = start(lab, bounty)
    action(lab, lab["member"], bounty, "submit", {"evidence": "Report"})
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "Verified", "targets": {allocation: "20"}},
        ).status_code
        == 200
    )
    ongoing = assigned_task(lab, "Current 1")
    assigned_task(lab, "Current 2")
    entry = Ledger.objects.get(bounty_id=bounty)
    correction = {"request_key": str(uuid.uuid4()), "reason": "Accounting correction"}
    assert (
        lab["client"](lab["lead"])
        .post(lab["base"] + f"ledger/{entry.id}/reverse/", correction, format="json")
        .status_code
        == 200
    )
    assert total_awarded(bounty) == 0
    assert Bounty.objects.get(id=bounty).status == "done" and Allocation.objects.get(id=allocation).closed
    assert action(lab, lab["lead"], bounty, "reopen", {"reason": "Recheck corrected award"}).status_code == 409
    Issue.objects.filter(id=ongoing.id).update(state=lab["states"]["done"])
    assert action(lab, lab["lead"], bounty, "reopen", {"reason": "Recheck corrected award"}).status_code == 200
    verified = {
        "request_key": str(uuid.uuid4()),
        "result": "pass",
        "reason": "Reverified",
        "targets": {allocation: "20"},
    }
    assert action(lab, lab["reviewer"], bounty, "accept", verified).status_code == 200
    assert action(lab, lab["reviewer"], bounty, "accept", verified).status_code == 200
    assert total_awarded(bounty) == 20 and Ledger.objects.filter(bounty_id=bounty).count() == 3


@pytest.mark.parametrize("hidden_field", ["archived_at", "deleted_at"])
def test_hidden_task_accounting_can_be_corrected_without_reopening_work(laboratory, hidden_field):
    from django.utils import timezone
    from plane.lab.models import Bounty

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    allocation = start(lab, bounty)
    action(lab, lab["member"], bounty, "submit", {"evidence": "Report"})
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "Verified", "targets": {allocation: "20"}},
        ).status_code
        == 200
    )
    Issue.objects.filter(id=issue.id).update(**{hidden_field: timezone.now()})
    entry = Ledger.objects.get(bounty_id=bounty)
    assert (
        lab["client"](lab["lead"])
        .post(
            lab["base"] + f"ledger/{entry.id}/reverse/",
            {"request_key": str(uuid.uuid4()), "reason": "Historical correction"},
            format="json",
        )
        .status_code
        == 200
    )
    assert action(lab, lab["lead"], bounty, "reopen", {"reason": "Hidden task"}).status_code == 404
    assert total_awarded(bounty) == 0 and Bounty.objects.get(id=bounty).status == "done"
    assert Allocation.objects.get(id=allocation).closed


def test_native_state_paths_cannot_skip_team_start_confirmation(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    with pytest.raises(IntegrityError), transaction.atomic():
        Issue.objects.filter(id=issue.id).update(state=lab["states"]["active"])
    with pytest.raises(IntegrityError), transaction.atomic():
        type(lab["states"]["todo"]).objects.filter(id=lab["states"]["todo"].id).update(group="started")
    issue.refresh_from_db()
    assert issue.state_id == lab["states"]["todo"].id
    start(lab, bounty)
