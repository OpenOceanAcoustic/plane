# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
import uuid
import csv
from io import StringIO
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from decimal import Decimal

import pytest
from django.db import close_old_connections, transaction, IntegrityError
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from plane.db.models import Page, PageVersion, Project, ProjectMember, WorkspaceMember
from plane.lab.finance_models import FinancialAccount, FinancialEntry
from plane.lab.finance_services import balance
from plane.lab.management_models import ProjectManagementRecord
from .test_finance import act
from .test_finance_permissions import grant

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def path(lab, quality=False, project=None):
    return (
        lab["base"] + f"projects/{(project or lab['project']).id}/" + ("quality/" if quality else "finance-management/")
    )


def post(lab, kind, data=None, row=None, action="save", user=None, quality=False, **extra):
    return lab["client"](user or lab["lead"]).post(
        path(lab, quality),
        {
            "kind": kind,
            "action": action,
            "data": data or {},
            "record_id": row["id"] if row else str(uuid.uuid4()),
            "expected_version": row["version"] if row else 0,
            "request_key": str(uuid.uuid4()),
            "reason": "任务验收测试",
            **extra,
        },
        format="json",
    )


def ok(response):
    assert response.status_code == 201, response.content
    return response.json()


def cost(lab, category="labor", user=None, **extra):
    return ok(
        post(
            lab,
            "cost",
            {
                "category": category,
                "user_id": str((user or lab["member"]).id),
                "date": "2026-10-18",
                "work": "声学样本处理",
                "hours": "8",
                "rate": "100.10",
                "actual_amount": "200.10",
                "days": "2",
                "transport_rate": "30",
                "meal_rate": "50",
                "evidence": "invoice:sample",
                **extra,
            },
            user=user,
        )
    )


def approve(lab, row):
    return ok(post(lab, "cost", {"result": "approved", "note": "工时与成果已核对"}, row=row, action="review"))


def payroll(lab):
    return post(lab, "payroll", {"user_id": str(lab["member"].id), "start": "2026-10-01", "end": "2026-10-31"})


def cash(lab, amount="5000"):
    result = act(
        lab,
        "opening",
        {
            "project_id": str(lab["project"].id),
            "kind": "project",
            "amount": amount,
            "source": "项目可支配期初资金",
            "evidence": "bank:test",
        },
    )
    assert result.status_code == 200, result.content
    return FinancialAccount.objects.get(project=lab["project"], kind="project")


def pay(lab, row, account, **extra):
    return post(
        lab,
        row["kind"],
        {"account_id": str(account.id), "evidence": "bank:payment", "reference": "PAY-1"},
        row=row,
        action="pay",
        **extra,
    )


def audit_cost(lab, row, amount):
    return ok(
        post(
            lab,
            "audit",
            {"cost_id": row["id"], "allowed_amount": amount, "finding": "不合理支出核减", "evidence": "audit:report"},
        )
    )


def overview(lab, user=None):
    response = lab["client"](user or lab["lead"]).get(path(lab))
    assert response.status_code == 200, response.content
    return response.json()


def test_funding_contract_and_budget_are_versioned_without_creating_cash(laboratory):
    lab = laboratory
    key = str(uuid.uuid5(lab["project"].id, "funding"))
    data = {
        "source_type": "external",
        "funding_amount": "10000",
        "budget_amount": "8000",
        "basis": "双方签订合同",
        "reference": "HT-001",
    }
    first = ok(post(lab, "funding", data, record_id=key))
    second = ok(post(lab, "funding", {**data, "source_type": "internal", "basis": "内部会议决议"}, row=first))
    assert second["version"] == 2 and second["data"]["funding_amount"] == "10000.00"
    assert overview(lab)["summary"]["received"] == "0.00"
    assert not FinancialEntry.objects.exists()
    history = lab["client"](lab["lead"]).get(path(lab), {"record_id": key}).json()["history"]
    assert [row["version"] for row in history] == [2, 1]
    assert history[1]["data"]["source_type"] == "external"


def test_labor_payroll_uses_approved_hours_exact_rates_and_does_not_count_cost_twice(laboratory):
    lab = laboratory
    row = cost(lab)
    assert row["data"]["amount"] == "800.80"
    assert payroll(lab).status_code == 400
    approve(lab, row)
    wages = ok(payroll(lab))
    assert wages["data"]["hours"] == "8.00" and wages["data"]["amount"] == "800.80"
    assert wages["data"]["lines"][0]["work"] == "声学样本处理"
    assert payroll(lab).status_code == 400
    assert overview(lab)["summary"]["cost"] == "800.80"
    account = cash(lab)
    paid = ok(pay(lab, wages, account))
    assert balance(account) == Decimal("4199.20")
    assert overview(lab)["summary"]["cost"] == overview(lab)["summary"]["paid"] == "800.80"
    assert pay(lab, paid, account).status_code == 400
    assert post(lab, "payroll", row=paid, action="cancel").status_code == 400


@pytest.mark.parametrize("result", [None, "approved", "rejected"])
def test_cost_review_defaults_to_approved_and_allows_missing_notes(laboratory, result):
    lab = laboratory
    row = cost(lab)
    body = {
        "kind": "cost",
        "action": "review",
        "record_id": row["id"],
        "expected_version": row["version"],
        "request_key": str(uuid.uuid4()),
        "data": {} if result is None else {"result": result},
    }
    response = lab["client"](lab["lead"]).post(path(lab), body, format="json")
    reviewed = ok(response)
    assert reviewed["state"] == (result or "approved")
    assert reviewed["data"]["review_note"] == "" and reviewed["reason"] == ""
    assert ok(lab["client"](lab["lead"]).post(path(lab), body, format="json"))["version_id"] == reviewed["version_id"]


def test_optional_review_notes_do_not_bypass_permissions_or_daily_hours(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="16"))
    row = cost(lab, hours="9")
    assert post(lab, "cost", {}, row=row, action="review", user=lab["member"], reason="").status_code == 403
    assert post(lab, "cost", {}, row=row, action="review", reason="").status_code == 400


def test_reimbursement_transport_meals_audit_recovery_and_reversal_are_traceable(laboratory):
    lab = laboratory
    row = approve(lab, cost(lab, "travel"))
    assert row["data"]["amount"] == "360.10"
    assert row["data"]["transport"] == "60.00" and row["data"]["meal"] == "100.00"
    account = cash(lab)
    paid = ok(pay(lab, row, account))
    adjustment = audit_cost(lab, paid, "300.10")
    assert adjustment["data"]["adjustment"] == "-60.00"
    assert overview(lab)["summary"]["recovery"] == "60.00"
    assert overview(lab)["summary"]["cost"] == "300.10"
    recovered = ok(
        post(
            lab, "recovery", {"cost_id": row["id"], "amount": "40", "evidence": "bank:refund", "reference": "REFUND-1"}
        )
    )
    assert balance(account) == Decimal("4679.90")
    assert overview(lab)["summary"]["recovery"] == "20.00"
    assert (
        post(
            lab, "recovery", {"cost_id": row["id"], "amount": "21", "evidence": "bank:r", "reference": "R"}
        ).status_code
        == 400
    )
    assert post(lab, "cost", {"evidence": "bank:r"}, row=paid, action="reverse-payment").status_code == 400
    ok(post(lab, "recovery", {"evidence": "bank:reverse"}, row=recovered, action="reverse-recovery"))
    assert overview(lab)["summary"]["recovery"] == "60.00"
    ok(post(lab, "cost", {"evidence": "bank:reverse"}, row=paid, action="reverse-payment"))
    assert balance(account) == Decimal("5000.00")
    assert overview(lab)["summary"]["cost"] == "300.10"


def test_audit_cannot_change_ready_payroll_and_paid_payroll_reversal_releases_worklogs(laboratory):
    lab = laboratory
    row = approve(lab, cost(lab))
    wages = ok(payroll(lab))
    assert (
        post(
            lab, "audit", {"cost_id": row["id"], "allowed_amount": "700", "finding": "调整", "evidence": "audit"}
        ).status_code
        == 400
    )
    account = cash(lab)
    paid = ok(pay(lab, wages, account))
    audit_cost(lab, row, "700")
    reversed_row = ok(post(lab, "payroll", {"evidence": "bank:reverse"}, row=paid, action="reverse-payment"))
    assert reversed_row["state"] == "cancelled"
    assert ok(payroll(lab))["data"]["amount"] == "700.00"


def test_insufficient_cash_wrong_account_and_generic_reversal_cannot_bypass_guards(laboratory):
    lab = laboratory
    row = approve(lab, cost(lab, "equipment"))
    account = cash(lab, "10")
    assert pay(lab, row, account).status_code == 400
    assert balance(account) == 10
    assert overview(lab)["records"][0]["state"] == "approved"
    act(
        lab,
        "opening",
        {
            "project_id": str(lab["project"].id),
            "kind": "project",
            "amount": "500",
            "source": "追加期初",
            "evidence": "bank",
        },
    )
    paid = ok(pay(lab, row, account))
    assert (
        act(lab, "reverse", {"operation_id": paid["data"]["payment_operation_id"], "evidence": "bank"}).status_code
        == 400
    )
    assert act(lab, "project-delete", {"project_id": str(lab["project"].id)}).status_code == 400


def test_self_service_and_delegation_keep_private_finances_isolated(laboratory):
    lab = laboratory
    own = cost(lab, user=lab["member"])
    cost(lab, user=lab["reviewer"])
    data = overview(lab, lab["member"])
    assert data["summary"] is None and len(data["records"]) == 1 and data["records"][0]["id"] == own["id"]
    assert (
        post(
            lab, "cost", {"result": "approved", "note": "自批"}, row=own, action="review", user=lab["member"]
        ).status_code
        == 403
    )
    assert post(lab, "funding", {}, user=lab["member"]).status_code == 403
    assert grant(lab, lab["member"], ["record"]).status_code == 200
    assert (
        post(
            lab, "cost", {"result": "approved", "note": "登记员"}, row=own, action="review", user=lab["member"]
        ).status_code
        == 403
    )
    assert grant(lab, lab["member"], ["approve"]).status_code == 200
    assert (
        post(
            lab, "cost", {"result": "approved", "note": "核准"}, row=own, action="review", user=lab["member"]
        ).status_code
        == 201
    )
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert lab["client"](lab["member"]).get(path(lab)).status_code == 403


@pytest.mark.parametrize(
    "field,value",
    [
        ("rate", "-1"),
        ("hours", "24.01"),
        ("hours", "0"),
        ("hours", "1e3"),
        ("rate", "1.001"),
        ("date", "2026-02-30"),
        ("category", []),
        ("work", ""),
    ],
)
def test_malformed_labor_inputs_do_not_create_costs(laboratory, field, value):
    lab = laboratory
    result = post(
        lab,
        "cost",
        {
            "category": "labor",
            "user_id": str(lab["member"].id),
            "date": "2026-10-18",
            "work": "劳动",
            "hours": "8",
            "rate": "100",
            field: value,
        },
    )
    assert result.status_code == 400, result.content
    assert not ProjectManagementRecord.objects.exists()


def test_cumulative_daily_hours_and_rounding(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="16"))
    second = cost(lab, hours="9")
    assert post(lab, "cost", {"result": "approved", "note": "核准"}, row=second, action="review").status_code == 400
    travel = cost(lab, "travel", days="0.01", actual_amount="0", transport_rate="0.50", meal_rate="0.50")
    assert travel["data"]["amount"] == "0.02"


def test_archived_projects_allow_audit_but_not_new_expenses(laboratory):
    lab = laboratory
    row = approve(lab, cost(lab))
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now())
    audit_cost(lab, row, "700")
    assert post(lab, "cost", {}).status_code == 400


def test_retry_and_concurrent_payroll_only_create_one_payable(laboratory):
    lab = laboratory
    approve(lab, cost(lab))
    barrier = Barrier(2)

    def submit(_):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return payroll(lab).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(results) == [201, 400]


def artifact(lab, **extra):
    return ok(
        post(
            lab,
            "artifact",
            {"category": "requirements", "title": "需求规格说明", "content": "必须覆盖接口及性能", **extra},
            quality=True,
            user=lab["member"],
        )
    )


def test_quality_templates_native_documents_and_version_bound_review(laboratory):
    lab = laboratory
    row = artifact(lab)
    page = Page.objects.get(id=row["data"]["page_id"])
    assert page.access == Page.PUBLIC_ACCESS
    submitted = ok(post(lab, "artifact", row=row, action="submit", quality=True))
    assert (
        post(
            lab,
            "artifact",
            {"result": "approved", "note": "复核通过"},
            row=submitted,
            action="review",
            quality=True,
            user=lab["member"],
        ).status_code
        == 403
    )
    approved = ok(
        post(
            lab, "artifact", {"result": "approved", "note": "条件已明确"}, row=submitted, action="review", quality=True
        )
    )
    assert approved["document_current"]
    page.description_html = "<p>需求变更</p>"
    page.save(update_fields=["description_html"])
    # Content changes without a new PageVersion must also invalidate the old approval.
    current = lab["client"](lab["lead"]).get(path(lab, True)).json()["records"][0]
    assert current["state"] == "approved" and current["document_current"] is False
    resubmitted = ok(post(lab, "artifact", row=approved, action="submit", quality=True))
    assert resubmitted["document_current"]
    assert PageVersion.objects.filter(page=page).count() == 2
    version = PageVersion.objects.get(id=approved["data"]["page_version_id"])
    with pytest.raises(ProtectedError):
        version.delete(soft=False)
    assert ProjectManagementRecord.objects.filter(document_version=version).exists()


def test_finance_export_escapes_formulas_and_preserves_audit_numbers(laboratory):
    lab = laboratory
    row = approve(lab, cost(lab, "equipment", work="=SUM(A1)", actual_amount="200.10"))
    audit_cost(lab, row, "100.10")
    response = lab["client"](lab["lead"]).get(path(lab) + "?format=csv")
    assert response.status_code == 200
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8-sig"))))
    cost_row = next(row for row in rows if row["类型"] == "执行成本")
    audit_row = next(row for row in rows if row["类型"] == "审计调整")
    assert cost_row["事项"] == "'=SUM(A1)"
    assert cost_row["认定金额（元）"] == "100.10"
    assert audit_row["调整前认定金额（元）"] == "200.10"
    assert audit_row["审计差额（元）"] == "-100.00"


def test_project_plan_contains_members_schedule_requirements_and_technical_route(laboratory):
    lab = laboratory
    row = ok(
        post(
            lab,
            "plan",
            {
                "title": "项目计划",
                "requirements": "需求与验收标准",
                "technical_route": "数值模型与实验验证",
                "assignments": [
                    {"user_id": str(lab["member"].id), "work": "实现模型", "start": "2026-10-18", "end": "2026-11-01"}
                ],
            },
            record_id=str(uuid.uuid5(lab["project"].id, "plan")),
            quality=True,
        )
    )
    assert row["data"]["assignments"][0]["user_name"] == lab["member"].display_name
    assert "实现模型" in Page.objects.get(id=row["data"]["page_id"]).description_html
    catalog = lab["client"](lab["lead"]).get(path(lab, True)).json()["catalog"]
    assert len(catalog) == 11 and {"test-outline", "test-specification", "test-report", "certificate"} <= {
        entry["key"] for entry in catalog
    }
    original_page = Page.objects.get(id=row["data"]["page_id"])
    original_page.description_binary = b"native-plan-state"
    original_page.save(update_fields=["description_binary"])
    revision_data = {key: row["data"][key] for key in ("title", "requirements", "technical_route", "assignments")}
    revised = ok(post(lab, "plan", revision_data, row=row, quality=True))
    assert revised["data"]["page_id"] != str(original_page.id)
    original_page.refresh_from_db()
    assert bytes(original_page.description_binary) == b"native-plan-state"


def test_template_edit_preserves_native_editor_body_and_allows_relinking(laboratory):
    lab = laboratory
    row = artifact(lab)
    page = Page.objects.get(id=row["data"]["page_id"])
    page.description_binary = b"native-collaborative-state"
    page.description_html = "<p>原生编辑后的需求</p>"
    page.save(update_fields=["description_binary", "description_html"])
    data = {"category": "requirements", "title": "需求规格说明", "content": "旧模板正文"}
    assert post(lab, "artifact", data, row=row, quality=True).status_code == 400
    page.refresh_from_db()
    assert bytes(page.description_binary) == b"native-collaborative-state"
    assert page.description_html == "<p>原生编辑后的需求</p>"
    data["page_id"] = str(page.id)
    relinked = ok(post(lab, "artifact", data, row=row, quality=True))
    assert relinked["document_current"] and relinked["data"]["content"] == ""


def test_quality_rejects_private_or_cross_project_documents_and_foreign_members(laboratory):
    lab = laboratory
    foreign = Project.objects.create(workspace=lab["workspace"], name="Other", identifier="OTHER")
    response = lab["client"](lab["member"]).get(path(lab, True, foreign))
    assert response.status_code == 403
    row = artifact(lab)
    page = Page.objects.get(id=row["data"]["page_id"])
    page.access = Page.PRIVATE_ACCESS
    page.save(update_fields=["access"])
    assert (
        post(
            lab,
            "artifact",
            {"category": "requirements", "title": "私密资料", "page_id": str(page.id)},
            quality=True,
            user=lab["member"],
        ).status_code
        == 400
    )
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert lab["client"](lab["member"]).get(path(lab, True)).status_code == 403


def test_management_history_is_immutable_at_database_level(laboratory):
    lab = laboratory
    cost(lab)
    with pytest.raises(IntegrityError), transaction.atomic():
        ProjectManagementRecord.objects.update(state="paid")
