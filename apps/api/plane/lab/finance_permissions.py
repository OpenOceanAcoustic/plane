# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Project finance access is derived from current memberships and explicit grants."""

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import ProjectMember, WorkspaceMember
from .auth import audit, lock
from .finance_models import ProjectFinancePermission

PERMISSIONS = ("view", "record", "approve", "pay")
ACTION_PERMISSIONS = {
    "stage": "record",
    "receipt": "record",
    "opening": "record",
    "transfer": "record",
    "risk-release": "record",
    "risk-use": "pay",
    "stage-allocation": "record",
    "dispute": "record",
    "resolve-dispute": "record",
    "carryover": "record",
    "receipt-delete": "record",
    "settlement": "approve",
    "history-settlement": "approve",
    "history-award": "approve",
    "formula": "approve",
    "forecast": "approve",
    "forecast-task": "approve",
    "commit": "pay",
    "cancel-commit": "pay",
    "payment": "pay",
    "expense": "pay",
    "tax-remit": "pay",
}


def project_finance_access(user, project):
    if not project or not user.is_active:
        return (), False
    membership = WorkspaceMember.objects.filter(workspace_id=project.workspace_id, member=user, is_active=True).first()
    if (
        not membership
        or not ProjectMember.objects.filter(
            project=project, workspace_id=project.workspace_id, member=user, is_active=True, role__gte=15
        ).exists()
    ):
        return (), False
    owner = membership.role == 20 or user.id in (project.created_by_id, project.project_lead_id)
    if owner:
        return PERMISSIONS, True
    values = (
        ProjectFinancePermission.objects.filter(project=project, user=user)
        .values_list("permissions", flat=True)
        .first()
        or []
    )
    return tuple(value for value in PERMISSIONS if value in values), False


def require_project_finance(user, project, permission="record"):
    permissions, owner = project_finance_access(user, project)
    if permission == "manage" and owner or permission in permissions:
        return
    raise PermissionDenied("无此项目财务操作权限")


def action_permission(action, original=None):
    if action == "reverse":
        return ACTION_PERMISSIONS.get(original.kind, "manage") if original else "manage"
    return ACTION_PERMISSIONS.get(action, "manage")


def permission_members(project):
    grants = {row.user_id: row.permissions for row in ProjectFinancePermission.objects.filter(project=project)}
    members = (
        ProjectMember.objects.filter(
            project=project,
            workspace_id=project.workspace_id,
            is_active=True,
            role__gte=15,
            member__is_active=True,
            member_id__in=WorkspaceMember.objects.filter(workspace_id=project.workspace_id, is_active=True).values(
                "member_id"
            ),
        )
        .select_related("member")
        .order_by("member__display_name", "id")
    )
    result = []
    for row in members:
        _, owner = project_finance_access(row.member, project)
        result.append(
            {
                "id": str(row.member_id),
                "name": row.member.display_name,
                "permissions": list(PERMISSIONS) if owner else grants.get(row.member_id, []),
                "owner": owner,
            }
        )
    return result


@transaction.atomic
def set_project_finance_permissions(user, project, data):
    lock(f"finance:{project.workspace_id}")
    require_project_finance(user, project, "manage")
    values = data.get("permissions")
    if not isinstance(values, list) or any(not isinstance(value, str) or value not in PERMISSIONS for value in values):
        raise ValidationError("财务权限须为查看、登记资金、核准奖励、登记付款")
    member = next((row for row in permission_members(project) if row["id"] == str(data.get("user_id"))), None)
    if not member:
        raise ValidationError("请选择当前项目的有效成员")
    if member["owner"]:
        raise ValidationError("创建者、负责人和管理员的财务权限始终保留")
    normalized = [value for value in PERMISSIONS if value in values or value == "view" and values]
    row, _ = ProjectFinancePermission.objects.update_or_create(
        project=project, user_id=member["id"], defaults={"permissions": normalized, "granted_by": user}
    )
    audit(
        "finance.permissions",
        row,
        user,
        project.workspace,
        project_id=str(project.id),
        user_id=member["id"],
        permissions=normalized,
    )
    return permission_members(project)
