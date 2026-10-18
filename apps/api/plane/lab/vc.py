# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""VC custody: grants reserve project principal once; earned VC may circulate in that project.

Balances derive from the append-only contribution/grant ledgers and committed funding.
Every mutation takes the existing workspace WIP transaction lock, including acceptance
and reversal. A quote may inspect a balance but only final approval commits funds.
"""

import uuid
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from plane.db.models import Project, ProjectMember, WorkspaceMember
from .auth import audit, lock
from .models import Bounty, BountyFunding, Ledger, Stage, VCBudgetEntry, VCGrant
from .permissions import workspace_member

ZERO = Decimal("0.00")


def summed(rows, field):
    return rows.aggregate(value=Sum(field))["value"] or ZERO


def require_member(user, project, *, admin=False):
    if not project or not user or not user.is_active or project.archived_at or project.deleted_at:
        raise PermissionDenied("需要有效项目成员权限")
    workspace_member(user, project.workspace.slug)
    if not ProjectMember.objects.filter(
        project=project, workspace_id=project.workspace_id, member=user, is_active=True, role__gte=20 if admin else 15
    ).exists():
        raise PermissionDenied("仅项目管理员可以分配或收回成员额度" if admin else "需要有效项目成员权限")


def can_allocate(user, project):
    try:
        require_member(user, project, admin=True)
        return True
    except APIException:
        return False


def stage_reserved(stage):
    # A member publication is already backed by a grant or an earlier award.
    # Counting its reservation again would charge project principal twice.
    return (
        summed(Bounty.objects.filter(stage=stage, member_funded=False), "reserved")
        + summed(VCGrant.objects.filter(stage=stage), "delta")
        + summed(BountyFunding.objects.filter(bounty__stage=stage, source="project"), "project_committed")
    )


def stage_budget(stage):
    """Current VC pool; the original frozen Stage amount still anchors cash history."""
    value = VCBudgetEntry.objects.filter(stage=stage).aggregate(value=Sum("amount"))["value"]
    return stage.budget if value is None else value


def wallet(user_id, project):
    grants = summed(
        VCGrant.objects.filter(
            stage__project_id_snapshot=project.id,
            stage__workspace_id_snapshot=project.workspace_id,
            user_id_snapshot=user_id,
        ),
        "delta",
    )
    earned = summed(
        Ledger.objects.filter(
            bounty__stage__project_id_snapshot=project.id,
            bounty__stage__workspace_id_snapshot=project.workspace_id,
            allocation__user_id_snapshot=user_id,
        ),
        "delta",
    )
    commitments = BountyFunding.objects.filter(
        source="personal",
        owner_id_snapshot=user_id,
        bounty__stage__project_id_snapshot=project.id,
        bounty__stage__workspace_id_snapshot=project.workspace_id,
    ).aggregate(project=Sum("project_committed"), earned=Sum("earned_committed"))
    allocated_balance = grants - (commitments["project"] or ZERO)
    earned_balance = earned - (commitments["earned"] or ZERO)
    # A contribution correction can create debt after the recipient spent it.
    # Preserve that correction and offset future earnings; never grant new VC.
    return {
        "project_available": f"{max(ZERO, allocated_balance):.2f}",
        "earned_available": f"{max(ZERO, earned_balance):.2f}",
        "earned_debt": f"{max(ZERO, -earned_balance):.2f}",
        "available": f"{max(ZERO, allocated_balance) + max(ZERO, earned_balance):.2f}",
        "project_granted": f"{grants:.2f}",
        "earned_total": f"{earned:.2f}",
        "project_committed": f"{(commitments['project'] or ZERO):.2f}",
        "earned_committed": f"{(commitments['earned'] or ZERO):.2f}",
    }


def payment(user, project, budget, data=None):
    from .bounties import amount

    balance = wallet(user.id, project)
    available_project = Decimal(balance["project_available"])
    available_earned = Decimal(balance["earned_available"])
    data = data or {}
    if "project_vc" in data or "earned_vc" in data:
        project_vc, earned_vc = amount(data.get("project_vc", 0)), amount(data.get("earned_vc", 0))
    else:
        project_vc = min(budget, available_project)
        earned_vc = budget - project_vc
    if project_vc + earned_vc != budget:
        raise ValidationError("两种来源的支付 VC 合计须等于悬赏配额")
    if project_vc > available_project or earned_vc > available_earned:
        raise ValidationError("个人可用 VC 不足，请刷新余额后调整支付来源")
    return project_vc, earned_vc


def reserve_additional(bounty, additional, actor):
    if not bounty.member_funded or additional <= 0:
        return
    funding = BountyFunding.objects.select_for_update().get(bounty=bounty)
    require_member(funding.owner, bounty.stage.project, admin=funding.source == "project")
    if funding.source == "project":
        if additional > stage_budget(bounty.stage) - stage_reserved(bounty.stage):
            raise ValidationError("项目未分配 VC 余额不足")
        project_vc, earned_vc = additional, ZERO
    else:
        project_vc, earned_vc = payment(funding.owner, bounty.stage.project, additional)
    funding.project_committed += project_vc
    funding.earned_committed += earned_vc
    funding.save(update_fields=["project_committed", "earned_committed"])
    audit(
        "bounty.vc_reserved",
        bounty,
        actor,
        bounty.stage.workspace,
        project_vc=str(project_vc),
        earned_vc=str(earned_vc),
        owner_id=str(funding.owner_id_snapshot),
    )


def release_unused(bounty, actor):
    if not bounty.member_funded:
        return
    funding = BountyFunding.objects.select_for_update().get(bounty=bounty)
    awarded = summed(Ledger.objects.filter(bounty=bounty), "delta")
    # Project quota pays first; unused income returns to the same project wallet.
    keep_project = min(funding.project_committed, awarded)
    keep_earned = max(ZERO, awarded - keep_project)
    project_vc = funding.project_committed - keep_project
    earned_vc = funding.earned_committed - keep_earned
    if project_vc < 0 or earned_vc < 0:
        raise ValidationError("悬赏支付来源与已授予 VC 不一致")
    funding.project_committed, funding.earned_committed = keep_project, keep_earned
    funding.save(update_fields=["project_committed", "earned_committed"])
    bounty.reserved = awarded
    bounty.save(update_fields=["reserved"])
    if project_vc or earned_vc:
        audit(
            "bounty.vc_released",
            bounty,
            actor,
            bounty.stage.workspace,
            project_vc=str(project_vc),
            earned_vc=str(earned_vc),
            owner_id=str(funding.owner_id_snapshot),
        )


def parse_key(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("请提供有效的 UUID 请求键") from None


@transaction.atomic
def grant(user, workspace, project_id, data):
    from .bounties import amount
    from .finance_services import require_finance_open

    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=project_id, workspace=workspace
    )
    require_member(user, project, admin=True)
    require_finance_open(workspace, project.id)
    key = parse_key(data.get("request_key"))
    target = parse_key(data.get("user_id"))
    value = amount(data.get("amount"))
    kind, reason = data.get("kind", "grant"), str(data.get("reason", "")).strip()
    if kind not in ("grant", "reclaim") or value <= 0 or not reason or len(reason) > 4000:
        raise ValidationError("请选择分配或收回，填写正数 VC 和原因（最多 4000 字）")
    snapshot = {
        "project_id": str(project.id),
        "user_id": str(target),
        "amount": str(value),
        "kind": kind,
        "reason": reason,
        "stage_id": str(data.get("stage_id", "")),
    }
    previous = VCGrant.objects.filter(request_key=key).first()
    if previous:
        if previous.actor_id != user.id or previous.request_snapshot != snapshot:
            raise ValidationError("请求键已用于其他额度分配")
        return previous, False
    member = get_object_or_404(
        ProjectMember.objects.select_related("member"),
        project=project,
        member_id=target,
        is_active=True,
        role__gte=15,
        member__is_active=True,
    )
    require_member(member.member, project)
    stage = (
        Stage.objects.select_for_update()
        .filter(project=project, workspace=workspace)
        .order_by("-frozen_at", "-id")
        .first()
    )
    if not stage:
        raise ValidationError("请先配置项目 VC 预算")
    if data.get("stage_id") and str(stage.id) != str(data["stage_id"]):
        raise ValidationError("项目预算已变化，请刷新后重新分配")
    require_finance_open(workspace, project.id, stage.id)
    if kind == "grant" and value > stage_budget(stage) - stage_reserved(stage):
        raise ValidationError("项目未分配 VC 余额不足")
    if kind == "reclaim":
        # Reclaim only this source's still-uncommitted quota; earned VC is never confiscated.
        stage_granted = summed(VCGrant.objects.filter(stage=stage, user_id_snapshot=target), "delta")
        if value > min(stage_granted, Decimal(wallet(target, project)["project_available"])):
            raise ValidationError("只能收回当前预算分配且尚未使用的项目额度")
    row = VCGrant.objects.create(
        stage=stage,
        user=member.member,
        user_id_snapshot=target,
        user_name=member.member.display_name,
        delta=value if kind == "grant" else -value,
        actor=user,
        reason=reason,
        request_key=key,
        request_snapshot=snapshot,
    )
    audit(
        "vc.granted" if kind == "grant" else "vc.reclaimed",
        row,
        user,
        workspace,
        project_id=str(project.id),
        user_id=str(target),
        delta=str(row.delta),
        reason=reason,
    )
    return row, True


def quota_members(user, project):
    require_member(user, project, admin=True)
    members = (
        ProjectMember.objects.filter(
            project=project,
            is_active=True,
            role__gte=15,
            member__is_active=True,
            member_id__in=WorkspaceMember.objects.filter(workspace=project.workspace, is_active=True).values(
                "member_id"
            ),
        )
        .select_related("member")
        .order_by("member__display_name", "id")
    )
    stage = Stage.objects.filter(project=project).order_by("-frozen_at", "-id").first()
    result = []
    for row in members:
        balance = wallet(row.member_id, project)
        assigned = (
            summed(VCGrant.objects.filter(stage=stage, user_id_snapshot=row.member_id), "delta") if stage else ZERO
        )
        result.append(
            {
                "id": str(row.member_id),
                "name": row.member.display_name,
                "wallet": balance,
                "reclaimable": f"{min(assigned, Decimal(balance['project_available'])):.2f}",
            }
        )
    return result
