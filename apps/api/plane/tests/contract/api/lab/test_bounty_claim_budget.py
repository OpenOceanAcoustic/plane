# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from decimal import Decimal

import pytest

from plane.lab.models import Allocation, Bounty, Ledger
from .test_bounties import action, prepare
from .test_bounty_public_access import cross_member

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_public_claim_available_is_approved_plan_balance_without_disclosing_participants(laboratory):
    lab = laboratory
    bounty_id, _, _ = prepare(lab, budget="20")
    approved = Allocation.objects.create(
        bounty_id=bounty_id,
        user=lab["member"],
        user_id_snapshot=lab["member"].id,
        user_name="Private member",
        deliverable="Private material",
        planned=Decimal("15"),
        approved=True,
        confirmed=True,
    )
    Allocation.objects.create(
        bounty_id=bounty_id,
        user=lab["lead"],
        user_id_snapshot=lab["lead"].id,
        user_name="Pending lead",
        deliverable="Private pending work",
        planned=Decimal("4"),
    )
    Ledger.objects.create(
        bounty_id=bounty_id,
        allocation=approved,
        delta=Decimal("3"),
        actor=lab["reviewer"],
        actor_name="Reviewer",
        reason="Previously earned",
        task_snapshot={},
        participant_snapshot={},
        request_key=uuid.uuid4(),
    )
    outsider = cross_member(lab)
    record = lab["client"](outsider).get(lab["base"] + f"bounties/{bounty_id}/detail/").json()
    assert record["claim_available"] == "5.00"
    assert record["allocations"] == [] and record["awarded"] is None
    assert "Private member" not in str(record) and "Private material" not in str(record)
    rejected = action(lab, outsider, bounty_id, "claim", {"planned": "5.01", "deliverable": "Requested work"})
    assert rejected.status_code == 400, rejected.content
    assert not Allocation.objects.filter(bounty_id=bounty_id, user=outsider).exists()
    accepted = action(lab, outsider, bounty_id, "claim", {"planned": "5", "deliverable": "Requested work"})
    assert accepted.status_code == 200, accepted.content
    assert action(lab, lab["lead"], bounty_id, "approve", {"allocation_id": accepted.json()["id"]}).status_code == 200
    record = lab["client"](lab["reviewer"]).get(lab["base"] + f"bounties/{bounty_id}/detail/").json()
    assert record["claim_available"] == "0.00" and not record["can_claim"]
    assert Bounty.objects.get(id=bounty_id).reserved == Decimal("20")
