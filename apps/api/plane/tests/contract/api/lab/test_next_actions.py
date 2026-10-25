# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

import pytest
from cryptography.fernet import Fernet

from plane.lab.management_models import ProjectManagementRecord
from .test_bounties import action, prepare, start
from .test_finance_permissions import grant
from .test_project_management import approve, cost, ok, payroll

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def actions(lab, user, query=""):
    response = lab["client"](user).get(lab["base"] + "me/next-actions/" + query)
    assert response.status_code == 200, response.content
    return response.json()


def unrelated_records(lab, count, state="approved"):
    ProjectManagementRecord.objects.bulk_create(
        [
            ProjectManagementRecord(
                workspace=lab["workspace"],
                project=lab["project"],
                project_id_snapshot=lab["project"].id,
                kind="cost",
                object_key=uuid.uuid4(),
                version=1,
                state=state,
                data={"work": f"已完成记录 {index:03}", "amount": "1"},
                reason="测试历史",
                actor=lab["lead"],
                actor_name=lab["lead"].display_name,
                request_key=uuid.uuid4(),
                request_snapshot={},
            )
            for index in range(count)
        ]
    )


def test_pay_only_delegate_receives_payroll_but_not_approval_actions(laboratory):
    lab = laboratory
    approve(lab, cost(lab))
    wages = ok(payroll(lab))
    pending = cost(lab, date="2026-10-19")
    assert grant(lab, lab["independent"], ["pay"]).status_code == 200
    items = actions(lab, lab["independent"])["items"]
    assert any(item["id"] == wages["id"] and item["action"] == "待付款" for item in items)
    assert all(item["id"] != pending["id"] for item in items)
    assert not actions(lab, lab["member"])["items"]


def test_pending_cost_survives_more_than_eighty_new_closed_records(laboratory):
    lab = laboratory
    pending = cost(lab)
    unrelated_records(lab, 85)
    items = actions(lab, lab["lead"])["items"]
    assert any(item["id"] == pending["id"] for item in items)


def test_workbench_pages_actual_pending_actions(laboratory):
    lab = laboratory
    unrelated_records(lab, 105, state="submitted")
    first = actions(lab, lab["lead"])
    second = actions(lab, lab["lead"], "?offset=100")
    assert first["count"] == 105 and len(first["items"]) == 100 and first["next_offset"] == 100
    assert len(second["items"]) == 5 and second["next_offset"] is None
    assert not {item["id"] for item in first["items"]}.intersection(item["id"] for item in second["items"])


def test_team_acceptance_is_offered_to_the_designated_reviewer(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    start(lab, bounty)
    assert action(lab, lab["member"], bounty, "submit", {"evidence": "dataset:v1"}).status_code == 200
    item = next(item for item in actions(lab, lab["reviewer"])["items"] if item["id"] == bounty)
    assert item["action"] == "待验收" and item["url"] == f"/lab/lab/bounties?bounty_id={bounty}"
    assert all(item["id"] != bounty for item in actions(lab, lab["lead"])["items"])


def test_invitation_creation_uses_the_registered_token_route(laboratory, settings):
    lab = laboratory
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "invitations/", {"project_id": str(lab["project"].id)}, format="json"
    )
    assert response.status_code == 201, response.content
    assert response.json()["url"].startswith("/lab/register/")
    token = response.json()["url"].rsplit("/", 1)[-1]
    assert len(token) == 43


def test_malformed_invitation_project_is_a_validation_error(laboratory):
    lab = laboratory
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "invitations/", {"project_id": "bad-project"}, format="json"
    )
    assert response.status_code == 400, response.content


def test_pay_only_delegate_receives_positive_audited_reimbursement_actions(laboratory):
    from .test_project_management import audit_cost

    lab = laboratory
    payable = approve(lab, cost(lab, category="equipment", work="待报销设备"))
    audit_cost(lab, payable, "123.45")
    excluded = approve(lab, cost(lab, category="equipment", work="审计核减为零"))
    audit_cost(lab, excluded, "0")
    labor = approve(lab, cost(lab, work="尚未生成工资单的工时"))
    pending = cost(lab, work="尚未核准的工时")
    assert grant(lab, lab["independent"], ["pay"]).status_code == 200
    items = actions(lab, lab["independent"])["items"]
    match = next((item for item in items if item["id"] == payable["id"]), None)
    assert match is not None, items
    assert match["kind"] == "cost" and match["action"] == "待付款" and match["amount"] == "123.45"
    assert not {item["id"] for item in items}.intersection({excluded["id"], labor["id"], pending["id"]})
    assert not actions(lab, lab["member"])["items"]


def test_archived_project_does_not_offer_financial_mutations(laboratory):
    from django.utils import timezone
    from plane.db.models import Project

    lab = laboratory
    approve(lab, cost(lab))
    wages = ok(payroll(lab))
    pending = cost(lab, date="2026-10-19")
    reimbursement = approve(lab, cost(lab, category="equipment"))
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now())
    assert not {item["id"] for item in actions(lab, lab["lead"])["items"]}.intersection(
        {wages["id"], pending["id"], reimbursement["id"]}
    )


def test_finance_closed_project_hides_legacy_pending_records(laboratory):
    from .test_finance import act

    lab = laboratory
    closed = act(lab, "project-delete", {"project_id": str(lab["project"].id)})
    assert closed.status_code == 200, closed.content
    # Closure now refuses unresolved obligations. A historical imported record
    # must not turn that closed project back into an actionable approval target.
    unrelated_records(lab, 1, state="submitted")
    assert not [item for item in actions(lab, lab["lead"])["items"] if item["kind"] in ("cost", "payroll")]
