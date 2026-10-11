# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Personal planning sharing grants read access within the current workspace."""

from uuid import UUID

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from plane.db.models import WorkspaceMember
from .models import PersonalItem
from .permissions import can_view_team, workspace_member


def visible_personal_items(user, workspace):
    membership = workspace_member(user, workspace.slug)
    scope = Q(user=user) | Q(visibility="organization") | Q(visibility="selected", shared_users=user)
    if can_view_team(user, membership):
        scope |= Q(visibility="leads") | Q(visibility="private", public=True)
    active = WorkspaceMember.objects.filter(workspace=workspace, is_active=True, member__is_active=True).values(
        "member_id"
    )
    return (
        PersonalItem.objects.filter(workspace=workspace, issue__isnull=True, user_id__in=active)
        .exclude(kind="project")
        .filter(scope)
        .distinct()
    )


def set_item_visibility(item, data):
    if not any(key in data for key in ("visibility", "shared_user_ids", "public")):
        return
    if item.issue_id:
        if "visibility" in data or data.get("shared_user_ids"):
            raise ValidationError("项目任务的可见范围由项目和悬赏权限控制")
        return
    visibility = data.get("visibility", item.visibility)
    if "visibility" not in data and "public" in data:
        if not isinstance(data["public"], bool):
            raise ValidationError("公开开关须为布尔值")
        visibility = (
            item.visibility
            if data["public"] and item.visibility in ("organization", "leads")
            else "leads"
            if data["public"]
            else "private"
        )
    if visibility not in ("private", "organization", "selected", "leads"):
        raise ValidationError("请选择有效的可见范围")
    identifiers = data.get("shared_user_ids", list(item.shared_users.values_list("id", flat=True)))
    if not isinstance(identifiers, list):
        raise ValidationError("可见成员须为成员 ID 列表")
    try:
        identifiers = {UUID(str(value)) for value in identifiers}
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("可见成员 ID 格式无效")
    if visibility == "selected":
        valid = set(
            WorkspaceMember.objects.filter(workspace=item.workspace, is_active=True, member__is_active=True)
            .exclude(member=item.user)
            .values_list("member_id", flat=True)
        )
        if not identifiers or not identifiers.issubset(valid):
            raise ValidationError("请选择组织内有效的其他成员")
    else:
        identifiers = set()
    item.visibility = visibility
    item.public = visibility in ("organization", "leads")
    item.save(update_fields=["visibility", "public"])
    item.shared_users.set(identifiers)
