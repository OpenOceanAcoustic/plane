# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

import pytest

from plane.db.models import ProjectMember
from plane.lab.models import Ledger
from .test_bounties import action, prepare, start

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def earned_contribution(lab):
    bounty_id, _, _ = prepare(lab)
    allocation = start(lab, bounty_id)
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "已完成交付"}).status_code == 200
    response = action(
        lab,
        lab["reviewer"],
        bounty_id,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "验收通过", "targets": {allocation: "20"}},
    )
    assert response.status_code == 200, response.content
    return bounty_id, Ledger.objects.get(bounty_id=bounty_id)


def test_deleted_bounty_ledger_keeps_authorized_correction_and_revokes_it_after_reversal(laboratory):
    lab = laboratory
    bounty_id, entry = earned_contribution(lab)
    lead = lab["client"](lab["lead"])
    assert (
        lead.delete(
            lab["base"] + f"bounties/{bounty_id}/detail/", {"reason": "删除已完成卡片"}, format="json"
        ).status_code
        == 204
    )
    assert lead.get(lab["base"] + "bounties/").json() == []
    assert lead.get(lab["base"] + "ledger/").json()[0]["can_reverse"] is True
    for user in (lab["member"], lab["reviewer"]):
        client = lab["client"](user)
        assert client.get(lab["base"] + "ledger/").json()[0]["can_reverse"] is False
        assert (
            client.post(
                lab["base"] + f"ledger/{entry.id}/reverse/",
                {"request_key": str(uuid.uuid4()), "reason": "越权更正"},
                format="json",
            ).status_code
            == 403
        )
    payload = {"request_key": str(uuid.uuid4()), "reason": "删除后追加验收更正"}
    for _ in range(2):
        assert lead.post(lab["base"] + f"ledger/{entry.id}/reverse/", payload, format="json").status_code == 200
    rows = lead.get(lab["base"] + "ledger/").json()
    assert len(rows) == 2 and all(row["can_reverse"] is False for row in rows)
    assert {row["delta"] for row in rows} == {"20.00", "-20.00"}


def test_ledger_correction_capability_requires_current_lead_and_active_member_role(laboratory):
    lab = laboratory
    _, entry = earned_contribution(lab)
    lead = lab["client"](lab["lead"])
    membership = ProjectMember.objects.get(project=lab["project"], member=lab["lead"])
    membership.role = 10
    membership.save(update_fields=["role"])
    assert lead.get(lab["base"] + "ledger/").json()[0]["can_reverse"] is False
    assert (
        lead.post(
            lab["base"] + f"ledger/{entry.id}/reverse/",
            {"request_key": str(uuid.uuid4()), "reason": "已撤销成员办理权限"},
            format="json",
        ).status_code
        == 403
    )
    membership.role = 15
    membership.save(update_fields=["role"])
    assert lead.get(lab["base"] + "ledger/").json()[0]["can_reverse"] is True
    lab["project"].project_lead = lab["member"]
    lab["project"].save(update_fields=["project_lead"])
    assert lead.get(lab["base"] + "ledger/").json()[0]["can_reverse"] is False
    assert lab["client"](lab["member"]).get(lab["base"] + "ledger/").json()[0]["can_reverse"] is True
