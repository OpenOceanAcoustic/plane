# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Resolve a project's current VC source without mixing frozen stages or cash."""

from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, ProjectMember
from .auth import audit, lock
from .bounties import amount, publish
from .bounty_flow import ensure_bounty_flow
from .models import BountyFunding, Stage
from .vc import can_allocate, parse_key, payment, require_member, stage_budget, stage_reserved, wallet
from .vc_budgets import budget_entries


STAGE_ORDER = ("-frozen_at", "-id")


def project_budgets(user, workspace):
    from .finance_services import finance_removal_state, stage_deletion_reason

    removal = finance_removal_state(workspace)
    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True, role__gte=15).values(
        "project_id"
    )
    projects = list(
        Project.objects.filter(workspace=workspace, id__in=memberships, archived_at__isnull=True).order_by("name", "id")
    )
    stages = {
        row.project_id: row
        for row in Stage.objects.filter(workspace=workspace, project_id__in=[project.id for project in projects])
        .order_by("project_id", *STAGE_ORDER)
        .distinct("project_id")
    }
    rows = []
    for project in projects:
        stage = stages.get(project.id)
        project_deleted = project.id in removal["projects"]
        stage_deleted = bool(stage and stage.id in removal["stages"])
        deleted = project_deleted or stage_deleted
        manages_stage = project.project_lead_id == user.id
        deletion_reason = stage_deletion_reason(workspace, stage, removal) if stage and manages_stage else None
        reserved = stage_reserved(stage) if stage else None
        rows.append(
            {
                "project_id": str(project.id),
                "project": project.name,
                "stage_id": str(stage.id) if stage else None,
                "stage_name": stage.name if stage else None,
                "budget": f"{stage_budget(stage):.2f}" if stage else None,
                "reserved": f"{reserved:.2f}" if stage else None,
                "available": f"{stage_budget(stage) - reserved:.2f}" if stage else None,
                "configured": stage is not None,
                "deleted": deleted,
                "project_deleted": project_deleted,
                "can_delete": bool(manages_stage and stage and not deleted and not deletion_reason),
                "delete_reason": deletion_reason,
                "can_restore": bool(manages_stage and stage_deleted and not project_deleted),
                "wallet": wallet(user.id, project),
                "can_allocate": can_allocate(user, project),
                "publication_source": "project" if can_allocate(user, project) else "personal",
                "entries": budget_entries(stage) if stage else [],
            }
        )
    return rows


@transaction.atomic
def publish_from_project(user, workspace, identifier, data, *, initialize_flow=True):
    from .finance_services import require_finance_open

    project = get_object_or_404(Project, id=identifier, workspace=workspace)
    require_member(user, project)
    require_finance_open(workspace, project.id)
    # Keep the same order as financial configuration and native task mutation.
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    # NO KEY UPDATE permits foreign-key checks while protecting the lead/source selection.
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=project.id, workspace=workspace
    )
    require_member(user, project)
    require_finance_open(workspace, project.id)
    stage = (
        Stage.objects.select_for_update(of=("self",))
        .filter(project=project, workspace=workspace)
        .order_by(*STAGE_ORDER)
        .first()
    )
    if not stage:
        raise ValidationError("请先在资金与奖励配置项目 VC 预算")
    require_finance_open(workspace, project.id, stage.id)
    snapshot = {k: v for k, v in data.items() if k != "request_key"}
    key = parse_key(data["request_key"]) if data.get("request_key") else None
    if key:
        previous = BountyFunding.objects.select_related("bounty__stage").filter(request_key=key).first()
        if previous:
            if (
                previous.owner_id_snapshot != user.id
                or previous.bounty.stage.project_id != project.id
                or previous.request_snapshot != snapshot
            ):
                raise ValidationError("请求键已用于其他悬赏或支付内容")
            return previous.bounty
    budget = amount(data.get("budget"))
    source = "project" if can_allocate(user, project) else "personal"
    if source == "project":
        if budget <= 0 or budget > stage_budget(stage) - stage_reserved(stage):
            raise ValidationError("项目未分配 VC 余额不足")
        project_vc, earned_vc = budget, 0
    else:
        project_vc, earned_vc = payment(user, project, budget, data)
    if initialize_flow:
        ensure_bounty_flow(user, project, member_publication=True)
    # The legacy service owns validation, reservation, evidence and independent review.
    # Ignore any client stage_id: a project publication always resolves its source here.
    bounty = publish(user, stage.id, data, member_payment=(project_vc, earned_vc))
    BountyFunding.objects.create(
        bounty=bounty,
        owner=user,
        owner_id_snapshot=user.id,
        source=source,
        project_committed=project_vc,
        earned_committed=earned_vc,
        request_key=key,
        request_snapshot=snapshot,
    )
    audit(
        "bounty.vc_reserved",
        bounty,
        user,
        workspace,
        project_vc=str(project_vc),
        earned_vc=str(earned_vc),
        owner_id=str(user.id),
    )
    return bounty
