# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError

from plane.db.models import State
from .auth import audit, lock
from .models import Folder, PersonalItem, ProjectFlow, TimeBlock
from .permissions import can_read_issue, issue_access, require_lead

STATUSES = ("todo", "active", "review", "done")


@transaction.atomic
def default_folders(user, workspace):
    lock(f"lab-folders:{workspace.id}:{user.id}")
    # An empty folder list after intentional deletion stays empty.
    from .models import Audit

    if not Audit.objects.filter(actor=user, workspace_id_snapshot=workspace.id, action="planning.initialized").exists():
        Folder.objects.bulk_create(
            [Folder(user=user, workspace=workspace, name=name, position=i) for i, name in enumerate("ABCD")]
        )
        audit("planning.initialized", actor=user, workspace=workspace)
    return Folder.objects.filter(workspace=workspace, user=user)


def item_data(item, user, allowed_projects):
    if item.kind == "project" and not item.issue_id:
        return None
    if item.issue_id:
        issue = item.issue
        if not can_read_issue(user, issue, allowed_projects):
            return None
        flow = ProjectFlow.objects.filter(project=issue.project).first()
        status = (
            "review"
            if flow and issue.state_id == flow.review_id
            else "done"
            if issue.state and issue.state.group in ("completed", "cancelled")
            else "active"
            if issue.state and issue.state.group == "started"
            else "todo"
        )
        return {
            "id": str(item.id),
            "issue_id": str(issue.id),
            "project_id": str(issue.project_id),
            "title": issue.name,
            "status": status,
            "folder_id": str(item.folder_id) if item.folder_id else None,
            "kind": "project",
            "public": True,
            "archived": bool(issue.archived_at),
        }
    return {
        "id": str(item.id),
        "title": item.title,
        "description": item.description,
        "status": item.status,
        "folder_id": str(item.folder_id) if item.folder_id else None,
        "kind": item.kind,
        "public": item.public,
        "issue_id": None,
    }


def own_item(user, workspace, item_id):
    from django.shortcuts import get_object_or_404

    return get_object_or_404(PersonalItem, id=item_id, user=user, workspace=workspace)


@transaction.atomic
def set_status(item, user, status):
    if status not in STATUSES:
        raise ValidationError("状态无效")
    if item.issue_id:
        issue = issue_access(user, item.workspace, item.issue_id, edit=True)
        flow = ProjectFlow.objects.filter(project=issue.project).first()
        state = getattr(flow, status, None) if flow else None
        if not state:
            raise ValidationError("请项目负责人先配置四类状态映射")
        issue.state = state
        issue.save(update_fields=["state", "completed_at"])
        audit("planning.issue_status", obj=item, actor=user, workspace=item.workspace, status=status)
    else:
        item.status = status
        item.save(update_fields=["status"])


def block_times(data):
    try:
        start, end = parse_datetime(data["start"]), parse_datetime(data["end"])
        if (
            not start
            or not end
            or timezone.is_naive(start)
            or timezone.is_naive(end)
            or end <= start
            or end - start > timedelta(days=7)
        ):
            raise ValueError()
        if any(int(value.timestamp()) % 900 or value.microsecond for value in (start, end)):
            raise ValueError()
        return start, end
    except (KeyError, TypeError, ValueError):
        raise ValidationError("排期须带时区、按十五分钟对齐，结束晚于开始且不超过七天")


def overlaps(block):
    return (
        TimeBlock.objects.filter(
            item__user=block.item.user, item__workspace=block.item.workspace, start__lt=block.end, end__gt=block.start
        )
        .exclude(id=block.id)
        .exists()
    )


@transaction.atomic
def configure_flow(user, project, data):
    require_lead(user, project)
    states = {}
    for key in STATUSES:
        try:
            states[key] = State.objects.get(id=data[key], project=project)
        except (KeyError, State.DoesNotExist, ValueError):
            raise ValidationError("四类状态必须来自当前项目")
    if (
        len({s.id for s in states.values()}) != 4
        or states["todo"].group not in ("backlog", "unstarted")
        or states["active"].group != "started"
        or states["review"].group != "started"
        or states["done"].group != "completed"
    ):
        raise ValidationError("状态须分别为待做、进行中、待验收（started）、完成，且不能重复")
    flow, _ = ProjectFlow.objects.update_or_create(project=project, defaults=states)
    audit(
        "planning.state_mapping",
        flow,
        actor=user,
        workspace=project.workspace,
        states={key: str(value.id) for key, value in states.items()},
    )
    return flow
