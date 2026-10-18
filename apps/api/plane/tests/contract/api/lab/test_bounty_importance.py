# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections

from plane.lab.models import Allocation, Audit, Bounty, Ledger
from .test_bounties import action, prepare
from .test_bounty_quotes import decide, quote_list, submit_quote
from .test_member_vc import body, grant, issue, post, setup

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def create(lab, major=False, budget="5000", **extra):
    setup(lab, "10000")
    response = post(lab, body(lab, issue(lab), budget, major=major, **extra), actor=lab["lead"])
    assert response.status_code == 201, response.content
    return response.json()["id"]


def detail(lab, bounty, user=None):
    response = lab["client"](user or lab["lead"]).get(lab["base"] + f"bounties/{bounty}/detail/")
    assert response.status_code == 200, response.content
    return response.json()


def change(lab, bounty, major, user=None, **extra):
    return action(
        lab,
        user or lab["lead"],
        bounty,
        "importance",
        {
            "major": major,
            "independent_reviewer_id": str(lab["independent"].id) if major else None,
            "expected_state": detail(lab, bounty)["importance_state"],
            "request_key": str(uuid.uuid4()),
            **extra,
        },
    )


def test_large_vc_cash_effort_and_safety_do_not_automatically_make_a_bounty_major(laboratory):
    lab = laboratory
    bounty = create(lab, cash_commitment="5000", person_days="11", route_or_safety=True)
    record = detail(lab, bounty)
    assert record["major"] is False and record["major_reasons"] == [] and record["status"] == "open"
    assert submit_quote(lab, bounty, kind="negotiated", vc="6000", basis="新增工作").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert quote["adjustment"]["additional"] == "1000.00" and not quote["adjustment"]["requires_review"]
    assert decide(lab, bounty, quote).status_code == 200
    allocation = Allocation.objects.get(bounty_id=bounty)
    assert action(lab, lab["lead"], bounty, "start").status_code == 200
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "完整交付"}).status_code == 200
    accepted = action(
        lab,
        lab["reviewer"],
        bounty,
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "pass",
            "reason": "验收通过",
            "targets": {str(allocation.id): "6000"},
        },
    )
    assert accepted.status_code == 200, accepted.content
    assert detail(lab, bounty)["status"] == "done" and Ledger.objects.get(bounty_id=bounty).delta == 6000


def test_a_small_manually_major_task_still_requires_publication_review(laboratory):
    lab = laboratory
    bounty = create(lab, major=True, budget="1")
    assert detail(lab, bounty)["major_reasons"] == ["publisher"]
    assert detail(lab, bounty)["status"] == "publication_review"
    assert action(lab, lab["independent"], bounty, "publication-review", {"reason": "核准发布"}).status_code == 200
    assert submit_quote(lab, bounty, kind="negotiated", vc="2", basis="追加交付").status_code == 201
    assert quote_list(lab, bounty)["quotes"][0]["adjustment"]["requires_review"]


def test_publisher_can_downgrade_an_old_automatic_major_before_work_starts(laboratory):
    lab = laboratory
    bounty = create(lab, major=True)
    Bounty.objects.filter(id=bounty).update(major_reasons=["40VC", "20%B"])
    assert change(lab, bounty, False).status_code == 200
    record = detail(lab, bounty)
    assert record["status"] == "open" and not record["major"] and record["major_reasons"] == []
    assert record["can_change_importance"]
    assert Audit.objects.filter(action="bounty.importance_changed", object_id=bounty).count() == 1
    assert record["reserved"] == "5000.00" and not Ledger.objects.exists()
    graph = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty}/workflow/").json()
    event = next(row for row in graph["history"] if row["label"] == "发布人调整重要级别")
    assert event["node_id"] == "publication"
    assert Audit.objects.get(action="bounty.importance_changed", object_id=bounty).details["previous_reasons"] == [
        "40VC",
        "20%B",
    ]


def test_importance_changes_return_pending_topup_reviews_to_the_publisher(laboratory):
    lab = laboratory
    bounty = create(lab, major=True)
    assert action(lab, lab["independent"], bounty, "publication-review", {"reason": "核准发布"}).status_code == 200
    assert submit_quote(lab, bounty, kind="negotiated", vc="6000", basis="追加交付").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    assert change(lab, bounty, False).status_code == 200
    updated = quote_list(lab, bounty)["quotes"][0]
    assert updated["status"] == "pending" and not updated["adjustment"]["requires_review"]
    assert updated["history"][-1]["label"] == "退回重审"
    assert decide(lab, bounty, updated).status_code == 200
    assert detail(lab, bounty)["reserved"] == "6000.00"


def test_change_is_idempotent_and_requires_current_state_and_publisher_permissions(laboratory):
    lab = laboratory
    bounty = create(lab)
    expected = detail(lab, bounty)["importance_state"]
    key = str(uuid.uuid4())
    assert change(lab, bounty, True, user=lab["member"]).status_code == 403
    assert not detail(lab, bounty, lab["member"])["can_change_importance"]
    for _ in range(2):
        assert change(lab, bounty, True, expected_state=expected, request_key=key).status_code == 200
    assert Audit.objects.filter(action="bounty.importance_changed", object_id=bounty).count() == 1
    assert change(lab, bounty, False, expected_state=expected).status_code == 409
    assert change(lab, bounty, False, request_key=key).status_code == 409
    assert detail(lab, bounty)["status"] == "publication_review"


def test_personal_publisher_can_choose_importance_but_project_admin_cannot_override(laboratory):
    lab = laboratory
    setup(lab)
    assert grant(lab, "20").status_code == 201
    response = post(lab, body(lab, issue(lab), "10"))
    assert response.status_code == 201
    bounty = response.json()["id"]
    assert change(lab, bounty, True, user=lab["lead"]).status_code == 403
    expected = detail(lab, bounty, lab["member"])["importance_state"]
    assert change(lab, bounty, True, user=lab["member"], expected_state=expected).status_code == 200


def test_start_and_importance_change_are_serialized(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    allocation = action(lab, lab["member"], bounty, "claim", {"planned": "20", "deliverable": "交付"}).json()["id"]
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code == 200
    assert action(lab, lab["member"], bounty, "confirm").status_code == 200
    expected = detail(lab, bounty)["importance_state"]

    def race(operation):
        close_old_connections()
        try:
            return (
                action(lab, lab["lead"], bounty, "start")
                if operation == "start"
                else change(lab, bounty, True, expected_state=expected)
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(race, ("start", "change")))
    assert sorted(results) == [200, 400], results
    record = detail(lab, bounty)
    if record["status"] == "active":
        assert not record["can_change_importance"] and change(lab, bounty, True).status_code == 400
    else:
        assert record["status"] == "publication_review" and record["major"]


def test_invalid_level_or_reviewer_cannot_change_importance(laboratory):
    lab = laboratory
    bounty = create(lab)
    assert change(lab, bounty, "yes").status_code == 400
    assert change(lab, bounty, True, independent_reviewer_id="invalid").status_code == 400
    assert change(lab, bounty, True, independent_reviewer_id=None).status_code == 400
    assert not detail(lab, bounty)["major"] and not Audit.objects.filter(action="bounty.importance_changed").exists()
