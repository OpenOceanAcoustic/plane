# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest

from plane.db.models import Project, ProjectMember, WorkspaceMember
from .test_finance import act, plan, receipt, settle, commit, overview

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_assigning_public_manager_preserves_existing_administrator_access(laboratory):
    lab = laboratory
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["reviewer"]).update(role=20)
    assigned = act(lab, "manager", {"user_id": str(lab["reviewer"].id)})
    assert assigned.status_code == 200, assigned.content
    for user in (lab["lead"], lab["reviewer"]):
        response = act(
            lab, "opening", {"kind": "public", "amount": "10", "source": "授权回归", "evidence": "bank:test"}, user=user
        )
        assert response.status_code == 200, response.content


def grant(lab, member, permissions, actor=None, project=None):
    return lab["client"](actor or lab["lead"]).post(
        lab["base"] + "finance/permissions/",
        {"project_id": str((project or lab["project"]).id), "user_id": str(member.id), "permissions": permissions},
        format="json",
    )


@pytest.mark.parametrize("permission", ["view", "record", "approve", "pay"])
def test_delegated_operations_are_independent_and_revocable(laboratory, permission):
    lab = laboratory
    stage, _ = plan(lab)
    batch = receipt(lab, stage)
    settlement = settle(lab, stage, "1000")
    commitment = commit(lab, settlement, "100")
    delegate = lab["independent"]
    assigned = grant(lab, delegate, [permission])
    assert assigned.status_code == 200, assigned.content
    data = overview(lab, delegate)
    assert data["accounts"] and data["entries"]
    project = data["projects"][0]
    assert set(project["permissions"]) == {"view", permission}
    assert not project["can_manage_permissions"] and not project["can_delete"]
    workflow = lab["client"](delegate).get(lab["base"] + "finance/workflow/", {"project_id": str(lab["project"].id)})
    assert workflow.status_code == 200, workflow.content
    workflow_actions = {row["action"] for row in workflow.json()["actions"]}
    assert ("receipt" in workflow_actions) == (permission == "record")
    assert ("settlement" in workflow_actions) == (permission == "approve")
    assert ("payment" in workflow_actions) == (permission == "pay")
    assert ("receipt" in data["allowed_actions"]) == (permission == "record")
    assert ("settlement" in data["allowed_actions"]) == (permission == "approve")
    assert ("payment" in data["allowed_actions"]) == (permission == "pay")
    cases = {
        "record": (
            "receipt",
            {
                "stage_id": stage,
                "gross": "100",
                "costs": "10",
                "D": "90",
                "source": "登记测试",
                "evidence": "bank:test",
            },
        ),
        "approve": (
            "settlement",
            {"stage_id": stage, "user_id": str(lab["reviewer"].id), "amount": "10", "performance_basis": "核准测试"},
        ),
        "pay": (
            "payment",
            {
                "commitment_id": commitment,
                "gross": "10",
                "withheld": "0",
                "reference": "付款测试",
                "evidence": "bank:test",
            },
        ),
    }
    for required, (action, body) in cases.items():
        response = act(lab, action, body, user=delegate)
        assert response.status_code == (200 if required == permission else 403), response.content
    risk_spending = act(
        lab,
        "risk-use",
        {"batch_id": batch, "amount": "1", "category": "refund", "purpose": "退款", "evidence": "bank:test"},
        user=delegate,
    )
    assert risk_spending.status_code == (200 if permission == "pay" else 403), risk_spending.content
    assert grant(lab, lab["member"], ["pay"], actor=delegate).status_code == 403
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}, user=delegate).status_code == 403
    assert (
        act(
            lab, "opening", {"kind": "public", "amount": "10", "source": "测试", "evidence": "bank:test"}, user=delegate
        ).status_code
        == 403
    )
    assert grant(lab, delegate, []).status_code == 200
    assert not overview(lab, delegate)["accounts"]
    for _, (action, body) in cases.items():
        assert act(lab, action, body, user=delegate).status_code == 403


def test_creator_retains_control_after_lead_change_and_delegation(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    Project.objects.filter(id=lab["project"].id).update(created_by=lab["member"], project_lead=lab["reviewer"])
    lab["project"].refresh_from_db()
    creator = lab["member"]
    assert grant(lab, lab["independent"], ["record", "pay"], actor=creator).status_code == 200
    assert overview(lab, creator)["projects"][0]["can_manage_permissions"]
    result = act(
        lab,
        "receipt",
        {"stage_id": stage, "gross": "100", "costs": "0", "D": "100", "source": "创建者登记", "evidence": "bank:test"},
        user=creator,
    )
    assert result.status_code == 200, result.content
    assert grant(lab, creator, [], actor=lab["reviewer"]).status_code == 400
    assert grant(lab, lab["independent"], [], actor=creator).status_code == 200


def test_grant_is_project_scoped_and_requires_live_membership(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    member = lab["member"]
    assert grant(lab, member, ["record"]).status_code == 200
    foreign = Project.objects.create(
        workspace=lab["workspace"], name="其他项目", identifier="FP", project_lead=lab["reviewer"]
    )
    ProjectMember.objects.create(workspace=lab["workspace"], project=foreign, member=member, role=15)
    payload = {
        "project_id": str(foreign.id),
        "kind": "project",
        "amount": "10",
        "source": "测试",
        "evidence": "bank:test",
    }
    assert act(lab, "opening", payload, user=member).status_code == 403
    assert grant(lab, member, ["administrator"]).status_code == 400
    ProjectMember.objects.filter(project=lab["project"], member=member).update(role=5)
    assert not overview(lab, member)["accounts"]
    assert grant(lab, member, ["pay"]).status_code == 400
    assert act(lab, "receipt", {"stage_id": stage}, user=member).status_code == 403
    ProjectMember.objects.filter(project=lab["project"], member=member).update(role=15)
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=member).update(is_active=False)
    assert act(lab, "receipt", {"stage_id": stage}, user=member).status_code == 403


@pytest.mark.parametrize("identifier", [None, "invalid", ""])
def test_finance_grants_reject_invalid_project_ids(laboratory, identifier):
    lab = laboratory
    client = lab["client"](lab["lead"])
    response = client.post(
        lab["base"] + "finance/permissions/",
        {"project_id": identifier, "user_id": str(lab["member"].id), "permissions": ["view"]},
        format="json",
    )
    assert response.status_code == 400
    assert client.get(lab["base"] + "finance/permissions/", {"project_id": identifier or ""}).status_code == 400
