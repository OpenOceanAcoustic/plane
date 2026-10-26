# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import Project, ProjectMember, WorkspaceMember
from plane.lab.finance_models import FinancialEntry, FinancialOperation
from plane.lab.management_models import latest_records
from plane.lab.models import PayrollRun, PayrollSchedule
from plane.lab.monthly_payroll import generate_project_month, month_bounds, next_run_at, run_due_payrolls
from .test_finance_permissions import grant
from .test_project_management import approve, audit_cost, cost, ok, payroll

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def url(lab):
    return lab["base"] + "payroll-monthly/"


def monthly(lab, month="2026-10", user=None, project_ids=None):
    return lab["client"](user or lab["lead"]).post(
        url(lab),
        {
            "month": month,
            "project_ids": project_ids or [str(lab["project"].id)],
        },
        format="json",
    )


def enable(lab, value=True, user=None, project_ids=None):
    return lab["client"](user or lab["lead"]).patch(
        url(lab),
        {
            "enabled": value,
            "project_ids": project_ids or [str(lab["project"].id)],
        },
        format="json",
    )


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=dt_timezone.utc)


@pytest.fixture(autouse=True)
def current_october():
    with patch("plane.lab.monthly_payroll.timezone.now", return_value=utc("2026-10-26T10:00:00")):
        yield


def test_batch_groups_people_uses_recognized_approved_labor_and_never_pays(laboratory):
    lab = laboratory
    first = approve(lab, cost(lab, hours="2"))
    approve(lab, cost(lab, user=lab["reviewer"], hours="3"))
    cost(lab, hours="1")  # Not approved.
    approve(lab, cost(lab, date="2026-09-15", hours="1"))
    approve(lab, cost(lab, category="travel"))
    response = monthly(lab)
    assert response.status_code == 201, response.content
    result = response.json()
    assert result["created_count"] == 2
    assert result["created_amount"] == "500.50"
    records = result["projects"][0]["records"]
    assert {row["data"]["user_id"] for row in records} == {str(lab["member"].id), str(lab["reviewer"].id)}
    assert all(row["state"] == "ready" for row in records)
    assert any(first["id"] in row["data"]["cost_ids"] for row in records)
    assert not FinancialEntry.objects.exists()
    assert not FinancialOperation.objects.exists()
    repeat = monthly(lab).json()
    assert repeat["created_count"] == 0
    assert latest_records(lab["project"].id).filter(kind="payroll").count() == 2


def test_late_approval_supplements_existing_month_without_repaying(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="2"))
    existing = ok(payroll(lab))
    late = approve(lab, cost(lab, hours="1"))
    result = monthly(lab).json()
    assert result["created_count"] == 1
    assert result["projects"][0]["records"][0]["data"]["cost_ids"] == [late["id"]]
    assert result["projects"][0]["records"][0]["id"] != existing["id"]


def test_cross_month_period_is_visible_failure_and_does_not_silently_split(laboratory):
    lab = laboratory
    approve(lab, cost(lab, date="2026-09-30", end_date="2026-10-02", hours="8", estimate_mode="total"))
    result = monthly(lab).json()
    assert result["created_count"] == 0
    assert result["projects"][0]["status"] == "failed"
    assert "截断" in result["projects"][0]["error"]
    assert not latest_records(lab["project"].id).filter(kind="payroll").exists()


def test_workspace_month_default_obeys_timezone_and_leap_year(laboratory):
    lab = laboratory
    with patch("plane.lab.monthly_payroll.timezone.now", return_value=utc("2028-02-29T16:10:00")):
        result = lab["client"](lab["lead"]).get(url(lab)).json()
    assert result["month"] == "2028-03"
    assert result["start"] == "2028-03-01"
    assert result["end"] == "2028-03-31"
    assert month_bounds("2028-02") == ("2028-02-01", "2028-02-29")
    assert month_bounds("2027-02") == ("2027-02-01", "2027-02-28")
    assert month_bounds("2026-04")[1] == "2026-04-30"


@pytest.mark.parametrize("month", ["2026-1", "2026-13", "0000-01", "2027-01", {}, []])
def test_invalid_or_future_month_has_no_effect(laboratory, month):
    response = monthly(laboratory, month=month)
    assert response.status_code == 400
    assert not PayrollRun.objects.exists()


def test_batch_authorization_is_all_or_nothing_for_selected_projects(laboratory):
    lab = laboratory
    hidden = Project.objects.create(workspace=lab["workspace"], name="Hidden", identifier="HID")
    ids = [str(lab["project"].id), str(hidden.id)]
    assert monthly(lab, project_ids=ids).status_code == 403
    assert enable(lab, project_ids=ids).status_code == 403
    assert not PayrollSchedule.objects.exists()
    assert not PayrollRun.objects.exists()
    assert monthly(lab, user=lab["member"]).status_code == 403
    assert enable(lab, user=lab["member"]).status_code == 403
    grant(lab, lab["member"], ["view", "approve"])
    assert enable(lab, user=lab["member"]).status_code == 200
    assert PayrollSchedule.objects.get(project=lab["project"]).authorized_by == lab["member"]
    assert monthly(lab, user=lab["member"]).status_code == 201


def test_disabled_new_schedule_and_durable_visible_results(laboratory):
    lab = laboratory
    initial = lab["client"](lab["lead"]).get(url(lab)).json()
    assert initial["projects"][0]["schedule"]["enabled"] is False
    enabled = enable(lab).json()["projects"][0]["schedule"]
    assert enabled["enabled"] is True
    assert enabled["actor_name"] == lab["lead"].display_name
    assert enabled["next_run_at"] == "2026-10-31T23:55:00+08:00"
    run_due_payrolls(utc("2026-10-31T15:55:00"))
    result = lab["client"](lab["lead"]).get(url(lab)).json()
    assert result["runs"][0]["source"] == "automatic"
    assert result["projects"][0]["schedule"]["last_status"] == "success"
    assert enable(lab, False).json()["projects"][0]["schedule"]["next_run_at"] is None
    assert run_due_payrolls(utc("2026-11-01T16:00:00")) == []


def test_schedule_month_end_cutoff_and_next_day_late_approval(laboratory):
    lab = laboratory
    assert enable(lab).status_code == 200
    original = approve(lab, cost(lab, hours="2"))
    assert run_due_payrolls(utc("2026-10-30T15:55:00")) == []
    assert run_due_payrolls(utc("2026-10-31T15:54:00")) == []
    first = run_due_payrolls(utc("2026-10-31T15:55:00"))
    assert sum(row["created_count"] for row in first) == 1
    assert run_due_payrolls(utc("2026-10-31T15:59:00")) == []
    late = approve(lab, cost(lab, date="2026-10-31", hours="1"))
    next_day = run_due_payrolls(utc("2026-10-31T16:00:00"))
    assert sum(row["created_count"] for row in next_day) == 1
    assert next_day[0]["records"][0]["data"]["cost_ids"] == [late["id"]]
    assert original["id"] not in next_day[0]["records"][0]["data"]["cost_ids"]
    assert not FinancialEntry.objects.exists()


def test_catch_up_finds_old_late_approvals_and_recovers_after_downtime(laboratory):
    lab = laboratory
    enable(lab)
    approve(lab, cost(lab, hours="1"))
    # First scheduled run was missed; December recovers October from data, not a fixed lookback.
    results = run_due_payrolls(utc("2026-12-20T16:00:00"))
    assert sum(row["created_count"] for row in results) == 1
    assert {row["month"] for row in results} == {"2026-10", "2026-11"}
    late = approve(lab, cost(lab, hours="2"))
    results = run_due_payrolls(utc("2027-04-20T16:00:00"))
    records = [record for row in results for record in row["records"]]
    assert len(records) == 1
    assert records[0]["data"]["cost_ids"] == [late["id"]]


@pytest.mark.parametrize("loss", ["inactive", "workspace", "project", "grant"])
def test_automatic_run_rechecks_authorization_and_records_failure(laboratory, loss):
    lab = laboratory
    actor = lab["member"]
    grant(lab, actor, ["view", "approve"])
    assert enable(lab, user=actor).status_code == 200
    approve(lab, cost(lab, hours="1"))
    if loss == "inactive":
        actor.is_active = False
        actor.save(update_fields=["is_active"])
    elif loss == "workspace":
        WorkspaceMember.objects.filter(workspace=lab["workspace"], member=actor).update(is_active=False)
    elif loss == "project":
        ProjectMember.objects.filter(project=lab["project"], member=actor).update(is_active=False)
    else:
        grant(lab, actor, ["view"])
    result = run_due_payrolls(utc("2026-10-31T15:55:00"))
    assert result[0]["status"] == "failed"
    assert result[0]["error"]
    assert not latest_records(lab["project"].id).filter(kind="payroll").exists()
    overview = lab["client"](lab["lead"]).get(url(lab)).json()
    assert overview["projects"][0]["schedule"]["last_status"] == "failed"


def test_concurrent_manual_and_automatic_generation_never_duplicates(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="1"))
    enable(lab)

    def generate(automatic):
        close_old_connections()
        try:
            if automatic:
                return run_due_payrolls(utc("2026-10-31T15:55:00"))
            return [generate_project_month(lab["lead"], lab["project"], "2026-10")]
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(generate, [False, True]))
    assert sum(row["created_count"] for group in values for row in group) == 1
    assert latest_records(lab["project"].id).filter(kind="payroll").count() == 1


def test_scheduler_handles_leap_day_and_non_shanghai_timezone(laboratory):
    lab = laboratory
    lab["workspace"].timezone = "America/Los_Angeles"
    lab["workspace"].save(update_fields=["timezone"])
    with patch("plane.lab.monthly_payroll.timezone.now", return_value=utc("2028-02-15T08:00:00")):
        assert enable(lab).status_code == 200
    assert run_due_payrolls(utc("2028-02-29T07:55:00")) == []  # Still Feb 28 locally.
    assert run_due_payrolls(utc("2028-03-01T07:54:00")) == []
    result = run_due_payrolls(utc("2028-03-01T07:55:00"))
    assert result[0]["month"] == "2028-02"
    assert result[0]["status"] == "success"


def test_archived_projects_are_not_generated_automatically(laboratory):
    lab = laboratory
    enable(lab)
    lab["project"].archived_at = timezone.now()
    lab["project"].save(update_fields=["archived_at"])
    result = run_due_payrolls(utc("2026-10-31T15:55:00"))
    assert result[0]["status"] == "failed"
    assert "归档" in result[0]["error"]
    assert not FinancialEntry.objects.exists()


def test_multiple_projects_have_distinct_payrolls_and_shared_batch_configuration(laboratory):
    lab = laboratory
    other = Project.objects.create(
        workspace=lab["workspace"], name="Second", identifier="SEC", project_lead=lab["lead"]
    )
    for user in (lab["lead"], lab["member"]):
        ProjectMember.objects.create(
            workspace=lab["workspace"], project=other, member=user, role=20 if user == lab["lead"] else 15
        )
    approve(lab, cost(lab, hours="1"))
    other_lab = {**lab, "project": other}
    approve(other_lab, cost(other_lab, hours="2"))
    ids = [str(lab["project"].id), str(other.id)]
    assert enable(lab, project_ids=ids).status_code == 200
    assert PayrollSchedule.objects.filter(enabled=True).count() == 2
    result = monthly(lab, project_ids=ids).json()
    assert result["created_count"] == 2
    assert result["created_amount"] == "300.30"
    assert {row["project_id"] for row in result["projects"]} == set(ids)
    assert not FinancialEntry.objects.exists()


def test_inactive_employee_is_partial_failure_without_blocking_other_employee(laboratory):
    lab = laboratory
    approve(lab, cost(lab, hours="1"))
    approve(lab, cost(lab, user=lab["reviewer"], hours="2"))
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    response = monthly(lab)
    assert response.status_code == 201, response.content
    result = response.json()["projects"][0]
    assert result["status"] == "partial"
    assert result["created_count"] == 1
    assert "不再是有效项目成员" in result["error"]
    assert result["records"][0]["data"]["user_id"] == str(lab["member"].id)


def test_monthly_respects_audited_recognized_amount(laboratory):
    lab = laboratory
    record = approve(lab, cost(lab, hours="2"))
    audit_cost(lab, record, "150.00")
    result = monthly(lab).json()
    assert result["created_amount"] == "150.00"
    assert result["projects"][0]["records"][0]["data"]["lines"][0]["amount"] == "150.00"


def test_daily_catchup_does_not_prevent_new_month_end_run(laboratory):
    lab = laboratory
    enable(lab)
    run_due_payrolls(utc("2026-10-31T15:55:00"))
    with patch("plane.lab.monthly_payroll.timezone.now", return_value=utc("2026-11-30T03:00:00")):
        morning = run_due_payrolls(utc("2026-11-30T03:00:00"))
        assert morning[0]["month"] == "2026-10"
        overview = lab["client"](lab["lead"]).get(url(lab)).json()
        assert overview["projects"][0]["schedule"]["next_run_at"] == "2026-11-30T23:55:00+08:00"
        evening = run_due_payrolls(utc("2026-11-30T15:55:00"))
        assert evening[0]["month"] == "2026-11"


def test_overdue_month_end_next_run_is_immediate_after_daily_catchup(laboratory):
    lab = laboratory
    enable(lab)
    schedule = PayrollSchedule.objects.get(project=lab["project"])
    schedule.last_month = "2026-10"
    schedule.last_run_at = utc("2026-11-30T00:00:00")
    schedule.save(update_fields=["last_month", "last_run_at"])
    assert next_run_at(schedule, lab["workspace"], utc("2026-11-30T15:56:00")) == "2026-11-30T23:56:00+08:00"


def test_paid_cash_bounty_is_not_included_in_monthly_payroll(laboratory):
    from plane.lab.finance_services import balance
    from plane.lab.models import CashBounty
    from .test_cash_bounty_workflow import action, publish
    from .test_project_receipts import project_account, received

    lab = laboratory
    received(lab, gross="20", costs="0")
    bounty_id = publish(lab)
    assert action(lab, bounty_id, "claim", lab["member"]).status_code == 200
    assert action(lab, bounty_id, "submit", lab["member"], evidence="逐项测试完成").status_code == 200
    assert action(lab, bounty_id, "accept", note="成果已核对").status_code == 200
    assert action(lab, bounty_id, "pay", payment_evidence="合成测试付款记录").status_code == 200
    bounty = CashBounty.objects.get(id=bounty_id)
    assert bounty.status == "paid" and bounty.payment_operation_id
    account = project_account(lab)
    before_balance = balance(account)
    before_operations = FinancialOperation.objects.count()
    before_entries = FinancialEntry.objects.count()
    labor = approve(lab, cost(lab, hours="1"))
    result = monthly(lab).json()
    assert result["created_count"] == 1
    assert result["created_amount"] == "100.10"
    assert result["projects"][0]["records"][0]["data"]["cost_ids"] == [labor["id"]]
    enable(lab)
    assert sum(row["created_count"] for row in run_due_payrolls(utc("2026-10-31T15:55:00"))) == 0
    bounty.refresh_from_db()
    assert bounty.status == "paid"
    assert balance(account) == before_balance
    assert FinancialOperation.objects.count() == before_operations
    assert FinancialEntry.objects.count() == before_entries


def test_celery_discovers_and_dispatches_monthly_payroll_task():
    from plane.celery import app

    app.autodiscover_tasks(force=True)
    task_name = "plane.lab.tasks.generate_due_payrolls"
    assert task_name in app.tasks
    assert app.conf.beat_schedule["lab-month-end-payroll"]["task"] == task_name
    with patch("plane.lab.monthly_payroll.run_due_payrolls", return_value=[]) as service:
        assert app.tasks[task_name].apply().get() == []
    service.assert_called_once_with()
