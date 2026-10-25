# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Three distinct review decisions survive concurrent API confirmations."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections, connection

from plane.lab.models import AgentProposal

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def proposal(lab):
    response = lab["client"](lab["member"]).post(
        lab["base"] + "agent/proposals/",
        {"project_id": str(lab["project"].id), "title": "质量流程改进", "category": "quality"},
        format="json",
    )
    assert response.status_code == 201, response.content
    return AgentProposal.objects.get(id=response.json()["id"])


def approve(lab, row, user, role):
    return lab["client"](user).post(lab["base"] + f"agent/proposals/{row.id}/approve/", {"role": role}, format="json")


def concurrent_approvals(lab, row, requests):
    barrier = Barrier(len(requests))

    def submit(item):
        user, role = item
        close_old_connections()
        try:
            connection.ensure_connection()
            client = lab["client"](user)
            barrier.wait(timeout=10)
            response = client.post(lab["base"] + f"agent/proposals/{row.id}/approve/", {"role": role}, format="json")
            return response.status_code, response.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        return list(pool.map(submit, requests))


def test_distinct_concurrent_reviews_preserve_both_decisions_and_complete_proposal(laboratory):
    lab = laboratory
    row = proposal(lab)
    assert approve(lab, row, lab["lead"], "lead").status_code == 200
    results = concurrent_approvals(lab, row, [(lab["member"], "member"), (lab["reviewer"], "technical")])
    assert [status for status, _ in results] == [200, 200], results
    row.refresh_from_db()
    assert row.member_approved_by_id == lab["member"].id
    assert row.technical_approved_by_id == lab["reviewer"].id
    assert row.lead_approved_by_id == lab["lead"].id
    assert row.status == "approved"


def test_one_person_cannot_confirm_two_roles_concurrently(laboratory):
    lab = laboratory
    row = proposal(lab)
    results = concurrent_approvals(lab, row, [(lab["member"], "member"), (lab["member"], "technical")])
    assert sorted(status for status, _ in results) == [200, 400], results
    row.refresh_from_db()
    assert sum(value == lab["member"].id for value in [row.member_approved_by_id, row.technical_approved_by_id]) == 1


def test_confirmed_role_cannot_be_replaced_by_another_reviewer(laboratory):
    lab = laboratory
    row = proposal(lab)
    assert approve(lab, row, lab["member"], "member").status_code == 200
    assert approve(lab, row, lab["reviewer"], "member").status_code == 400
    row.refresh_from_db()
    assert row.member_approved_by_id == lab["member"].id


def test_only_eligible_remaining_reviewer_gets_a_proposal_action(laboratory):
    from .test_next_actions import actions

    lab = laboratory
    row = proposal(lab)
    assert approve(lab, row, lab["member"], "member").status_code == 200
    assert approve(lab, row, lab["reviewer"], "technical").status_code == 200
    assert all(item["id"] != str(row.id) for item in actions(lab, lab["independent"])["items"])
    assert any(item["id"] == str(row.id) for item in actions(lab, lab["lead"])["items"])
