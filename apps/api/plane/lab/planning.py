# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from plane.db.models import Issue, IssueActivity, ProjectMember, State
from .auth import audit, lock
from .models import Bounty, Folder, PersonalItem, ProjectFlow, TimeBlock
from .permissions import can_read_issue, issue_access, require_lead
from .categories import hex_color, item_category_data

STATUSES = ("todo", "active", "review", "done")


def block_color(data, current=""):
    value = data.get("color", current)
    return hex_color(value, automatic=True)


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


def item_data(
    item,
    user,
    allowed_projects,
    *,
    readable_issue_ids=None,
    flows=None,
    bounties_by_issue=None,
    granted_issue_ids=None,
    editable_issue_ids=None,
    deletable_issue_ids=None,
):
    if item.kind == "project" and not item.issue_id:
        return None
    if item.issue_id:
        issue = item.issue
        readable = (
            issue.id in readable_issue_ids
            and issue.project_id in allowed_projects
            and not issue.deleted_at
            and not issue.is_draft
            if readable_issue_ids is not None
            else can_read_issue(user, issue, allowed_projects)
        )
        from .bounty_access import issue_capabilities, task_granted
        from .models import Bounty

        bounty = (
            bounties_by_issue.get(issue.id)
            if bounties_by_issue is not None
            else Bounty.objects.select_related("stage__workspace", "issue__project")
            .filter(issue=issue)
            .exclude(status="deleted")
            .first()
        )
        granted = (
            issue.id in granted_issue_ids
            if granted_issue_ids is not None
            else bool(bounty and task_granted(user, bounty))
        )
        if not readable and not granted:
            return None
        flow = (
            flows.get(issue.project_id)
            if flows is not None
            else ProjectFlow.objects.filter(project=issue.project).first()
        )
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
            **item_category_data(item),
            **(
                issue_capabilities(
                    user, bounty, editable=issue.id in editable_issue_ids if editable_issue_ids is not None else None
                )
                if bounty
                else {
                    "can_edit_issue": issue.id in editable_issue_ids
                    if editable_issue_ids is not None
                    else _editable_issue(user, item.workspace, issue.id),
                }
            ),
            "id": str(item.id),
            "can_open_issue": readable,
            "can_delete_issue": issue.id in deletable_issue_ids if deletable_issue_ids is not None else False,
            "issue_id": str(issue.id),
            "project_id": str(issue.project_id),
            "project_name": issue.project.name,
            "issue_key": f"{issue.project.identifier}-{issue.sequence_id}",
            "priority": issue.priority,
            "target_date": issue.target_date.isoformat() if issue.target_date else None,
            "title": issue.name,
            "status": status,
            "folder_id": str(item.folder_id) if item.folder_id else None,
            "kind": "project",
            "public": True,
            "archived": bool(issue.archived_at),
        }
    return {
        **item_category_data(item),
        "id": str(item.id),
        "title": item.title,
        "description": item.description,
        "status": item.status,
        "folder_id": str(item.folder_id) if item.folder_id else None,
        "kind": item.kind,
        "public": item.public,
        "issue_id": None,
        "project_name": None,
        "issue_key": None,
        "priority": None,
        "target_date": None,
        "can_edit_issue": True,
        "can_open_issue": False,
    }


def _editable_issue(user, workspace, issue_id):
    try:
        issue_access(user, workspace, issue_id, edit=True)
        return True
    except APIException:
        return False


def planning_projection_context(user, workspace, items, *, readable_issue_ids=None):
    """Batch task grants and capabilities to keep planner/calendar queries bounded."""
    from .bounty_models import BountyTaskAccess
    from .models import Bounty
    from .permissions import readable_issues
    from .issue_deletion import deletable_issue_ids

    issues = {item.issue_id: item.issue for item in items if item.issue_id}
    if readable_issue_ids is None:
        readable_issue_ids = set(
            readable_issues(user, workspace)
            .filter(
                id__in=issues,
                is_draft=False,
                deleted_at__isnull=True,
            )
            .values_list("id", flat=True)
        )
    editable_projects = set(
        ProjectMember.objects.filter(
            workspace=workspace,
            member=user,
            is_active=True,
        )
        .filter(Q(role__gte=15) | Q(project__guest_view_all_features=True))
        .values_list("project_id", flat=True)
    )
    editable_ids = {
        issue_id
        for issue_id, issue in issues.items()
        if issue_id in readable_issue_ids
        and not issue.archived_at
        and (issue.created_by_id == user.id or issue.project_id in editable_projects)
    }
    bounties_by_issue = {
        row.issue_id: row
        for row in Bounty.objects.filter(issue_id__in=issues)
        .exclude(status="deleted")
        .select_related(
            "stage__workspace",
            "issue__project",
        )
    }
    granted_ids = set(
        BountyTaskAccess.objects.filter(
            allocation__user=user,
            allocation__approved=True,
            revoked_at__isnull=True,
            allocation__bounty__issue_id__in=issues,
            allocation__bounty__issue__deleted_at__isnull=True,
            allocation__bounty__issue__is_draft=False,
        )
        .exclude(allocation__bounty__status="deleted")
        .filter(Q(requires_project_membership=False) | Q(allocation__bounty__issue_id__in=readable_issue_ids))
        .values_list("allocation__bounty__issue_id", flat=True)
    )
    flows = {
        flow.project_id: flow
        for flow in ProjectFlow.objects.filter(
            project_id__in={issue.project_id for issue in issues.values()},
        )
    }
    return {
        "readable_issue_ids": readable_issue_ids,
        "editable_issue_ids": editable_ids,
        "deletable_issue_ids": deletable_issue_ids(user, workspace, issues.values()),
        "bounties_by_issue": bounties_by_issue,
        "granted_issue_ids": granted_ids,
        "flows": flows,
    }


def item_schedules(item_ids):
    """Summarize real blocks for already authorized personal items in one query."""
    now = timezone.now()
    week_start = now.astimezone(ZoneInfo("Asia/Shanghai")).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start -= timedelta(days=week_start.weekday())
    week_end = week_start + timedelta(days=7)
    schedules = {
        item_id: {"future_count": 0, "next_start": None, "next_end": None, "week_minutes": 0, "total_count": 0}
        for item_id in item_ids
    }
    blocks = (
        TimeBlock.objects.filter(item_id__in=item_ids).order_by("start", "id").values_list("item_id", "start", "end")
    )
    for item_id, start, end in blocks.iterator():
        schedule = schedules[str(item_id)]
        schedule["total_count"] += 1
        if end > now:
            schedule["future_count"] += 1
            if schedule["next_start"] is None:
                schedule["next_start"], schedule["next_end"] = start.isoformat(), end.isoformat()
        clipped_start, clipped_end = max(start, week_start), min(end, week_end)
        if clipped_end > clipped_start:
            schedule["week_minutes"] += (clipped_end - clipped_start).total_seconds() / 60
    return schedules


def own_item(user, workspace, item_id):
    from django.shortcuts import get_object_or_404

    return get_object_or_404(PersonalItem, id=item_id, user=user, workspace=workspace)


def project_status_state(project, status):
    """Use configured states, or native groups for an unconfigured project.

    Review has no native group and must have its own explicit mapping. An
    invalid configured mapping is never silently replaced with another state.
    """
    groups = {
        "todo": ("unstarted", "backlog"),
        "active": ("started",),
        "review": ("started",),
        "done": ("completed",),
    }
    flow = ProjectFlow.objects.filter(project=project).first()
    states = State.objects.filter(project=project)
    if flow:
        state = states.filter(pk=getattr(flow, status + "_id"), group__in=groups[status]).first()
        if not state:
            raise ValidationError("项目状态映射已失效，请项目负责人重新配置「项目状态映射」")
        return state
    if status == "review":
        raise ValidationError("项目未设置待验收状态，请项目负责人在「项目状态映射」中配置独立的待验收状态")
    for group in groups[status]:
        state = states.filter(group=group).order_by("-default", "sequence", "id").first()
        if state:
            return state
    raise ValidationError("项目缺少对应状态，请项目负责人在项目设置中补齐状态")


@transaction.atomic
def set_status(item, user, status):
    if status not in STATUSES:
        raise ValidationError("状态无效")
    if item.issue_id:
        # Native WIP statement triggers take this lock before issue tuple locks.
        # Use the same order when reading the previous state for activity history.
        with connection.cursor() as cursor:
            cursor.execute("""DO $$ BEGIN
                IF to_regprocedure('lab_wip_lock(uuid)') IS NOT NULL THEN
                    PERFORM lab_wip_lock(NULL);
                END IF;
            END $$;""")
        issue = issue_access(user, item.workspace, item.issue_id, edit=True)
        issue = Issue.objects.select_related("state").select_for_update(of=("self",)).get(pk=issue.id)
        state = project_status_state(issue.project, status)
        if issue.state_id == state.id:
            return
        bounty = Bounty.objects.filter(issue=issue).exclude(status="deleted").first()
        if bounty:
            actions = {
                "publication_review": "悬赏发布待复核，请由指定复核人在悬赏详情办理「复核发布」。",
                "open": "请在悬赏详情完成认领批准和本人确认，再由负责人办理「团队开工」。",
                "active": "请由参与成员在悬赏详情办理「提交成果验收」。",
                "partial": "悬赏部分通过，请由参与成员在悬赏详情办理「提交成果验收」。",
                "rework": "悬赏返工中，请由参与成员在悬赏详情办理「提交成果验收」。",
                "review": "请由指定验收人在悬赏详情办理「独立验收」。",
                "acceptance_review": "请由指定复核人在悬赏详情办理「复核验收」。",
                "done": "悬赏已完成，请由负责人在悬赏详情办理「更正后重新验收」。",
                "rejected": "悬赏未通过验收，请在悬赏详情查看验收结果。",
                "cancelled": "悬赏已取消，请在悬赏详情查看取消记录。",
            }
            raise ValidationError({"error": actions.get(bounty.status, "请在悬赏详情办理任务状态变更。")})
        previous = issue.state
        issue.state = state
        issue.updated_by = user
        issue.save(update_fields=["state", "completed_at", "updated_at", "updated_by"])
        IssueActivity.objects.create(
            workspace=item.workspace,
            project=issue.project,
            issue=issue,
            actor=user,
            verb="updated",
            field="state",
            comment="updated the state to",
            old_value=previous.name if previous else None,
            new_value=state.name,
            old_identifier=previous.id if previous else None,
            new_identifier=state.id,
            epoch=timezone.now().timestamp(),
        )
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


class PlanningConflict(APIException):
    status_code = 409
    default_detail = "排期已被修改，请刷新后重试。"
    default_code = "planning_conflict"


def check_block_revision(block, data):
    expected = data.get("expected_revision")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        raise ValidationError("请提交排期版本 expected_revision，刷新后重试")
    if expected != block.revision:
        raise PlanningConflict()


def calendar_events(user, workspace, start, end, *, team=False, user_id=None, project_id=None):
    """Permission-filtered calendar projection shared by calendars and analytics.

    Hidden blocks stay opaque busy events under project filters, so filtering
    cannot reveal their project or personal category. Revision is owner-only.
    """
    from uuid import UUID
    from plane.db.models import WorkspaceMember
    from .auth import digest
    from .permissions import can_view_team, project_ids, workspace_member

    membership = workspace_member(user, workspace.slug)
    if team and not can_view_team(user, membership):
        raise PermissionDenied("仅负责人可以查看团队排期")
    allowed = set(project_ids(user, workspace))
    try:
        if user_id:
            user_id = UUID(str(user_id))
        if project_id:
            project_id = UUID(str(project_id))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("人员或项目筛选 ID 格式无效")
    if project_id and project_id not in allowed:
        # Do not distinguish inaccessible and nonexistent project identifiers.
        from django.http import Http404

        raise Http404()
    members = WorkspaceMember.objects.filter(
        workspace=workspace, is_active=True, member__is_active=True
    ).select_related("member")
    if not team:
        members = members.filter(member=user)
    if user_id:
        members = members.filter(member_id=user_id)
    member_rows = list(members)
    active_members = {row.member_id for row in member_rows}
    blocks = list(
        TimeBlock.objects.filter(
            item__workspace=workspace, item__user_id__in=active_members, start__lt=end, end__gt=start
        ).select_related("item__user", "item__category", "item__issue__project", "item__issue__state")
    )
    context = planning_projection_context(user, workspace, [block.item for block in blocks])
    events = []
    for block in blocks:
        item = block.item
        if (item.kind == "project" and not item.issue_id) or (item.issue_id and item.issue.deleted_at):
            continue
        own = item.user_id == user.id
        details = item_data(item, user, allowed, **context) if own or item.public or item.issue_id else None
        if project_id and details and details.get("project_id") != str(project_id):
            continue
        event = {
            "id": str(block.id) if own else digest(f"{block.id}:{user.id}"),
            "user_id": str(item.user_id),
            "start": block.start.isoformat(),
            "end": block.end.isoformat(),
            "title": details["title"] if details else "忙碌",
            "editable": own and bool(details),
        }
        if details:
            event.update(
                {
                    "item_id": str(item.id),
                    "kind": details["kind"],
                    "status": details["status"],
                    "color": block.color,
                    **item_category_data(item),
                }
            )
            if details.get("issue_id"):
                event.update({"issue_id": details["issue_id"], "project_id": details["project_id"]})
            for key in (
                "bounty_id",
                "bounty_status",
                "bounty_detail_url",
                "can_edit_issue",
                "can_open_issue",
                "issue_key",
            ):
                if key in details:
                    event[key] = details[key]
        if event["editable"]:
            event["revision"] = block.revision
        events.append(event)
    return {
        "events": events,
        "members": [
            {"id": str(row.member_id), "name": row.member.display_name or row.member.username} for row in member_rows
        ],
    }
