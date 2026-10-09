# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Retries of a successful VC budget must never create a new funding source."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections

from plane.db.models import Project, ProjectMember, Workspace, WorkspaceMember
from plane.lab import bounty_budgets
from plane.lab.models import Audit, Bounty, Stage
from .test_bounty_project_budget import budgets, publication, task

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def body(lab, **extra):
    return {
        "request_key": str(uuid.uuid4()),
        "project_id": str(lab["project"].id),
        "name": "研究 VC 预算",
        "budget": "100",
        "reason": "阶段研究预算",
        **extra,
    }


def create(lab, data, user=None, base=None):
    return lab["client"](user or lab["lead"]).post((base or lab["base"]) + "stages/", data, format="json")


def test_successful_budget_replay_preserves_bounty_reservation_and_single_source(laboratory):
    lab = laboratory
    data = body(lab)
    first = create(lab, data)
    assert first.status_code == 201, first.content
    client = lab["client"](lab["lead"])
    assert (
        client.put(
            lab["base"] + f"flows/{lab['project'].id}/",
            {key: str(state.id) for key, state in lab["states"].items()},
            format="json",
        ).status_code
        == 200
    )
    response = client.post(lab["base"] + "bounties/", publication(lab, task(lab), budget="20"), format="json")
    assert response.status_code == 201, response.content
    replay = create(lab, data)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert Stage.objects.count() == 1 and Bounty.objects.count() == 1
    assert Audit.objects.filter(action="stage.frozen").count() == 1
    assert budgets(lab)[0]["available"] == "80.00"
    record = Audit.objects.get(action="stage.frozen")
    assert record.details["request_key"] == data["request_key"]
    assert record.details["request_snapshot"] == {
        "project_id": str(lab["project"].id),
        "name": data["name"],
        "budget": "100.00",
        "reason": data["reason"],
    }


def test_replay_normalizes_valid_input_and_does_not_promote_older_source(laboratory):
    lab = laboratory
    data = body(lab)
    first = create(lab, data)
    assert first.status_code == 201, first.content
    newer = create(lab, body(lab, name="新预算", budget="60"))
    assert newer.status_code == 201, newer.content
    replay = create(lab, {**data, "budget": 100, "name": f" {data['name']} ", "reason": f" {data['reason']} "})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert Stage.objects.count() == 2 and budgets(lab)[0]["stage_id"] == newer.json()["id"]


@pytest.mark.parametrize("field", ["project_id", "name", "budget", "reason"])
def test_reusing_key_for_different_valid_budget_data_is_rejected(field, laboratory):
    lab = laboratory
    data = body(lab)
    response = create(lab, data)
    assert response.status_code == 201, response.content
    changes = {"name": "另一预算", "budget": "120", "reason": "另一用途"}
    if field == "project_id":
        project = Project.objects.create(
            workspace=lab["workspace"], name="Other", identifier="OT", project_lead=lab["lead"]
        )
        ProjectMember.objects.create(workspace=lab["workspace"], project=project, member=lab["lead"], role=20)
        value = str(project.id)
    else:
        value = changes[field]
    response = create(lab, {**data, field: value})
    assert response.status_code == 400 and Stage.objects.count() == 1
    assert Audit.objects.filter(action="stage.frozen").count() == 1


def test_replay_checks_current_permission_and_rejects_other_actor(laboratory):
    lab = laboratory
    data = body(lab)
    response = create(lab, data)
    assert response.status_code == 201, response.content
    assert create(lab, data, user=lab["member"]).status_code == 403
    lab["project"].project_lead = lab["member"]
    lab["project"].save(update_fields=["project_lead"])
    response = create(lab, data, user=lab["member"])
    assert response.status_code == 400 and Stage.objects.count() == 1


def test_waiting_budget_operation_rechecks_lead_after_finance_lock(laboratory, monkeypatch):
    lab = laboratory
    original_lock = bounty_budgets.lock

    def change_lead_after_lock(name):
        original_lock(name)
        Project.objects.filter(id=lab["project"].id).update(project_lead=lab["member"])

    monkeypatch.setattr(bounty_budgets, "lock", change_lead_after_lock)
    response = create(lab, body(lab))
    assert response.status_code == 403 and not Stage.objects.exists()
    assert not Audit.objects.filter(action="stage.frozen").exists()


def test_concurrent_budget_retries_create_one_source(laboratory):
    lab = laboratory
    data = body(lab)
    barrier = Barrier(2)

    def submit(_):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = create(lab, data)
            return response.status_code, response.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert [result[0] for result in results] == [201, 201]
    assert results[0][1] == results[1][1] and Stage.objects.count() == 1
    assert Audit.objects.filter(action="stage.frozen").count() == 1


def test_legacy_budget_without_key_remains_compatible(laboratory):
    lab = laboratory
    data = body(lab)
    data.pop("request_key")
    first, second = create(lab, data), create(lab, data)
    assert first.status_code == second.status_code == 201 and first.json() != second.json()
    assert Stage.objects.count() == 2
    assert all("request_key" not in row.details for row in Audit.objects.filter(action="stage.frozen"))


@pytest.mark.parametrize("key", ["invalid", ""])
def test_invalid_optional_request_key_does_not_create_budget(key, laboratory):
    lab = laboratory
    response = create(lab, body(lab, request_key=key))
    assert response.status_code == 400 and not Stage.objects.exists()


def test_budget_request_key_is_scoped_to_authorized_workspace(laboratory):
    lab = laboratory
    data = body(lab)
    first = create(lab, data)
    assert first.status_code == 201, first.content
    workspace = Workspace.objects.create(name="Other lab", slug="other-lab", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=workspace, member=lab["lead"], role=20)
    project = Project.objects.create(workspace=workspace, name="Other", identifier="OT", project_lead=lab["lead"])
    ProjectMember.objects.create(workspace=workspace, project=project, member=lab["lead"], role=20)
    response = create(lab, {**data, "project_id": str(project.id)}, base="/api/workspaces/other-lab/lab/")
    assert response.status_code == 201 and response.json()["id"] != first.json()["id"]
    assert Stage.objects.get(id=response.json()["id"]).workspace_id == workspace.id
    denied = create(lab, data, user=lab["member"], base="/api/workspaces/other-lab/lab/")
    assert denied.status_code == 403 and Stage.objects.count() == 2
