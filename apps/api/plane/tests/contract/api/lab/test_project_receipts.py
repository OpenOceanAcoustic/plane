import uuid
from decimal import Decimal

import pytest

from plane.db.models import Project, ProjectMember
from plane.lab.models import Stage
from plane.lab.finance_models import CashBatch, FinancialAccount, FinancialEntry, FinancialOperation, StageBudget
from plane.lab.finance_services import balance
from .test_finance import act, overview, plan, receipt

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def payload(lab, **extra):
    return {"project_id": str(lab["project"].id), "gross": "1000", "costs": "30", "source": "项目回款", "evidence": "synthetic-bank-receipt", **extra}


def received(lab, **extra):
    response = act(lab, "receipt", payload(lab, **extra))
    assert response.status_code == 200, response.content
    return CashBatch.objects.get(id=response.json()["id"])


def project_account(lab):
    return FinancialAccount.objects.get(project=lab["project"], kind="project")


def test_receipt_without_stage_or_budget_retains_cash_in_project(laboratory):
    lab = laboratory
    assert not Stage.objects.filter(project=lab["project"]).exists()
    batch = received(lab)
    assert batch.budget_id is None and batch.operation.stage_id is None
    assert batch.operation.project_id == lab["project"].id
    assert batch.D == Decimal("970")
    assert batch.risk == batch.execution == batch.history == 0
    assert balance(project_account(lab)) == Decimal("970")
    assert not Stage.objects.filter(project=lab["project"]).exists()
    assert not StageBudget.objects.exists()
    assert list(FinancialEntry.objects.filter(operation=batch.operation).values_list("delta", flat=True)) == [Decimal("1000"), Decimal("-30")]
    assert not FinancialAccount.objects.filter(workspace=lab["workspace"]).exclude(kind="project").exists()
    data = overview(lab)
    row = next(row for row in data["batches"] if row["id"] == str(batch.id))
    assert row["project_id"] == str(lab["project"].id) and row["stage_id"] is None
    assert row["can_delete"] and not row["can_pay"]
    management = lab["client"](lab["lead"]).get(lab["base"] + f"projects/{lab['project'].id}/finance-management/")
    assert management.status_code == 200 and management.json()["summary"]["received"] == "1000.00"
    workflow = lab["client"](lab["lead"]).get(lab["base"] + f"finance/workflow/?project_id={lab['project'].id}")
    assert workflow.status_code == 200
    assert any(action["action"] == "receipt" and action["body"].get("project_id") == str(lab["project"].id) for action in workflow.json()["actions"])


def test_project_receipt_is_idempotent_and_incompatible_replay_is_rejected(laboratory):
    lab = laboratory
    body = payload(lab, request_key=str(uuid.uuid4()))
    first = act(lab, "receipt", body)
    again = act(lab, "receipt", body)
    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert CashBatch.objects.count() == 1
    assert balance(project_account(lab)) == Decimal("970")
    assert act(lab, "receipt", {**body, "gross": "1001"}).status_code == 400


@pytest.mark.parametrize("extra", [{"costs": "1001"}, {"gross": "0"}, {"gross": "-1"}, {"D": "500"}, {"evidence": ""}, {"source": ""}])
def test_invalid_project_receipt_does_not_write_financial_history(laboratory, extra):
    lab = laboratory
    response = act(lab, "receipt", payload(lab, **extra))
    assert response.status_code == 400, response.content
    assert not CashBatch.objects.exists() and not FinancialEntry.objects.exists()
    assert not FinancialOperation.objects.filter(kind="receipt").exists()


def test_project_receipt_requires_record_permission(laboratory):
    lab = laboratory
    response = act(lab, "receipt", payload(lab), user=lab["member"])
    assert response.status_code == 403
    assert not CashBatch.objects.exists()


def test_receipt_rejects_unknown_project(laboratory):
    lab = laboratory
    response = act(lab, "receipt", payload(lab, project_id=str(uuid.uuid4())))
    assert response.status_code == 404
    assert not CashBatch.objects.exists()


def test_project_receipt_may_be_deleted_without_a_stage(laboratory):
    lab = laboratory
    batch = received(lab)
    response = act(lab, "receipt-delete", {"batch_id": str(batch.id)})
    assert response.status_code == 200, response.content
    assert balance(project_account(lab)) == 0
    assert next(row for row in overview(lab)["batches"] if row["id"] == str(batch.id))["reversed"]


def test_project_receipt_cannot_be_deleted_after_cash_is_spent(laboratory):
    lab = laboratory
    batch = received(lab)
    response = act(lab, "expense", {"account_id": str(project_account(lab).id), "amount": "100", "purpose": "项目采购", "evidence": "synthetic-invoice"})
    assert response.status_code == 200, response.content
    assert act(lab, "receipt-delete", {"batch_id": str(batch.id)}).status_code == 400
    assert balance(project_account(lab)) == Decimal("870")


def test_project_cash_can_fund_optional_stage_rewards_later(laboratory):
    lab = laboratory
    batch = received(lab)
    stage, _ = plan(lab, E="100")
    source = project_account(lab)
    response = act(lab, "stage-allocation", {"from_account_id": str(source.id), "stage_id": stage, "amount": "100"})
    assert response.status_code == 200, response.content
    assert balance(source) == Decimal("870")
    assert balance(FinancialAccount.objects.get(stage_id=stage, kind="execution")) == Decimal("100")
    batch.refresh_from_db()
    assert batch.budget_id is None and batch.execution == 0


def test_explicit_project_never_automatically_splits_existing_stage_budget(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    received(lab, stage_id=stage)
    assert balance(FinancialAccount.objects.get(stage_id=stage, kind="execution")) == 0
    assert balance(project_account(lab)) == Decimal("970")


def test_project_receipt_rejects_mismatched_stage(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    other = Project.objects.create(workspace=lab["workspace"], name="其他项目", identifier="RC2", project_lead=lab["lead"], created_by=lab["lead"])
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["lead"], role=20)
    response = act(lab, "receipt", payload(lab, project_id=str(other.id), stage_id=stage))
    assert response.status_code == 400
    assert not CashBatch.objects.exists()


def test_legacy_stage_only_receipts_still_use_frozen_allocation(laboratory):
    lab = laboratory
    stage, _ = plan(lab)
    identifier = receipt(lab, stage, gross="1000", costs="0", D="1000")
    row = CashBatch.objects.get(id=identifier)
    assert row.budget_id and row.execution > 0 and row.risk > 0
    assert next(batch for batch in overview(lab)["batches"] if batch["id"] == identifier)["stage_id"] == stage


def test_project_receipt_respects_closed_finance_scope(laboratory):
    lab = laboratory
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 200
    assert act(lab, "receipt", payload(lab)).status_code == 400
    assert not CashBatch.objects.exists()


def test_project_cash_cannot_be_allocated_to_another_projects_stage(laboratory):
    lab = laboratory
    received(lab)
    other = Project.objects.create(workspace=lab["workspace"], name="其他项目", identifier="RCA", project_lead=lab["lead"], created_by=lab["lead"])
    for user in [lab["lead"], lab["member"]]:
        ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=user, role=20 if user == lab["lead"] else 15)
    created = lab["client"](lab["lead"]).post(lab["base"] + "stages/", {"project_id": str(other.id), "name": "其他项目阶段", "budget": "1000"}, format="json")
    assert created.status_code == 201, created.content
    stage = created.json()["id"]
    frozen = act(lab, "stage", {"stage_id": stage, "E": "100", "purposes": [{"name": "可选奖励", "amount": "100"}], "members": []})
    assert frozen.status_code == 200, frozen.content
    response = act(lab, "stage-allocation", {"from_account_id": str(project_account(lab).id), "stage_id": stage, "amount": "100"})
    assert response.status_code == 400
    assert balance(project_account(lab)) == Decimal("970")
