# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Permission-scoped statistics and the same records behind chart drilldowns."""

import csv
import uuid
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal
from io import StringIO
from zoneinfo import ZoneInfo

from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, WorkspaceMember
from .export import csv_cell
from .models import Bounty, ProjectFlow, Stage
from .permissions import can_view_team, collaboration_projects, project_ids, readable_issues
from .planning import calendar_events
from .planning_views import LabView

SHANGHAI = ZoneInfo("Asia/Shanghai")
STATUS_LABELS = {"todo": "待做", "active": "进行中", "review": "待验收", "done": "完成", "cancelled": "取消"}
KIND_LABELS = {"project": "项目任务", "research": "科研", "study": "学习", "mentoring": "带教", "busy": "忙碌"}
DETAIL_COLUMNS = [
    {"key": key, "label": label}
    for key, label in (
        ("title", "名称"),
        ("project", "项目"),
        ("person", "人员"),
        ("start", "开始"),
        ("end", "结束"),
        ("status", "状态"),
        ("value", "数量"),
    )
]


def query_scope(view, request):
    today = timezone.now().astimezone(SHANGHAI).date()
    try:
        start = (
            parse_date(request.query_params["start"]) if "start" in request.query_params else today - timedelta(days=29)
        )
        end = parse_date(request.query_params["end"]) if "end" in request.query_params else today + timedelta(days=1)
        if not start or not end or not timedelta(0) < end - start <= timedelta(days=366):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValidationError("请选择有效日期范围，结束晚于开始且不超过一年")
    team = request.query_params.get("team", "1" if can_view_team(request.user, view.membership) else "0") == "1"
    if team and not can_view_team(request.user, view.membership):
        raise PermissionDenied("仅负责人可以查看团队排期统计")
    selected = {}
    for key in ("project_id", "user_id"):
        raw = request.query_params.get(key)
        try:
            selected[key] = uuid.UUID(raw) if raw else None
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("筛选 ID 无效")
    allowed = set(project_ids(request.user, view.workspace))
    if selected["project_id"] and selected["project_id"] not in allowed:
        raise NotFound("项目不可访问")
    if selected["user_id"] and not team and selected["user_id"] != request.user.id:
        raise PermissionDenied("只能查看本人排期")
    if (
        selected["user_id"]
        and not WorkspaceMember.objects.filter(
            workspace=view.workspace, member_id=selected["user_id"], is_active=True, member__is_active=True
        ).exists()
    ):
        raise NotFound("人员不可访问")
    return {"start": start, "end": end, "team": team, **selected}


def chart(chart_id, domain, title, kind, unit, series, columns, note=""):
    return {
        "id": chart_id,
        "domain": domain,
        "title": title,
        "kind": kind,
        "unit": unit,
        "series": [{"key": key, "label": label} for key, label in series],
        "columns": [{"key": key, "label": label} for key, label in columns],
        "rows": [],
        "note": note,
    }


class ChartData:
    def __init__(self):
        self.charts = []
        self.details = defaultdict(lambda: defaultdict(list))

    def add(self, entry):
        self.charts.append(entry)
        return entry

    def record(self, chart_id, key, row):
        self.details[chart_id][str(key)].append(row)


def task_record(issue, slug, value=1):
    return {
        "title": issue.name,
        "project": issue.project.name,
        "person": "",
        "start": str(issue.start_date or ""),
        "end": str(issue.target_date or ""),
        "status": issue.state.name if issue.state else "",
        "value": value,
        "url": f"/{slug}/projects/{issue.project_id}/issues/{issue.id}",
    }


def project_charts(data, user, workspace, scope):
    issues = (
        readable_issues(user, workspace)
        .filter(is_draft=False, archived_at__isnull=True)
        .select_related("project", "state")
    )
    if scope["project_id"]:
        issues = issues.filter(project_id=scope["project_id"])
    projects = Project.objects.filter(workspace=workspace, id__in=project_ids(user, workspace)).order_by("name", "id")
    if scope["project_id"]:
        projects = projects.filter(id=scope["project_id"])
    review_ids = set(ProjectFlow.objects.filter(project__in=projects).values_list("review_id", flat=True))
    state_chart = data.add(
        chart(
            "project-status",
            "project",
            "任务状态分布",
            "donut",
            "项",
            [("count", "任务")],
            [("label", "状态"), ("count", "任务数")],
            "当前可访问的未归档任务",
        )
    )
    progress = data.add(
        chart(
            "project-completion",
            "project",
            "项目完成率",
            "bar",
            "%",
            [("percentage", "完成率")],
            [("label", "项目"), ("completed", "已完成"), ("total", "任务数"), ("percentage", "完成率 %")],
            "取消任务不计入完成率",
        )
    )
    trend = data.add(
        chart(
            "project-trend",
            "project",
            "新增与完成日期趋势",
            "line",
            "项",
            [("created", "新增"), ("completed", "当前已完成")],
            [("label", "日期"), ("created", "新增"), ("completed", "当前已完成")],
            "完成日期取当前已完成任务的记录；重新打开后不再计入",
        )
    )
    overdue = data.add(
        chart(
            "project-overdue",
            "project",
            "逾期任务分布",
            "bar",
            "项",
            [("count", "任务")],
            [("label", "逾期天数"), ("count", "任务数")],
            "按上海当前日期计算，不含完成和取消任务",
        )
    )
    counts = Counter()
    per_project = defaultdict(Counter)
    days = {
        str(scope["start"] + timedelta(days=index)): {
            "id": str(scope["start"] + timedelta(days=index)),
            "label": str(scope["start"] + timedelta(days=index)),
            "created": 0,
            "completed": 0,
        }
        for index in range((scope["end"] - scope["start"]).days)
    }
    buckets = Counter()
    today = timezone.now().astimezone(SHANGHAI).date()
    for issue in issues:
        group = issue.state.group if issue.state else "unstarted"
        status = (
            "cancelled"
            if group == "cancelled"
            else "done"
            if group == "completed"
            else "review"
            if issue.state_id in review_ids
            else "active"
            if group == "started"
            else "todo"
        )
        counts[status] += 1
        if status != "cancelled":
            per_project[issue.project_id]["total"] += 1
            per_project[issue.project_id]["completed"] += int(status == "done")
        record = task_record(issue, workspace.slug)
        data.record("project-status", status, record)
        data.record("project-completion", issue.project_id, record)
        for field, timestamp in (("created", issue.created_at), ("completed", issue.completed_at)):
            if not timestamp or (field == "completed" and status != "done"):
                continue
            day = str(timestamp.astimezone(SHANGHAI).date())
            if day in days:
                days[day][field] += 1
                data.record("project-trend", day, {**record, "status": "新增" if field == "created" else "完成"})
        if issue.target_date and issue.target_date < today and status not in ("done", "cancelled"):
            late = (today - issue.target_date).days
            bucket = "1-3" if late <= 3 else "4-7" if late <= 7 else "8-14" if late <= 14 else "15+"
            buckets[bucket] += 1
            data.record("project-overdue", bucket, {**record, "value": late})
    state_chart["rows"] = [
        {"id": key, "label": label, "count": counts[key]} for key, label in STATUS_LABELS.items() if counts[key]
    ]
    progress["rows"] = [
        {
            "id": str(project.id),
            "label": project.name,
            "completed": per_project[project.id]["completed"],
            "total": per_project[project.id]["total"],
            "percentage": round(100 * per_project[project.id]["completed"] / per_project[project.id]["total"], 2)
            if per_project[project.id]["total"]
            else 0,
        }
        for project in projects
    ]
    trend["rows"] = list(days.values())
    overdue["rows"] = [
        {"id": key, "label": label, "count": buckets[key]}
        for key, label in (("1-3", "1–3 天"), ("4-7", "4–7 天"), ("8-14", "8–14 天"), ("15+", "15 天以上"))
        if buckets[key]
    ]


def merged_seconds(intervals):
    end = None
    seconds = 0
    for start, following in sorted(intervals):
        if end is None or start >= end:
            seconds += (following - start).total_seconds()
        elif following > end:
            seconds += (following - end).total_seconds()
        end = max(end, following) if end else following
    return seconds


def schedule_charts(data, user, workspace, scope):
    start = datetime.combine(scope["start"], time.min, SHANGHAI)
    end = datetime.combine(scope["end"], time.min, SHANGHAI)
    calendar = calendar_events(
        user, workspace, start, end, team=scope["team"], user_id=scope["user_id"], project_id=scope["project_id"]
    )
    members = {member["id"]: member["name"] for member in calendar["members"]}
    totals, kinds = Counter(), Counter()
    intervals = defaultdict(list)
    hour_chart = data.add(
        chart(
            "schedule-hours",
            "schedule",
            "成员每周计划时数",
            "bar",
            "小时",
            [("hours", "计划投入")],
            [("person", "人员"), ("week", "周起始"), ("hours", "计划小时")],
            "上海时间周一开周，边界周仅统计所选日期；包含重叠时间块",
        )
    )
    heat = data.add(
        chart(
            "schedule-heatmap",
            "schedule",
            "每日排期热力图",
            "heatmap",
            "小时",
            [("hours", "计划投入")],
            [("person", "人员"), ("day", "日期"), ("hours", "计划小时")],
        )
    )
    kind_chart = data.add(
        chart(
            "schedule-kinds",
            "schedule",
            "事项类别占比",
            "donut",
            "小时",
            [("hours", "计划投入")],
            [("label", "类别"), ("hours", "计划小时")],
            "隐藏事项统一计入忙碌",
        )
    )
    overlap = data.add(
        chart(
            "schedule-overlap",
            "schedule",
            "重叠时间分布",
            "bar",
            "小时",
            [("busy_hours", "忙碌时长"), ("overlap_hours", "重复排期时长")],
            [("label", "日期"), ("busy_hours", "忙碌小时"), ("overlap_hours", "重复排期小时")],
            "重复排期 = 时间块累计时长 − 合并后的忙碌时长",
        )
    )
    for event in calendar["events"]:
        left, right = max(start, parse_datetime(event["start"])), min(end, parse_datetime(event["end"]))
        if right <= left:
            continue
        person = members.get(event["user_id"], "成员")
        kind = event.get("kind", "busy")
        seconds = (right - left).total_seconds()
        kinds[kind] += seconds
        record = {
            "title": event["title"],
            "person": person,
            "project": "",
            "start": left.isoformat(),
            "end": right.isoformat(),
            "status": STATUS_LABELS.get(event.get("status"), "忙碌"),
            "value": round(seconds / 3600, 4),
            "url": None,
        }
        if event.get("issue_id"):
            record["url"] = f"/{workspace.slug}/projects/{event['project_id']}/issues/{event['issue_id']}"
        elif event.get("item_id") and event["editable"]:
            record["url"] = f"/{workspace.slug}/lab/planner"
        data.record("schedule-kinds", kind, record)
        cursor = left.astimezone(SHANGHAI)
        while cursor < right:
            boundary = datetime.combine(cursor.date() + timedelta(days=1), time.min, SHANGHAI)
            following = min(boundary, right)
            day = str(cursor.date())
            intervals[(event["user_id"], day)].append((cursor, following))
            clipped = {
                **record,
                "start": cursor.isoformat(),
                "end": following.isoformat(),
                "value": round((following - cursor).total_seconds() / 3600, 4),
            }
            week = str(cursor.date() - timedelta(days=cursor.weekday()))
            totals[(event["user_id"], week)] += (following - cursor).total_seconds()
            data.record("schedule-hours", f"{event['user_id']}:{week}", clipped)
            data.record("schedule-heatmap", f"{event['user_id']}:{day}", clipped)
            data.record("schedule-overlap", day, clipped)
            cursor = following
    hour_chart["rows"] = [
        {
            "id": f"{member_id}:{week}",
            "user_id": member_id,
            "week": week,
            "person": members.get(member_id, "成员"),
            "label": f"{members.get(member_id, '成员')} · {week[5:]}",
            "hours": round(seconds / 3600, 4),
        }
        for (member_id, week), seconds in sorted(
            totals.items(), key=lambda row: (row[0][1], members.get(row[0][0], ""), row[0][0])
        )
    ]
    heat["days"] = [
        str(scope["start"] + timedelta(days=index)) for index in range((scope["end"] - scope["start"]).days)
    ]
    heat["members"] = [
        {"id": key, "name": name}
        for key, name in members.items()
        if not scope["user_id"] or str(scope["user_id"]) == key
    ]
    heat["rows"] = [
        {
            "id": f"{member_id}:{day}",
            "label": f"{members.get(member_id, '成员')} · {day}",
            "person": members.get(member_id, "成员"),
            "user_id": member_id,
            "day": day,
            "hours": round(sum((right - left).total_seconds() for left, right in ranges) / 3600, 4),
        }
        for (member_id, day), ranges in intervals.items()
    ]
    kind_chart["rows"] = [
        {"id": key, "label": KIND_LABELS.get(key, key), "hours": round(seconds / 3600, 4)}
        for key, seconds in kinds.items()
    ]
    by_day = defaultdict(Counter)
    for (_, day), ranges in intervals.items():
        accumulated = sum((right - left).total_seconds() for left, right in ranges)
        merged = merged_seconds(ranges)
        by_day[day]["busy"] += merged
        by_day[day]["overlap"] += accumulated - merged
    overlap["rows"] = [
        {
            "id": day,
            "label": day,
            "busy_hours": round(totals["busy"] / 3600, 4),
            "overlap_hours": round(totals["overlap"] / 3600, 4),
        }
        for day, totals in sorted(by_day.items())
    ]
    return calendar["members"]


def contribution_charts(data, user, workspace, scope):
    budget = data.add(
        chart(
            "vc-budget",
            "vc",
            "阶段预算占用",
            "stack",
            "VC",
            [("available", "未占用"), ("reserved", "占用未授予"), ("awarded", "已授予净额")],
            [
                ("label", "阶段"),
                ("budget", "预算 B"),
                ("available", "未占用"),
                ("reserved", "占用未授予"),
                ("awarded", "已授予净额"),
            ],
            "项目当前预算，不受日期和人员筛选影响",
        )
    )
    participants = data.add(
        chart(
            "vc-participants",
            "vc",
            "项目成员计划与实际贡献",
            "bar",
            "VC",
            [("planned", "批准的计划 VC"), ("awarded", "实际净 VC")],
            [("label", "参与者"), ("planned", "计划 VC"), ("awarded", "实际净 VC")],
            "请先选择项目；当前累计值，不受日期筛选影响",
        )
    )
    trend = data.add(
        chart(
            "vc-trend",
            "vc",
            "授予与冲正趋势",
            "line",
            "VC",
            [("awarded", "授予"), ("reversed", "冲正")],
            [("label", "周起始"), ("awarded", "授予"), ("reversed", "冲正")],
            "选择项目查看所选期间的贡献变化",
        )
    )
    outcomes = data.add(
        chart(
            "vc-acceptance",
            "vc",
            "验收结果分布",
            "donut",
            "次",
            [("count", "验收")],
            [("label", "结果"), ("count", "验收次数")],
            "选择项目；仅统计所选期间已经正式批准的验收",
        )
    )
    allowed = collaboration_projects(user, workspace)
    stages = Stage.objects.filter(workspace_id_snapshot=workspace.id, project_id_snapshot__in=allowed).order_by(
        "created_at", "id"
    )
    if scope["project_id"]:
        stages = stages.filter(project_id_snapshot=scope["project_id"])
    stages = list(stages)
    bounties = (
        Bounty.objects.filter(stage__in=stages)
        .select_related("stage", "issue")
        .prefetch_related("allocations", "ledger", "acceptances")
    )
    by_stage, people, weeks, counts = defaultdict(Counter), {}, {}, Counter()
    week = scope["start"] - timedelta(days=scope["start"].weekday())
    while week < scope["end"]:
        weeks[str(week)] = {"id": str(week), "label": str(week), "awarded": Decimal(0), "reversed": Decimal(0)}
        week += timedelta(days=7)
    for bounty in bounties:
        entries = list(bounty.ledger.all())
        net = sum((entry.delta for entry in entries), Decimal(0))
        by_stage[bounty.stage_id]["reserved"] += bounty.reserved
        by_stage[bounty.stage_id]["awarded"] += net
        url = (
            f"/{workspace.slug}/projects/{bounty.stage.project_id_snapshot}/issues/{bounty.issue_id}"
            if bounty.issue_id and not bounty.issue.deleted_at
            else None
        )
        base = {
            "title": bounty.title,
            "project": bounty.stage.project_name,
            "person": "",
            "start": "",
            "end": "",
            "status": bounty.status,
            "value": float(bounty.reserved),
            "url": url,
        }
        data.record("vc-budget", bounty.stage_id, base)
        if not scope["project_id"]:
            continue
        for allocation in bounty.allocations.all():
            if not allocation.approved or (scope["user_id"] and scope["user_id"] != allocation.user_id_snapshot):
                continue
            key = str(allocation.user_id_snapshot)
            row = people.setdefault(
                key, {"id": key, "label": allocation.user_name, "planned": Decimal(0), "awarded": Decimal(0)}
            )
            row["planned"] += allocation.planned
            allocation_entries = [entry for entry in entries if entry.allocation_id == allocation.id]
            row["awarded"] += sum((entry.delta for entry in allocation_entries), Decimal(0))
            data.record(
                "vc-participants",
                key,
                {**base, "person": allocation.user_name, "status": "批准的计划", "value": float(allocation.planned)},
            )
            for entry in allocation_entries:
                record = {
                    **base,
                    "title": entry.task_snapshot.get("title", bounty.title),
                    "person": entry.participant_snapshot.get("name", allocation.user_name),
                    "start": entry.created_at.isoformat(),
                    "status": "冲正" if entry.delta < 0 else "授予",
                    "value": float(entry.delta),
                }
                data.record("vc-participants", key, record)
        for entry in entries:
            if scope["user_id"] and str(scope["user_id"]) != str(entry.participant_snapshot.get("id", "")):
                continue
            day = entry.created_at.astimezone(SHANGHAI).date()
            if not scope["start"] <= day < scope["end"]:
                continue
            key = str(day - timedelta(days=day.weekday()))
            weeks[key]["awarded" if entry.delta > 0 else "reversed"] += abs(entry.delta)
            data.record(
                "vc-trend",
                key,
                {
                    **base,
                    "title": entry.task_snapshot.get("title", bounty.title),
                    "person": entry.participant_snapshot.get("name", ""),
                    "start": entry.created_at.isoformat(),
                    "status": "冲正" if entry.delta < 0 else "授予",
                    "value": float(entry.delta),
                },
            )
        for acceptance in bounty.acceptances.all():
            if (
                not acceptance.approved_at
                or not scope["start"] <= acceptance.approved_at.astimezone(SHANGHAI).date() < scope["end"]
            ):
                continue
            if scope["user_id"] and not any(
                str(allocation.user_id_snapshot) == str(scope["user_id"]) and str(allocation.id) in acceptance.targets
                for allocation in bounty.allocations.all()
            ):
                continue
            counts[acceptance.result] += 1
            data.record(
                "vc-acceptance",
                acceptance.result,
                {
                    **base,
                    "person": acceptance.reviewer_name,
                    "start": acceptance.approved_at.isoformat(),
                    "status": acceptance.result,
                    "value": 1,
                },
            )
    for stage in stages:
        reserved, awarded = by_stage[stage.id]["reserved"], by_stage[stage.id]["awarded"]
        budget["rows"].append(
            {
                "id": str(stage.id),
                "label": f"{stage.project_name} · {stage.name}",
                "budget": float(stage.budget),
                "available": float(stage.budget - reserved),
                "reserved": float(reserved - awarded),
                "awarded": float(awarded),
            }
        )
    participants["rows"] = [
        {**row, "planned": float(row["planned"]), "awarded": float(row["awarded"])}
        for row in sorted(people.values(), key=lambda row: (row["label"], row["id"]))
    ]
    trend["rows"] = (
        [{**row, "awarded": float(row["awarded"]), "reversed": float(row["reversed"])} for row in weeks.values()]
        if scope["project_id"]
        else []
    )
    outcomes["rows"] = [
        {"id": key, "label": label, "count": counts[key]}
        for key, label in (
            ("pass", "通过"),
            ("partial", "部分通过"),
            ("rework", "返工"),
            ("reject", "不通过"),
            ("negative", "有效探索负结果"),
        )
        if counts[key]
    ]


def statistics(view, request):
    scope = query_scope(view, request)
    data = ChartData()
    project_charts(data, request.user, view.workspace, scope)
    members = schedule_charts(data, request.user, view.workspace, scope)
    contribution_charts(data, request.user, view.workspace, scope)
    projects = Project.objects.filter(
        workspace=view.workspace, id__in=project_ids(request.user, view.workspace)
    ).order_by("name", "id")
    payload = {
        "timezone": "Asia/Shanghai",
        "range": {"start": str(scope["start"]), "end": str(scope["end"])},
        "team": scope["team"],
        "can_view_team": can_view_team(request.user, view.membership),
        "projects": [{"id": str(project.id), "name": project.name} for project in projects],
        "members": members,
        "charts": data.charts,
    }
    return payload, data.details


def csv_response(columns, rows, filename):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([csv_cell(column["label"]) for column in columns])
    for row in rows:
        writer.writerow([csv_cell(row.get(column["key"], "")) for column in columns])
    response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
    return response


class AnalyticsView(LabView):
    def get(self, request, slug):
        payload, _ = statistics(self, request)
        selected = request.query_params.get("chart")
        if selected:
            entry = next((row for row in payload["charts"] if row["id"] == selected), None)
            if not entry:
                raise NotFound("图表不存在")
            if request.query_params.get("format") == "csv":
                return csv_response(entry["columns"], entry["rows"], selected)
            return Response(entry)
        if request.query_params.get("format") == "csv":
            rows = [
                {
                    "chart": entry["title"],
                    "label": row.get("label", ""),
                    "series": series["label"],
                    "value": row.get(series["key"], 0),
                    "unit": entry["unit"],
                }
                for entry in payload["charts"]
                for row in entry["rows"]
                for series in entry["series"]
            ]
            return csv_response(
                [
                    {"key": key, "label": label}
                    for key, label in (
                        ("chart", "图表"),
                        ("label", "类别"),
                        ("series", "系列"),
                        ("value", "数值"),
                        ("unit", "单位"),
                    )
                ],
                rows,
                "lab-analytics",
            )
        return Response(payload)


class AnalyticsDrilldownView(LabView):
    def get(self, request, slug):
        payload, details = statistics(self, request)
        selected, key = request.query_params.get("chart", ""), request.query_params.get("key", "")
        entry = next((row for row in payload["charts"] if row["id"] == selected), None)
        if not entry:
            raise NotFound("图表不存在")
        records = details[selected].get(key, [])
        if not any(str(row["id"]) == key for row in entry["rows"]):
            raise NotFound("图表记录不存在或不可访问")
        if request.query_params.get("format") == "csv":
            return csv_response(DETAIL_COLUMNS, records, "lab-analytics-details")
        return Response({"chart": entry["title"], "columns": DETAIL_COLUMNS, "records": records})
