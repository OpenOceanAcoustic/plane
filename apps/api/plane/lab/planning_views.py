# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import csv

from .export import csv_cell
from datetime import timedelta
from io import StringIO
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.db.models import Project, ProjectMember, State, WorkspaceMember
from .auth import digest, lock
from .models import Folder, PersonalItem, ProjectFlow, TimeBlock, WorkspacePolicy
from .permissions import can_view_team, issue_access, project_ids, readable_issues, workspace_member
from .planning import STATUSES, block_times, configure_flow, default_folders, item_data, overlaps, own_item, set_status


class LabContentNegotiation(DefaultContentNegotiation):
    def filter_renderers(self, renderers, format):
        # CSV exports return a raw HttpResponse; avoid DRF rejecting the export parameter first.
        return renderers if format == "csv" else super().filter_renderers(renderers, format)


class LabView(APIView):
    content_negotiation_class = LabContentNegotiation

    def handle_exception(self, exc):
        if isinstance(exc, ModelValidationError):
            return Response({"error": "字段或记录 ID 格式无效"}, status=400)
        if isinstance(exc, IntegrityError) and "lab_" in str(exc):
            return Response(
                {"error": "操作超过 WIP 上限、违反独立验收流程，或试图修改冻结预算/历史账本。请联系负责人处理例外。"},
                status=409,
            )
        return super().handle_exception(exc)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.membership = workspace_member(request.user, kwargs["slug"])
        self.workspace = self.membership.workspace


class PlannerView(LabView):
    def get(self, request, slug):
        allowed = set(project_ids(request.user, self.workspace))
        folders = default_folders(request.user, self.workspace)
        items = [
            item_data(row, request.user, allowed)
            for row in PersonalItem.objects.filter(user=request.user, workspace=self.workspace).select_related(
                "issue__project", "issue__state"
            )
        ]
        projects = []
        for project in Project.objects.filter(id__in=allowed):
            flow = ProjectFlow.objects.filter(project=project).first()
            projects.append(
                {
                    "id": str(project.id),
                    "name": project.name,
                    "lead": project.project_lead_id == request.user.id,
                    "members": [
                        {"id": str(member.member_id), "name": member.member.display_name}
                        for member in ProjectMember.objects.filter(
                            project=project, is_active=True, role__gte=15, member__is_active=True
                        ).select_related("member")
                    ],
                    "states": [
                        {"id": str(state.id), "name": state.name, "group": state.group}
                        for state in State.objects.filter(project=project)
                    ],
                    "mapping": {
                        key: str(getattr(flow, key + "_id")) if getattr(flow, key + "_id", None) else None
                        for key in STATUSES
                    },
                }
            )
        return Response(
            {
                "user_id": str(request.user.id),
                "team_access": can_view_team(request.user, self.membership),
                "folders": [{"id": str(f.id), "name": f.name, "position": f.position} for f in folders],
                "items": [item for item in items if item],
                "projects": projects,
                "timezone": "Asia/Shanghai",
                "week_start": 1,
                "step_minutes": 15,
            }
        )


class FolderView(LabView):
    def post(self, request, slug):
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 40:
            raise ValidationError("文件夹名称为 1–40 字")
        with transaction.atomic():
            lock(f"lab-folders:{self.workspace.id}:{request.user.id}")
            folder = Folder.objects.create(
                user=request.user,
                workspace=self.workspace,
                name=name,
                position=(
                    Folder.objects.filter(user=request.user, workspace=self.workspace).aggregate(value=Max("position"))[
                        "value"
                    ]
                    or 0
                )
                + 1,
            )
        return Response({"id": str(folder.id)}, status=201)

    def put(self, request, slug):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or len(ids) != len(set(ids)):
            raise ValidationError("排序无效")
        with transaction.atomic():
            lock(f"lab-folders:{self.workspace.id}:{request.user.id}")
            rows = list(Folder.objects.filter(user=request.user, workspace=self.workspace))
            if set(ids) != {str(row.id) for row in rows}:
                raise ValidationError("排序必须包含全部本人文件夹")
            for row in rows:
                row.position = ids.index(str(row.id))
            Folder.objects.bulk_update(rows, ["position"])
        return Response({"ok": True})


class FolderDetailView(LabView):
    def patch(self, request, slug, pk):
        folder = get_object_or_404(Folder, id=pk, user=request.user, workspace=self.workspace)
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 40:
            raise ValidationError("文件夹名称为 1–40 字")
        folder.name = name
        folder.save(update_fields=["name"])
        return Response({"ok": True})

    def delete(self, request, slug, pk):
        get_object_or_404(Folder, id=pk, user=request.user, workspace=self.workspace).delete()
        return Response(status=204)


class TaskSearchView(LabView):
    def get(self, request, slug):
        rows = (
            readable_issues(request.user, self.workspace)
            .filter(is_draft=False, archived_at__isnull=True)
            .filter(name__icontains=str(request.query_params.get("q", ""))[:100])
            .select_related("project")
            .order_by("-created_at")[:50]
        )
        return Response(
            [
                {
                    "id": str(row.id),
                    "title": row.name,
                    "project_id": str(row.project_id),
                    "project": row.project.name,
                    "key": f"{row.project.identifier}-{row.sequence_id}",
                }
                for row in rows
            ]
        )


class ItemView(LabView):
    def post(self, request, slug):
        data = request.data
        folder = (
            get_object_or_404(Folder, id=data["folder_id"], user=request.user, workspace=self.workspace)
            if data.get("folder_id")
            else None
        )
        issue = issue_access(request.user, self.workspace, data["issue_id"]) if data.get("issue_id") else None
        title = str(data.get("title", "")).strip()
        kind = data.get("kind", "research")
        if not issue and (not title or len(title) > 255 or kind not in ("research", "study", "mentoring")):
            raise ValidationError("请填写事项名称和类型")
        with transaction.atomic():
            lock(f"lab-planner:{self.workspace.id}:{request.user.id}")
            if issue and PersonalItem.objects.filter(user=request.user, workspace=self.workspace, issue=issue).exists():
                raise ValidationError("任务已在本人规划中，请移动到需要的文件夹")
            item = PersonalItem.objects.create(
                user=request.user,
                workspace=self.workspace,
                folder=folder,
                issue=issue,
                title=title,
                description=str(data.get("description", "")),
                kind="project" if issue else kind,
                public=data.get("public") is True,
            )
        return Response({"id": str(item.id)}, status=201)


class ItemDetailView(LabView):
    @transaction.atomic
    def patch(self, request, slug, pk):
        item = own_item(request.user, self.workspace, pk)
        data = request.data
        if "folder_id" in data:
            item.folder = (
                get_object_or_404(Folder, id=data["folder_id"], user=request.user, workspace=self.workspace)
                if data["folder_id"]
                else None
            )
        if not item.issue_id:
            if "kind" in data:
                if data["kind"] not in ("research", "study", "mentoring"):
                    raise ValidationError("个人事项类型无效")
                item.kind = data["kind"]
            if "title" in data:
                title = str(data["title"]).strip()
                if not title or len(title) > 255:
                    raise ValidationError("事项名称为 1–255 字")
                item.title = title
            if "description" in data:
                item.description = str(data["description"])
            if "public" in data:
                item.public = data["public"] is True
        item.save()
        if "status" in data:
            set_status(item, request.user, data["status"])
        return Response({"ok": True})

    def delete(self, request, slug, pk):
        own_item(request.user, self.workspace, pk).delete()
        return Response(status=204)


class FlowView(LabView):
    def put(self, request, slug, pk):
        project = get_object_or_404(Project, id=pk, workspace=self.workspace)
        configure_flow(request.user, project, request.data)
        WorkspacePolicy.objects.get_or_create(workspace=self.workspace)
        return Response({"ok": True})


class CalendarView(LabView):
    def get(self, request, slug):
        team = request.query_params.get("team") == "1"
        if team and not can_view_team(request.user, self.membership):
            raise PermissionDenied("仅负责人可以查看团队排期")
        try:
            start = parse_datetime(request.query_params.get("start", ""))
            end = parse_datetime(request.query_params.get("end", ""))
            if not start:
                start = (
                    timezone.now()
                    .astimezone(ZoneInfo("Asia/Shanghai"))
                    .replace(hour=0, minute=0, second=0, microsecond=0)
                )
                start -= timedelta(days=start.weekday())
            if not end:
                end = start + timedelta(days=7)
            if timezone.is_naive(start) or timezone.is_naive(end) or end <= start or end - start > timedelta(days=31):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValidationError("日期范围须带时区且不超过 31 天")
        allowed = set(project_ids(request.user, self.workspace))
        rows = TimeBlock.objects.filter(
            item__workspace=self.workspace, start__lt=end, end__gt=start, item__user__is_active=True
        ).select_related("item__user", "item__issue__project", "item__issue__state")
        if not team:
            rows = rows.filter(item__user=request.user)
        members = WorkspaceMember.objects.filter(
            workspace=self.workspace, is_active=True, member__is_active=True
        ).select_related("member")
        active_members = {row.member_id for row in members}
        events = []
        for block in rows:
            item = block.item
            if item.user_id not in active_members:
                continue
            own = item.user_id == request.user.id
            visible = own or item.public or bool(item.issue_id)
            details = item_data(item, request.user, allowed) if visible else None
            event = {
                "id": str(block.id) if own else digest(f"{block.id}:{request.user.id}"),
                "user_id": str(item.user_id),
                "start": block.start.isoformat(),
                "end": block.end.isoformat(),
                "title": details["title"] if details else "忙碌",
                "editable": own,
            }
            if details:
                event["item_id"] = str(item.id)
                if details.get("issue_id"):
                    event["issue_id"] = details["issue_id"]
                    event["project_id"] = details["project_id"]
            events.append(event)
        return Response(
            {
                "events": events,
                "members": [{"id": str(row.member_id), "name": row.member.display_name} for row in members]
                if team
                else [{"id": str(request.user.id), "name": request.user.display_name}],
            }
        )

    def post(self, request, slug):
        item = own_item(request.user, self.workspace, request.data.get("item_id"))
        if item.issue_id:
            issue_access(request.user, self.workspace, item.issue_id)
        start, end = block_times(request.data)
        block = TimeBlock.objects.create(item=item, start=start, end=end)
        return Response({"id": str(block.id), "overlap": overlaps(block)}, status=201)


class BlockDetailView(LabView):
    @transaction.atomic
    def patch(self, request, slug, pk):
        block = get_object_or_404(
            TimeBlock.objects.select_for_update(), id=pk, item__user=request.user, item__workspace=self.workspace
        )
        if block.item.issue_id:
            issue_access(request.user, self.workspace, block.item.issue_id)
        if "split_at" in request.data:
            try:
                split = parse_datetime(request.data["split_at"])
                block_times({"start": block.start.isoformat(), "end": split.isoformat()})
                if split >= block.end:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise ValidationError("拆分点须位于时间块内且按十五分钟对齐")
            following = TimeBlock.objects.create(item=block.item, start=split, end=block.end)
            block.end = split
            block.save(update_fields=["end"])
            return Response({"id": str(block.id), "following_id": str(following.id)})
        block.start, block.end = block_times(request.data)
        block.save(update_fields=["start", "end"])
        return Response({"id": str(block.id), "overlap": overlaps(block)})

    def delete(self, request, slug, pk):
        get_object_or_404(TimeBlock, id=pk, item__user=request.user, item__workspace=self.workspace).delete()
        return Response(status=204)


class PlanningExportView(LabView):
    def get(self, request, slug):
        allowed = set(project_ids(request.user, self.workspace))
        items = []
        for row in (
            PersonalItem.objects.filter(user=request.user, workspace=self.workspace)
            .select_related("issue__project", "issue__state")
            .prefetch_related("blocks")
        ):
            data = item_data(row, request.user, allowed)
            if data:
                data["blocks"] = [{"start": b.start.isoformat(), "end": b.end.isoformat()} for b in row.blocks.all()]
                items.append(data)
        if request.query_params.get("format") != "csv":
            return Response(items)
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(["事项ID", "原任务ID", "名称", "状态", "开始", "结束", "时区"])

        for item in items:
            for block in item["blocks"] or [{"start": "", "end": ""}]:
                writer.writerow(
                    [
                        csv_cell(value)
                        for value in (
                            item["id"],
                            item["issue_id"],
                            item["title"],
                            item["status"],
                            block["start"],
                            block["end"],
                            "Asia/Shanghai",
                        )
                    ]
                )
        response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="personal-planning.csv"'
        return response
