# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Personal VC facts, independent of permission to read their execution sources."""

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from django.core import signing
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from plane.db.models import Issue, Project

from .bounty_models import BountyTaskAccess
from .models import Allocation, Ledger
from .permissions import project_ids, readable_issues
from .planning_views import LabView

TIMEZONE = "Asia/Shanghai"
SHANGHAI = ZoneInfo(TIMEZONE)
ZERO = Decimal("0.00")
CURSOR_SALT = "lab.personal-contributions.v1"
PAGE_SIZE = 50


def validate_self(request):
    if "user_id" in request.query_params:
        raise ValidationError("本页仅支持读取自己的参与项目和VC")


def personal_ledger(user, workspace):
    # Old imports sometimes omitted the participant UUID. Never override a UUID
    # present in the immutable snapshot with the allocation's live user relation.
    missing_owner = (
        ~Q(participant_snapshot__has_key="id") | Q(participant_snapshot__id=None) | Q(participant_snapshot__id="")
    )
    return Ledger.objects.filter(bounty__stage__workspace_id_snapshot=workspace.id).filter(
        Q(participant_snapshot__id=str(user.id)) | (missing_owner & Q(allocation__user_id_snapshot=user.id))
    )


def amounts(earned=ZERO, reversed=ZERO):
    earned, reversed = earned or ZERO, reversed or ZERO
    return {
        "earned": format(earned, ".2f"),
        "reversed": format(reversed, ".2f"),
        "net": format(earned - reversed, ".2f"),
    }


def ledger_sums():
    return {
        "earned": Sum("delta", filter=Q(reverses__isnull=True)),
        "reversed": Sum("delta", filter=Q(reverses__isnull=False)),
    }


def native_issue_ids(user, workspace, issue_ids):
    return set(
        readable_issues(user, workspace)
        .filter(id__in=issue_ids, deleted_at__isnull=True, is_draft=False)
        .values_list("id", flat=True)
    )


def execution_source_available(bounty):
    return bool(
        bounty.status != "deleted" and bounty.issue_id and not bounty.issue.deleted_at and not bounty.issue.is_draft
    )


def granted_bounty_ids(user, bounties, readable):
    viable = {row.id: row for row in bounties if execution_source_available(row)}
    grants = BountyTaskAccess.objects.filter(
        allocation__bounty_id__in=viable,
        allocation__user=user,
        allocation__approved=True,
        revoked_at__isnull=True,
    ).values_list("allocation__bounty_id", "requires_project_membership")
    return {
        bounty_id
        for bounty_id, requires_member in grants
        if not requires_member or viable[bounty_id].issue_id in readable
    }


def personal_projects(user, workspace, ledger):
    current = {row.id: row for row in Project.objects.filter(workspace=workspace, id__in=project_ids(user, workspace))}
    allocations = list(
        Allocation.objects.filter(
            bounty__stage__workspace_id_snapshot=workspace.id,
            user_id_snapshot=user.id,
            approved=True,
            confirmed=True,
        )
        .select_related("bounty__stage", "bounty__issue")
        .order_by("-created_at", "-id")
    )
    readable = native_issue_ids(user, workspace, [row.bounty.issue_id for row in allocations if row.bounty.issue_id])
    grants = granted_bounty_ids(user, [row.bounty for row in allocations], readable)
    projects = {}

    def add(project_id, name, source):
        row = projects.setdefault(
            project_id,
            {"name": name, "sources": set(), "earned": ZERO, "reversed": ZERO, "current": project_id in current},
        )
        row["sources"].add(source)
        return row

    for project in current.values():
        add(project.id, project.name, "project")
    for allocation in allocations:
        bounty = allocation.bounty
        row = add(bounty.stage.project_id_snapshot, bounty.stage.project_name, "bounty")
        row["current"] = row["current"] or bounty.id in grants
    groups = (
        ledger.values("bounty__stage__project_id_snapshot", "bounty__stage__project_name")
        .annotate(**ledger_sums(), latest=Max("created_at"))
        .order_by("-latest", "bounty__stage__project_id_snapshot", "bounty__stage__project_name")
    )
    for group in groups:
        row = add(group["bounty__stage__project_id_snapshot"], group["bounty__stage__project_name"], "history")
        row["earned"] += group["earned"] or ZERO
        row["reversed"] -= group["reversed"] or ZERO
    return [
        {
            "id": str(project_id),
            "name": row["name"],
            **amounts(row["earned"], row["reversed"]),
            "participation": [source for source in ("project", "bounty", "history") if source in row["sources"]],
            "historical": not row["current"],
            "can_open_project": project_id in current,
        }
        for project_id, row in sorted(projects.items(), key=lambda item: (item[1]["name"], str(item[0])))
    ]


class ContributionsView(LabView):
    def get(self, request, slug):
        validate_self(request)
        projects = personal_projects(request.user, self.workspace, personal_ledger(request.user, self.workspace))
        return Response(
            {
                "timezone": TIMEZONE,
                "totals": amounts(
                    sum((Decimal(row["earned"]) for row in projects), ZERO),
                    sum((Decimal(row["reversed"]) for row in projects), ZERO),
                ),
                "projects": projects,
            }
        )


def period_ledger(request, workspace):
    validate_self(request)
    month = request.query_params.get("month")
    if month is None:
        month = timezone.now().astimezone(SHANGHAI).strftime("%Y-%m")
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        raise ValidationError("月份须为YYYY-MM")
    year, number = (int(value) for value in month.split("-"))
    try:
        start = datetime(year, number, 1, tzinfo=SHANGHAI)
        end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=SHANGHAI)
    except ValueError:
        raise ValidationError("月份超出支持范围")
    ledger = personal_ledger(request.user, workspace)
    project_id = request.query_params.get("project_id")
    if project_id is not None:
        try:
            project_id = UUID(project_id)
        except ValueError:
            raise ValidationError("项目ID格式无效")
        member = Project.objects.filter(workspace=workspace, id=project_id, id__in=project_ids(request.user, workspace))
        allocation = Allocation.objects.filter(
            bounty__stage__workspace_id_snapshot=workspace.id,
            bounty__stage__project_id_snapshot=project_id,
            user_id_snapshot=request.user.id,
            approved=True,
            confirmed=True,
        )
        if not (
            member.exists()
            or allocation.exists()
            or ledger.filter(bounty__stage__project_id_snapshot=project_id).exists()
        ):
            raise NotFound("项目不属于本人参与记录")
        ledger = ledger.filter(bounty__stage__project_id_snapshot=project_id)
    return month, ledger.filter(created_at__gte=start, created_at__lt=end), project_id


class ContributionsCalendarView(LabView):
    def get(self, request, slug):
        month, ledger, _ = period_ledger(request, self.workspace)
        groups = (
            ledger.annotate(day=TruncDate("created_at", tzinfo=SHANGHAI))
            .values("day", "bounty__stage__project_id_snapshot")
            .annotate(**ledger_sums(), project=Max("bounty__stage__project_name"), count=Count("id"))
            .order_by("day", "bounty__stage__project_id_snapshot")
        )
        days = [
            {
                "day": row["day"].isoformat(),
                "project_id": str(row["bounty__stage__project_id_snapshot"]),
                "project": row["project"],
                **amounts(row["earned"], -(row["reversed"] or ZERO)),
                "count": row["count"],
            }
            for row in groups
        ]
        return Response(
            {
                "timezone": TIMEZONE,
                "month": month,
                "totals": amounts(
                    sum((Decimal(row["earned"]) for row in days), ZERO),
                    sum((Decimal(row["reversed"]) for row in days), ZERO),
                ),
                "days": days,
            }
        )


def entries_day(request, month):
    value = request.query_params.get("day")
    if value is None:
        return None
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValidationError("日期须为YYYY-MM-DD")
    try:
        result = date.fromisoformat(value)
    except ValueError:
        raise ValidationError("日期无效")
    if value[:7] != month:
        raise ValidationError("日期须属于所选月份")
    return result


def cursor_position(value, scope):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT)
        if not isinstance(payload, dict) or payload.get("scope") != scope:
            raise ValueError
        instant = datetime.fromisoformat(payload["created_at"])
        entry_id = UUID(payload["id"])
        if timezone.is_naive(instant):
            raise ValueError
    except (signing.BadSignature, ValueError, TypeError, KeyError):
        raise ValidationError("分页游标无效，请重新读取明细")
    return instant, entry_id


def snapshot_text(snapshot, key, fallback):
    value = snapshot.get(key) if isinstance(snapshot, dict) else None
    return value if isinstance(value, str) and value else fallback


class ContributionsEntriesView(LabView):
    def get(self, request, slug):
        month, ledger, project_id = period_ledger(request, self.workspace)
        day = entries_day(request, month)
        if day:
            start = datetime.combine(day, datetime.min.time(), tzinfo=SHANGHAI)
            ledger = ledger.filter(created_at__gte=start, created_at__lt=start + timedelta(days=1))
        scope = {
            "workspace": str(self.workspace.id),
            "user": str(request.user.id),
            "month": month,
            "day": day.isoformat() if day else None,
            "project_id": str(project_id) if project_id else None,
        }
        cursor = request.query_params.get("cursor")
        if cursor is not None:
            instant, entry_id = cursor_position(cursor, scope)
            ledger = ledger.filter(Q(created_at__lt=instant) | Q(created_at=instant, id__lt=entry_id))
        rows = list(
            ledger.select_related("bounty__stage", "bounty__issue").order_by("-created_at", "-id")[: PAGE_SIZE + 1]
        )
        page = rows[:PAGE_SIZE]
        next_cursor = None
        if len(rows) > PAGE_SIZE:
            last = page[-1]
            next_cursor = signing.dumps(
                {"scope": scope, "created_at": last.created_at.isoformat(), "id": str(last.id)}, salt=CURSOR_SALT
            )
        issue_ids = {row.bounty.issue_id_snapshot for row in page}
        issues = {
            row.id: row
            for row in Issue.objects.filter(workspace=self.workspace, id__in=issue_ids, deleted_at__isnull=True)
        }
        readable = native_issue_ids(request.user, self.workspace, issue_ids)
        grants = granted_bounty_ids(request.user, [row.bounty for row in page], readable)
        results = []
        for row in page:
            bounty = row.bounty
            issue = issues.get(bounty.issue_id_snapshot)
            execution = execution_source_available(bounty) and (bounty.issue_id in readable or bounty.id in grants)
            results.append(
                {
                    "id": str(row.id),
                    "created_at": row.created_at.isoformat(),
                    "day": row.created_at.astimezone(SHANGHAI).date().isoformat(),
                    "project_id": str(bounty.stage.project_id_snapshot),
                    "project": snapshot_text(row.task_snapshot, "project", bounty.stage.project_name),
                    "task_id": str(bounty.issue_id_snapshot),
                    "task_title": snapshot_text(row.task_snapshot, "title", bounty.title),
                    "bounty_id": str(bounty.id),
                    "delta": format(row.delta, ".2f"),
                    "kind": "reversal" if row.reverses_id else "award",
                    "reverses": str(row.reverses_id) if row.reverses_id else None,
                    "archived": bool(issue and issue.archived_at),
                    "can_open_issue": bounty.issue_id_snapshot in readable,
                    "can_open_bounty": bool(execution),
                }
            )
        return Response({"timezone": TIMEZONE, "results": results, "next_cursor": next_cursor})
