# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Month-end payroll drafts, with current authorization and daily late-approval catch-up."""

import calendar
import logging
import re
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember
from .auth import audit, lock
from .finance_permissions import project_finance_access, require_project_finance
from .finance_services import require_finance_open
from .management_models import latest_records
from .models import PayrollRun, PayrollSchedule
from .planning_views import LabView
from .project_management import finance_mutation, money_text, payroll_for, recognized_cost, record_data

logger = logging.getLogger(__name__)
CUTOFF = time(23, 55)


def local_now(workspace, now=None):
    return (now or timezone.now()).astimezone(ZoneInfo(workspace.timezone or "Asia/Shanghai"))


def month_bounds(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}", value):
        raise ValidationError("月份须为 YYYY-MM")
    try:
        year, month = map(int, value.split("-"))
        start = date(year, month, 1)
        end = date(year, month, calendar.monthrange(year, month)[1])
    except (ValueError, OverflowError):
        raise ValidationError("月份无效")
    return start.isoformat(), end.isoformat()


def selected_month(workspace, value=None):
    month = value if value is not None else local_now(workspace).strftime("%Y-%m")
    month_bounds(month)
    if month > local_now(workspace).strftime("%Y-%m"):
        raise ValidationError("不能生成未来月份工资单")
    return month


def due_month(now):
    if now.day == calendar.monthrange(now.year, now.month)[1] and now.time().replace(tzinfo=None) >= CUTOFF:
        return now.strftime("%Y-%m")
    return (now.date().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def next_run_at(schedule, workspace, now=None):
    if not schedule or not schedule.enabled:
        return None
    current = local_now(workspace, now)
    if due_month(current) < schedule.start_month:
        _, end = month_bounds(schedule.start_month)
        return datetime.combine(date.fromisoformat(end), CUTOFF, tzinfo=current.tzinfo).isoformat()
    if schedule.last_run_at and local_now(workspace, schedule.last_run_at).date() == current.date():
        if schedule.last_month < due_month(current):
            return current.isoformat()
        if (
            schedule.last_month < current.strftime("%Y-%m")
            and current.day == calendar.monthrange(current.year, current.month)[1]
            and current.time().replace(tzinfo=None) < CUTOFF
        ):
            return datetime.combine(current.date(), CUTOFF, tzinfo=current.tzinfo).isoformat()
        return datetime.combine(current.date() + timedelta(days=1), time.min, tzinfo=current.tzinfo).isoformat()
    return current.isoformat()


def schedule_data(schedule, workspace):
    return {
        "enabled": bool(schedule and schedule.enabled),
        "actor_name": schedule.authorized_by.display_name if schedule and schedule.authorized_by else None,
        "last_run_at": schedule.last_run_at.isoformat() if schedule and schedule.last_run_at else None,
        "last_month": schedule.last_month or None if schedule else None,
        "last_status": schedule.last_status or None if schedule else None,
        "last_error": schedule.last_error or None if schedule else None,
        "next_run_at": next_run_at(schedule, workspace),
    }


def outstanding(rows, start, end):
    """Include intersecting periods so a cross-month timesheet produces a visible error."""
    return [
        row
        for row in rows
        if row.kind == "cost"
        and row.state == "approved"
        and row.data.get("category") == "labor"
        and row.data["date"] <= end
        and row.data.get("end_date", row.data["date"]) >= start
        and not payroll_for(row, rows)
    ]


def visible_projects(user, workspace):
    projects = (
        Project.objects.filter(
            workspace=workspace,
            pk__in=ProjectMember.objects.filter(member=user, is_active=True, role__gte=15).values("project_id"),
        )
        .select_related("workspace")
        .order_by("name", "id")
    )
    return [project for project in projects if "view" in project_finance_access(user, project)[0]]


def requested_projects(user, workspace, values):
    if not isinstance(values, list) or not values or any(not isinstance(item, str) for item in values):
        raise ValidationError("请选择项目")
    try:
        ids = {uuid.UUID(value) for value in values}
    except (ValueError, TypeError):
        raise ValidationError("项目ID无效")
    projects = list(Project.objects.filter(workspace=workspace, id__in=ids).select_related("workspace").order_by("id"))
    if len(projects) != len(ids):
        raise PermissionDenied("项目不可访问")
    for project in projects:
        require_project_finance(user, project, "approve")
    return projects


def run_data(run):
    return {
        "id": str(run.id),
        "project_id": str(run.project_id_snapshot),
        "month": run.month,
        "source": run.source,
        "status": run.status,
        "created_count": run.created_count,
        "created_amount": money_text(Decimal(run.created_amount)),
        "error": run.error,
        "created_at": run.created_at.isoformat(),
    }


def monthly_overview(user, workspace, month=None):
    month = selected_month(workspace, month)
    start, end = month_bounds(month)
    projects = visible_projects(user, workspace)
    schedules = {
        row.project_id: row
        for row in PayrollSchedule.objects.filter(project__in=projects).select_related("authorized_by")
    }
    values = []
    for project in projects:
        rows = list(latest_records(project.id))
        costs = outstanding(rows, start, end)
        can_generate = "approve" in project_finance_access(user, project)[0] and not project.archived_at
        values.append(
            {
                "project_id": str(project.id),
                "project_name": project.name,
                "can_generate": bool(can_generate),
                "can_manage_schedule": "approve" in project_finance_access(user, project)[0],
                "schedule": schedule_data(schedules.get(project.id), workspace),
                "eligible_count": len(costs),
                "eligible_people": len({row.data["user_id"] for row in costs}),
                "eligible_amount": money_text(sum((recognized_cost(row, rows) for row in costs), Decimal("0"))),
            }
        )
    return {
        "month": month,
        "current_month": local_now(workspace).strftime("%Y-%m"),
        "start": start,
        "end": end,
        "timezone": workspace.timezone or "Asia/Shanghai",
        "time": "23:55",
        "projects": values,
        "runs": [
            run_data(row) for row in PayrollRun.objects.filter(project__in=projects).order_by("-created_at", "-id")[:50]
        ],
    }


def error_text(exc):
    if isinstance(exc, Http404):
        return "工资成员不再是有效项目成员"
    detail = getattr(exc, "detail", None)
    if isinstance(detail, list):
        return "；".join(str(value) for value in detail)
    return str(detail or exc)


@transaction.atomic
def generate_project_month(user, project, month, source="manual"):
    lock(f"finance:{project.workspace_id}")
    project = (
        Project.objects.select_for_update(of=("self",), no_key=True).select_related("workspace").get(id=project.id)
    )
    require_project_finance(user, project, "approve")
    require_finance_open(project.workspace, project.id)
    if project.archived_at:
        raise ValidationError("归档项目不能生成工资单")
    start, end = month_bounds(month)
    rows = list(latest_records(project.id))
    costs = outstanding(rows, start, end)
    employees = sorted({row.data["user_id"] for row in costs})
    created, errors = [], []
    for user_id in employees:
        try:
            # The existing business operation checks employee membership, recognized
            # costs, complete periods and pending payroll inclusion under the same lock.
            row = finance_mutation(
                user,
                project,
                {
                    "kind": "payroll",
                    "action": "save",
                    "record_id": str(uuid.uuid4()),
                    "expected_version": 0,
                    "request_key": str(uuid.uuid4()),
                    "reason": f"{'月末自动' if source == 'automatic' else '按月批量'}生成 {month} 工资单",
                    "data": {"user_id": user_id, "start": start, "end": end},
                },
            )
            created.append(row)
        except (APIException, Http404) as exc:
            name = next((row.data.get("user_name") for row in costs if row.data["user_id"] == user_id), None)
            errors.append(f"{name or user_id}：{error_text(exc)}")
    total = sum((Decimal(row.data["amount"]) for row in created), Decimal("0"))
    run = PayrollRun.objects.create(
        workspace=project.workspace,
        project=project,
        project_id_snapshot=project.id,
        month=month,
        source=source,
        actor=user,
        status="partial" if errors and created else "failed" if errors else "success",
        created_count=len(created),
        created_amount=total,
        record_ids=[str(row.object_key) for row in created],
        error="；".join(errors),
    )
    audit(
        "payroll.monthly",
        run,
        user,
        project.workspace,
        month=month,
        source=source,
        created_count=len(created),
        status=run.status,
    )
    return {**run_data(run), "records": [record_data(row) for row in created]}


def failed_run(project, user, month, source, exc):
    run = PayrollRun.objects.create(
        workspace=project.workspace,
        project=project,
        project_id_snapshot=project.id,
        month=month,
        source=source,
        actor=user,
        status="failed",
        error=error_text(exc),
    )
    return {**run_data(run), "records": []}


@transaction.atomic
def configure_schedules(user, workspace, project_ids, enabled):
    if type(enabled) is not bool:
        raise ValidationError("启用状态须为布尔值")
    lock(f"finance:{workspace.id}")
    projects = requested_projects(user, workspace, project_ids)
    for project in projects:
        if enabled:
            require_finance_open(workspace, project.id)
            if project.archived_at:
                raise ValidationError("归档项目不能启用工资计划")
        schedule, _ = PayrollSchedule.objects.select_for_update().get_or_create(
            project=project,
            defaults={"workspace": workspace, "start_month": local_now(workspace).strftime("%Y-%m")},
        )
        schedule.enabled = enabled
        schedule.authorized_by = user
        schedule.save(update_fields=["enabled", "authorized_by"])
        audit("payroll.schedule", schedule, user, workspace, project_id=str(project.id), enabled=enabled)


class MonthlyPayrollView(LabView):
    def get(self, request, slug):
        return Response(monthly_overview(request.user, self.workspace, request.query_params.get("month")))

    def post(self, request, slug):
        if not isinstance(request.data, dict):
            raise ValidationError("请求须为对象")
        month = selected_month(self.workspace, request.data.get("month"))
        projects = requested_projects(request.user, self.workspace, request.data.get("project_ids"))
        results = []
        for project in projects:
            try:
                results.append(generate_project_month(request.user, project, month))
            except APIException as exc:
                results.append(failed_run(project, request.user, month, "manual", exc))
        return Response(
            {
                "month": month,
                "projects": results,
                "created_count": sum(row["created_count"] for row in results),
                "created_amount": money_text(sum((Decimal(row["created_amount"]) for row in results), Decimal("0"))),
            },
            status=201,
        )

    def patch(self, request, slug):
        if not isinstance(request.data, dict):
            raise ValidationError("请求须为对象")
        configure_schedules(request.user, self.workspace, request.data.get("project_ids"), request.data.get("enabled"))
        return Response(monthly_overview(request.user, self.workspace, request.query_params.get("month")))


def catchup_months(project, first_month, last_month):
    months = {last_month}
    rows = list(latest_records(project.id))
    for row in rows:
        if (
            row.kind != "cost"
            or row.state != "approved"
            or row.data.get("category") != "labor"
            or payroll_for(row, rows)
        ):
            continue
        start_month = row.data["date"][:7]
        end_month = row.data.get("end_date", row.data["date"])[:7]
        # Cross-month periods are reported at their end month; the payroll business
        # operation rejects cutting them, so nothing is silently apportioned.
        if end_month >= first_month and start_month <= last_month:
            months.add(min(max(end_month, first_month), last_month))
    return sorted(months)


@transaction.atomic
def run_schedule(schedule_id, now):
    snapshot = PayrollSchedule.objects.select_related("workspace", "project").filter(id=schedule_id).first()
    if not snapshot:
        return []
    lock(f"finance:{snapshot.workspace_id}")
    schedule = (
        PayrollSchedule.objects.select_for_update(of=("self",))
        .select_related("workspace", "project", "authorized_by")
        .get(id=schedule_id)
    )
    if not schedule.enabled:
        return []
    current = local_now(schedule.workspace, now)
    target = due_month(current)
    if target < schedule.start_month:
        return []
    if (
        schedule.last_run_at
        and local_now(schedule.workspace, schedule.last_run_at).date() == current.date()
        and schedule.last_month == target
    ):
        return []
    actor, project = schedule.authorized_by, schedule.project
    results = []
    try:
        if not actor or not actor.is_active:
            raise PermissionDenied("工资计划授权人已停用，请重新授权")
        require_project_finance(actor, project, "approve")
        for month in catchup_months(project, schedule.start_month, target):
            results.append(generate_project_month(actor, project, month, "automatic"))
    except APIException as exc:
        results.append(failed_run(project, actor, target, "automatic", exc))
    except Exception:
        # Avoid persisting internal exception text; the authorized UI gets a concise
        # actionable failure and the worker retains the server-side traceback.
        logger.exception("Monthly payroll failed for schedule %s", schedule.id)
        results.append(
            failed_run(project, actor, target, "automatic", ValidationError("生成失败，请检查服务日志后重试"))
        )
    errors = [row["error"] for row in results if row["error"]]
    count = sum(row["created_count"] for row in results)
    schedule.last_run_at = now
    schedule.last_month = target
    schedule.last_status = "partial" if errors and count else "failed" if errors else "success"
    schedule.last_error = "；".join(errors)
    schedule.save(update_fields=["last_run_at", "last_month", "last_status", "last_error"])
    return results


def run_due_payrolls(now=None):
    now = now or timezone.now()
    results = []
    for schedule_id in PayrollSchedule.objects.filter(enabled=True).values_list("id", flat=True).iterator():
        try:
            results.extend(run_schedule(schedule_id, now))
        except Exception:
            # One broken workspace must not prevent other workspaces from running.
            logger.exception("Could not record monthly payroll run for schedule %s", schedule_id)
    return results
