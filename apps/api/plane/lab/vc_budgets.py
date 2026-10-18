# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Project VC installments, with revisions bounded by grants and direct commitments."""

from decimal import Decimal

from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import Project
from .auth import audit, lock
from .bounties import amount
from .finance_services import require_finance_open
from .models import Audit, Stage, VCBudgetEntry, WorkspacePolicy
from .vc import parse_key, require_member, stage_budget, stage_reserved

ORDER = ("-frozen_at", "-id")
ACTIONS = ("stage.frozen", "vc.budget_added", "vc.budget_adjusted")
MAXIMUM = Decimal("999999999999.99")


def locked_project(user, workspace, identifier):
    lock(f"finance:{workspace.id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [workspace.id])
    project = get_object_or_404(
        Project.objects.select_for_update(of=("self",), no_key=True), id=identifier, workspace=workspace
    )
    require_member(user, project, admin=True)
    require_finance_open(workspace, project.id)
    return project


def replay(user, workspace, key, snapshot):
    if key is None:
        return None
    lock(f"vc-budget-request:{key}")
    previous = Audit.objects.filter(action__in=ACTIONS, details__request_key=str(key)).first()
    if previous:
        if (
            previous.workspace_id_snapshot != workspace.id
            or previous.actor_id != user.id
            or previous.details.get("request_snapshot") != snapshot
        ):
            raise ValidationError("请求键已用于其他预算或内容，请勿复用")
        return previous
    return None


def materialize(stage):
    # Old fixtures/importers can create Stage directly. Preserve its frozen base once.
    if not VCBudgetEntry.objects.filter(stage=stage).exists():
        VCBudgetEntry.objects.create(stage=stage, name=stage.name, initial_amount=stage.budget, amount=stage.budget)


def budget_entries(stage):
    total, used = stage_budget(stage), stage_reserved(stage)
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "initial_amount": f"{row.initial_amount:.2f}",
            "amount": f"{row.amount:.2f}",
            "minimum": f"{max(Decimal('0'), used - (total - row.amount)):.2f}",
            "revision": row.revision,
            "created_at": row.created_at.isoformat(),
        }
        for row in VCBudgetEntry.objects.filter(stage=stage).order_by("created_at", "id")
    ]


@transaction.atomic
def add_budget(user, workspace, project, data):
    value = amount(data.get("budget"))
    name, reason = str(data.get("name", "")).strip(), str(data.get("reason", "")).strip()
    if value <= 0 or not name or len(name) > 120 or len(reason) > 4000:
        raise ValidationError("请填写预算名称和正数项目 VC 预算")
    key = parse_key(data["request_key"]) if "request_key" in data else None
    snapshot = {"project_id": str(project.id), "name": name, "budget": f"{value:.2f}", "reason": reason}
    project = locked_project(user, workspace, project.id)
    previous = replay(user, workspace, key, snapshot)
    if previous:
        identifier = previous.details.get("stage_id") or previous.object_id
        return get_object_or_404(Stage, id=identifier, workspace=workspace, project=project)
    stage = Stage.objects.select_for_update().filter(project=project, workspace=workspace).order_by(*ORDER).first()
    if stage:
        require_finance_open(workspace, project.id, stage.id)
        materialize(stage)
        if stage_budget(stage) + value > MAXIMUM:
            raise ValidationError("项目 VC 预算合计超出上限")
    else:
        stage = Stage.objects.create(
            workspace=workspace,
            project=project,
            workspace_id_snapshot=workspace.id,
            project_id_snapshot=project.id,
            project_name=project.name,
            name=name,
            budget=value,
            frozen_at=timezone.now(),
        )
        audit(
            "stage.frozen",
            stage,
            user,
            workspace,
            budget=str(value),
            reason=reason,
            **({"request_key": str(key), "request_snapshot": snapshot} if key else {}),
        )
    entry = VCBudgetEntry.objects.create(
        stage=stage,
        name=name,
        initial_amount=value,
        amount=value,
        actor=user,
        request_key=key,
        request_snapshot=snapshot,
    )
    WorkspacePolicy.objects.get_or_create(workspace=workspace)
    audit(
        "vc.budget_added",
        entry,
        user,
        workspace,
        stage_id=str(stage.id),
        project_id=str(project.id),
        budget=f"{value:.2f}",
        reason=reason,
        **({"request_key": str(key), "request_snapshot": snapshot} if key else {}),
    )
    return stage


@transaction.atomic
def adjust_budget(user, workspace, project_id, entry_id, data):
    project = locked_project(user, workspace, project_id)
    key = parse_key(data.get("request_key"))
    value, reason = amount(data.get("amount")), str(data.get("reason", "")).strip()
    revision = data.get("expected_revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1 or not reason or len(reason) > 4000:
        raise ValidationError("请刷新预算记录并填写调整原因")
    snapshot = {
        "project_id": str(project.id),
        "entry_id": str(entry_id),
        "amount": f"{value:.2f}",
        "expected_revision": revision,
        "reason": reason,
    }
    previous = replay(user, workspace, key, snapshot)
    entry = get_object_or_404(
        VCBudgetEntry.objects.select_for_update().select_related("stage"),
        id=entry_id,
        stage__project=project,
        stage__workspace=workspace,
    )
    if previous:
        return entry
    require_finance_open(workspace, project.id, entry.stage_id)
    if entry.revision != revision:
        raise ValidationError("该笔预算已变化，请刷新后重新调整")
    total = stage_budget(entry.stage) - entry.amount + value
    if total < stage_reserved(entry.stage):
        raise ValidationError("项目总额度不能低于已发放成员额度及悬赏已占用额度合计")
    if total > MAXIMUM:
        raise ValidationError("项目 VC 预算合计超出上限")
    before = entry.amount
    entry.amount, entry.revision = value, entry.revision + 1
    entry.save(update_fields=["amount", "revision"])
    audit(
        "vc.budget_adjusted",
        entry,
        user,
        workspace,
        stage_id=str(entry.stage_id),
        project_id=str(project.id),
        before=f"{before:.2f}",
        after=f"{value:.2f}",
        reason=reason,
        request_key=str(key),
        request_snapshot=snapshot,
    )
    return entry
