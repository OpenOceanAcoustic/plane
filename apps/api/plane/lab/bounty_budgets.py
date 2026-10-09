# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Resolve a project's current VC source without mixing frozen stages or cash."""

from decimal import Decimal
import uuid

from django.db import connection, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, ProjectMember
from .auth import audit, lock
from .bounties import amount, publish
from .bounty_flow import ensure_bounty_flow
from .models import Audit, Bounty, Stage, WorkspacePolicy
from .permissions import require_lead


STAGE_ORDER = ("-frozen_at", "-id")


@transaction.atomic
def freeze_vc_budget(user, workspace, project, data):
    require_lead(user, project)
    budget = amount(data.get("budget"))
    name = str(data.get("name", "")).strip()
    reason = str(data.get("reason", "")).strip()
    if budget <= 0 or not name or len(name) > 120:
        raise ValidationError("请填写预算名称和正数项目 VC 预算")
    key = None
    if "request_key" in data:
        try:
            key = str(uuid.UUID(str(data["request_key"])))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("项目 VC 预算 request_key 须为 UUID")
    snapshot = {"project_id": str(project.id), "name": name, "budget": f"{budget:.2f}", "reason": reason}
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=project.id, workspace=workspace
    )
    require_lead(user, project)
    if key:
        previous = Audit.objects.filter(
            action="stage.frozen", workspace_id_snapshot=workspace.id, details__request_key=key
        ).first()
        if previous:
            if previous.actor_id != user.id or previous.details.get("request_snapshot") != snapshot:
                raise ValidationError("请求键已用于其他预算或内容，请勿复用")
            return get_object_or_404(Stage, id=previous.object_id, workspace=workspace, project=project)
    stage = Stage.objects.create(
        workspace=workspace,
        project=project,
        workspace_id_snapshot=workspace.id,
        project_id_snapshot=project.id,
        project_name=project.name,
        name=name,
        budget=budget,
        frozen_at=timezone.now(),
    )
    WorkspacePolicy.objects.get_or_create(workspace=workspace)
    audit(
        "stage.frozen",
        stage,
        user,
        workspace,
        budget=str(budget),
        **({"reason": reason} if reason else {}),
        **({"request_key": key, "request_snapshot": snapshot} if key else {}),
    )
    return stage


def project_budgets(user, workspace):
    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True, role__gte=15).values(
        "project_id"
    )
    projects = list(
        Project.objects.filter(workspace=workspace, project_lead=user, id__in=memberships).order_by("name", "id")
    )
    stages = {
        row.project_id: row
        for row in Stage.objects.filter(workspace=workspace, project_id__in=[project.id for project in projects])
        .order_by("project_id", *STAGE_ORDER)
        .distinct("project_id")
    }
    reservations = {
        row["stage_id"]: row["reserved"]
        for row in Bounty.objects.filter(stage_id__in=[stage.id for stage in stages.values()])
        .values("stage_id")
        .annotate(reserved=Sum("reserved"))
    }
    rows = []
    for project in projects:
        stage = stages.get(project.id)
        reserved = reservations.get(stage.id, Decimal("0")) if stage else None
        rows.append(
            {
                "project_id": str(project.id),
                "project": project.name,
                "stage_id": str(stage.id) if stage else None,
                "stage_name": stage.name if stage else None,
                "budget": f"{stage.budget:.2f}" if stage else None,
                "reserved": f"{reserved:.2f}" if stage else None,
                "available": f"{stage.budget - reserved:.2f}" if stage else None,
                "configured": stage is not None,
            }
        )
    return rows


@transaction.atomic
def publish_from_project(user, workspace, identifier, data):
    project = get_object_or_404(Project, id=identifier, workspace=workspace)
    require_lead(user, project)
    # Keep the same order as financial configuration and native task mutation.
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    # NO KEY UPDATE permits foreign-key checks while protecting the lead/source selection.
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=project.id, workspace=workspace
    )
    require_lead(user, project)
    stage = (
        Stage.objects.select_for_update(of=("self",))
        .filter(project=project, workspace=workspace)
        .order_by(*STAGE_ORDER)
        .first()
    )
    if not stage:
        raise ValidationError("请先在资金与奖励配置项目 VC 预算")
    ensure_bounty_flow(user, project)
    # The legacy service owns validation, reservation, evidence and independent review.
    # Ignore any client stage_id: a project publication always resolves its source here.
    return publish(user, stage.id, data)
