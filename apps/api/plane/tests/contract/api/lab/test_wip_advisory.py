# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta
from importlib import import_module

import pytest
from django.db import connection, IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import Issue, Project, ProjectMember, State, Workspace, WorkspaceMember
from plane.lab.bounties import publish
from plane.lab.models import Allocation, Audit, Bounty, Ledger, WIPException, WorkspacePolicy
from plane.lab.workload import workload
from .test_bounties import action, assigned_task, prepare, start

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def review_publication(lab, bounty):
    if Bounty.objects.get(id=bounty).major:
        response = action(
            lab, lab["independent"], bounty, "publication-review", {"reason": "Major publication reviewed"}
        )
        assert response.status_code == 200, response.content


def test_multiple_major_bounties_start_and_count_each_native_and_allocation_identity_once(laboratory):
    lab = laboratory
    for index, price in enumerate(("40", "40", "20")):
        bounty, _, _ = prepare(lab, budget=price, title=f"Parallel team {index}")
        review_publication(lab, bounty)
        start(lab, bounty, planned=price)
    response = lab["client"](lab["member"]).get(lab["base"] + "me/workload/")
    assert response.status_code == 200
    assert response.json() == {
        "active": 3,
        "major": 2,
        "active_limit": 2,
        "major_limit": 1,
        "overloaded": True,
        "blocking": False,
        "message": "并行提醒：当前进行中 3 项（建议 2 项），其中重大 2 项（建议 1 项）。",
    }
    assert sum(Bounty.objects.values_list("reserved", flat=True)) == 100
    assert Allocation.objects.filter(approved=True, confirmed=True).count() == 3
    assert not Ledger.objects.exists()
    assert workload(lab["lead"], lab["workspace"])["active"] == 0


def test_overloaded_member_still_needs_approval_confirmation_and_budget(laboratory):
    lab = laboratory
    bounty, _, body = prepare(lab, stage_budget="100")
    assigned_task(lab, "Existing one")
    assigned_task(lab, "Existing two")
    assert action(lab, lab["member"], bounty, "start").status_code == 403
    claim = action(lab, lab["member"], bounty, "claim", {"planned": "20", "deliverable": "交付结果"})
    allocation = claim.json()["id"]
    assert action(lab, lab["member"], bounty, "approve", {"allocation_id": allocation}).status_code == 403
    assert action(lab, lab["lead"], bounty, "start").status_code == 400
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code == 200
    assert action(lab, lab["lead"], bounty, "start").status_code == 400
    assert action(lab, lab["member"], bounty, "confirm").status_code == 200
    assert action(lab, lab["lead"], bounty, "start").status_code == 200
    assert workload(lab["member"], lab["workspace"])["active"] == 3
    row = Bounty.objects.get(id=bounty)
    extra = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name="超预算"
    )
    with pytest.raises(ValidationError):
        publish(lab["lead"], row.stage_id, {**body, "issue_id": str(extra.id), "budget": "90"})
    assert Bounty.objects.count() == 1
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "已交付"}).status_code == 200
    assert action(lab, lab["member"], bounty, "accept", {"reason": "不能自验收", "result": "pass"}).status_code == 403
    assert not Ledger.objects.exists()


def test_advice_excludes_other_people_workspaces_and_does_not_disclose_task_names(laboratory):
    lab = laboratory
    WorkspacePolicy.objects.create(workspace=lab["workspace"])
    for index in range(3):
        assigned_task(lab, f"Member confidential {index}")
    for index in range(5):
        assigned_task(lab, f"Lead confidential {index}", user=lab["lead"])
    other = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=other, member=lab["lead"], role=20)
    project = Project.objects.create(workspace=other, name="Other", identifier="OTHER")
    ProjectMember.objects.create(workspace=other, project=project, member=lab["member"], role=15)
    active = State.objects.create(workspace=other, project=project, name="Active", group="started")
    another = {**lab, "workspace": other, "project": project, "states": {"active": active}}
    assigned_task(another, "Other workspace task")
    member = lab["client"](lab["member"])
    before = Audit.objects.count()
    response = member.get(lab["base"] + "me/workload/", {"user_id": str(lab["lead"].id)})
    assert response.status_code == 200 and response.json()["active"] == 3
    assert "confidential" not in response.content.decode() and "tasks" not in response.json()
    assert Audit.objects.count() == before
    assert member.get("/api/workspaces/other/lab/me/workload/").status_code == 403
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert member.get(lab["base"] + "me/workload/").status_code == 403


def test_legacy_exceptions_only_adjust_advice_and_keep_existing_approval_permissions(laboratory):
    lab = laboratory
    WorkspacePolicy.objects.create(workspace=lab["workspace"])
    for index in range(3):
        assigned_task(lab, f"Parallel {index}")
    body = {
        "user_id": str(lab["member"].id),
        "reason": "临时并行安排",
        "active_limit": 4,
        "major_limit": 2,
        "expires_at": (timezone.now() + timedelta(days=1)).isoformat(),
    }
    member = lab["client"](lab["member"])
    assert member.post(lab["base"] + "wip-exceptions/", body, format="json").status_code == 403
    lead = lab["client"](lab["lead"])
    assert (
        lead.post(lab["base"] + "wip-exceptions/", {**body, "user_id": str(lab["lead"].id)}, format="json").status_code
        == 403
    )
    assert lead.post(lab["base"] + "wip-exceptions/", body, format="json").status_code == 201
    assert workload(lab["member"], lab["workspace"])["overloaded"] is False
    WIPException.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assigned_task(lab, "仍可开工")
    advice = workload(lab["member"], lab["workspace"])
    assert advice["overloaded"] and advice["active"] == 4 and advice["active_limit"] == 2


def test_sql_migration_only_changes_workload_rejection_and_is_reversible(laboratory):
    lab = laboratory
    WorkspacePolicy.objects.create(workspace=lab["workspace"])
    assigned_task(lab, "First")
    assigned_task(lab, "Second")
    migration = import_module("plane.lab.migrations.0023_wip_reminders")

    def guards():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, md5(pg_get_functiondef(oid)) FROM pg_proc "
                "WHERE pronamespace='public'::regnamespace AND proname LIKE 'lab_%%' "
                "AND proname <> 'lab_wip_validate'"
            )
            return sorted(cursor.fetchall())

    before = guards()
    try:
        with connection.cursor() as cursor:
            cursor.execute(migration.REVERSE_SQL)
        with pytest.raises(IntegrityError), transaction.atomic():
            assigned_task(lab, "Strict migration rollback")
    finally:
        with connection.cursor() as cursor:
            cursor.execute(migration.FORWARD_SQL)
    assigned_task(lab, "Advisory migration applied")
    assert workload(lab["member"], lab["workspace"])["overloaded"]
    assert guards() == before
