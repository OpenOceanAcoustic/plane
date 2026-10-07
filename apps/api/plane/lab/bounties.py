# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Budget locks, independent review and append-only contribution accounting."""

import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import IssueAssignee, ProjectMember, WorkspaceMember
from .auth import audit
from .models import Acceptance, Allocation, Bounty, Ledger, ProjectFlow, Stage, WorkspacePolicy
from .permissions import issue_access, require_lead


def amount(value):
    try:
        result = Decimal(str(value))
        if (
            not result.is_finite()
            or result < 0
            or result > Decimal("999999999999.99")
            or result != result.quantize(Decimal("0.01"))
        ):
            raise InvalidOperation()
        return result.quantize(Decimal("0.01"))
    except (ValueError, TypeError, InvalidOperation):
        raise ValidationError("VC 须为非负数，最多两位小数")


def total(queryset, field):
    return queryset.aggregate(value=Sum(field))["value"] or Decimal("0")


def working_days(now, count):
    from zoneinfo import ZoneInfo

    deadline = now.astimezone(ZoneInfo("Asia/Shanghai"))
    while count:
        deadline += timedelta(days=1)
        if deadline.weekday() < 5:
            count -= 1
    return deadline


def reviewer_allowed(user, bounty, independent=False):
    expected = bounty.independent_reviewer_id if independent else bounty.reviewer_id
    if (
        expected != user.id
        or not user.is_active
        or Allocation.objects.filter(bounty=bounty, user=user, approved=True).exists()
    ):
        raise PermissionDenied("必须由指定的独立验收人操作，参与者不能验收本人团队任务")
    if not bounty.issue_id:
        raise ValidationError("原任务已删除，请通过账本核查历史记录")
    issue_access(user, bounty.stage.workspace, bounty.issue_id)
    valid_reviewer(user.id, bounty.stage.project)


def locked_bounty(bounty_id):
    preliminary = Bounty.objects.get(id=bounty_id)
    # Native statement triggers take this lock before tuple locks too.
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [preliminary.stage.workspace_id])
    Stage.objects.select_for_update().get(id=preliminary.stage_id)
    return (
        Bounty.objects.select_for_update(of=("self",))
        .select_related("stage__project", "stage__workspace", "issue")
        .get(id=bounty_id)
    )


def valid_reviewer(user_id, project):
    member = (
        ProjectMember.objects.select_related("member")
        .filter(project=project, member_id=user_id, is_active=True, member__is_active=True, role__gte=15)
        .first()
    )
    if (
        not member
        or not WorkspaceMember.objects.filter(
            workspace=project.workspace, member=member.member, is_active=True
        ).exists()
    ):
        raise ValidationError("验收人须是当前项目的有效成员")
    return member.member


@transaction.atomic
def publish(user, stage_id, data):
    preliminary = Stage.objects.get(id=stage_id)
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [preliminary.workspace_id])
    stage = Stage.objects.select_for_update(of=("self",)).select_related("project", "workspace").get(id=stage_id)
    require_lead(user, stage.project)
    issue = issue_access(user, stage.workspace, data.get("issue_id"), edit=True)
    if issue.project_id != stage.project_id or issue.parent_id or Bounty.objects.filter(issue=issue).exists():
        raise ValidationError("请选择同项目未发布悬赏的顶层任务，避免父子重复贡献")
    budget = amount(data.get("budget"))
    if budget <= 0 or total(Bounty.objects.filter(stage=stage), "reserved") + budget > stage.budget:
        raise ValidationError("阶段预算 B 不足或团队预算 T 无效")
    deliverable = str(data.get("deliverable", "")).strip()
    criteria = str(data.get("criteria", "")).strip()
    if not deliverable or not criteria:
        raise ValidationError("开工前必须确定交付物和验收条件")
    reasons = []
    if budget >= 40:
        reasons.append("40VC")
    if budget > stage.budget * Decimal("0.2"):
        reasons.append("20%B")
    if amount(data.get("cash_commitment", 0)) >= 5000:
        reasons.append("cash")
    if amount(data.get("person_days", 0)) > 10:
        reasons.append("person_days")
    if data.get("route_or_safety") is True:
        reasons.append("route_or_safety")
    reviewer = valid_reviewer(data.get("reviewer_id"), stage.project)
    independent = valid_reviewer(data.get("independent_reviewer_id"), stage.project) if reasons else None
    if independent and (independent.id in (user.id, reviewer.id)):
        raise ValidationError("重大任务复核人须与发布人、验收人不同")
    if reasons and reviewer.id == user.id:
        raise ValidationError("重大任务验收人须独立于发布人")
    flow = ProjectFlow.objects.filter(project=stage.project).first()
    if not flow or not all(getattr(flow, key + "_id") for key in ("todo", "active", "review", "done")):
        raise ValidationError("请先配置四类项目状态映射")
    bounty = Bounty.objects.create(
        stage=stage,
        issue=issue,
        issue_id_snapshot=issue.id,
        title=issue.name,
        deliverable=deliverable,
        criteria=criteria,
        budget=budget,
        reserved=budget,
        publisher=user,
        reviewer=reviewer,
        independent_reviewer=independent,
        major=bool(reasons),
        major_reasons=reasons,
        status="publication_review" if reasons else "open",
        published_at=None if reasons else timezone.now(),
    )
    WorkspacePolicy.objects.get_or_create(workspace=stage.workspace)
    audit("bounty.published", bounty, user, stage.workspace, major=reasons, budget=str(budget))
    return bounty


@transaction.atomic
def publication_review(user, bounty_id, reason):
    bounty = locked_bounty(bounty_id)
    reviewer_allowed(user, bounty, independent=True)
    if bounty.status != "publication_review" or not str(reason).strip():
        raise ValidationError("需要处于发布复核阶段并填写意见")
    bounty.status = "open"
    bounty.published_at = timezone.now()
    bounty.save(update_fields=["status", "published_at"])
    audit("bounty.publication_review", bounty, user, bounty.stage.workspace, reason=str(reason))


@transaction.atomic
def claim(user, bounty_id, data):
    bounty = locked_bounty(bounty_id)
    if bounty.status != "open" or user.id in (bounty.reviewer_id, bounty.independent_reviewer_id):
        raise ValidationError("当前不能认领；验收及复核人员不能参与团队分工")
    issue_access(user, bounty.stage.workspace, bounty.issue_id, edit=True)
    planned = amount(data.get("planned"))
    deliverable = str(data.get("deliverable", "")).strip()
    if planned <= 0 or planned > bounty.budget or not deliverable:
        raise ValidationError("请填写个人交付物和计划 VC，不能超过团队 T")
    if Allocation.objects.filter(bounty=bounty, user_id_snapshot=user.id).exists():
        raise ValidationError("已提交认领")
    allocation = Allocation.objects.create(
        bounty=bounty,
        user=user,
        user_id_snapshot=user.id,
        user_name=user.display_name,
        deliverable=deliverable,
        planned=planned,
    )
    audit("bounty.claim", allocation, user, bounty.stage.workspace)
    return allocation


@transaction.atomic
def approve_claim(user, bounty_id, allocation_id):
    bounty = locked_bounty(bounty_id)
    require_lead(user, bounty.stage.project)
    allocation = get_object_or_404(Allocation.objects.select_for_update(), id=allocation_id, bounty=bounty)
    if bounty.status != "open" or not allocation.user or not allocation.user.is_active:
        raise ValidationError("当前不能批准")
    if allocation.approved:
        return
    if total(Allocation.objects.filter(bounty=bounty, approved=True), "planned") + allocation.planned > bounty.budget:
        raise ValidationError("成员分工超出团队预算 T")
    allocation.approved = True
    allocation.save(update_fields=["approved"])
    audit("bounty.claim_approved", allocation, user, bounty.stage.workspace)


@transaction.atomic
def confirm_claim(user, bounty_id):
    bounty = locked_bounty(bounty_id)
    allocation = get_object_or_404(Allocation, bounty=bounty, user=user, approved=True)
    if bounty.status != "open":
        raise ValidationError("当前不在开工确认阶段")
    allocation.confirmed = True
    allocation.save(update_fields=["confirmed"])
    audit("bounty.claim_confirmed", allocation, user, bounty.stage.workspace)


@transaction.atomic
def start(user, bounty_id):
    bounty = locked_bounty(bounty_id)
    require_lead(user, bounty.stage.project)
    participants = list(Allocation.objects.filter(bounty=bounty, approved=True).select_related("user"))
    if (
        bounty.status != "open"
        or not participants
        or any(not row.confirmed or not row.user or not row.user.is_active for row in participants)
    ):
        raise ValidationError("开工须批准分工并由所有参与者确认")
    for allocation in participants:
        if not WorkspaceMember.objects.filter(
            workspace=bounty.stage.workspace, member=allocation.user, is_active=True
        ).exists():
            raise ValidationError("开工前参与者须仍是工作区成员")
        issue_access(allocation.user, bounty.stage.workspace, bounty.issue_id, edit=True)
    # DB triggers serialize all native/bulk assignment and state paths too.
    for allocation in participants:
        IssueAssignee.objects.get_or_create(
            issue=bounty.issue, assignee=allocation.user, project=bounty.issue.project, workspace=bounty.stage.workspace
        )
    bounty.status = "active"
    bounty.save(update_fields=["status"])
    bounty.issue.state = ProjectFlow.objects.get(project=bounty.stage.project).active
    bounty.issue.save(update_fields=["state", "completed_at"])
    audit("bounty.started", bounty, user, bounty.stage.workspace)


@transaction.atomic
def submit(user, bounty_id, evidence):
    bounty = locked_bounty(bounty_id)
    if not Allocation.objects.filter(bounty=bounty, user=user, approved=True, closed=False).exists():
        raise PermissionDenied("仅未完成分工的参与者可以提交验收")
    if bounty.status not in ("active", "rework", "partial") or not str(evidence).strip():
        raise ValidationError("请填写成果或探索证据，任务须处于进行、返工或部分通过状态")
    bounty.status = "review"
    bounty.submitted_at = timezone.now()
    bounty.due_at = working_days(bounty.submitted_at, 5 if bounty.major else 3)
    bounty.evidence = str(evidence)
    bounty.save(update_fields=["status", "submitted_at", "due_at", "evidence"])
    bounty.issue.state = ProjectFlow.objects.get(project=bounty.stage.project).review
    bounty.issue.save(update_fields=["state", "completed_at"])
    audit("bounty.submitted", bounty, user, bounty.stage.workspace)


def acceptance_targets(bounty, data):
    result = data.get("result")
    if result not in ("pass", "partial", "rework", "reject", "negative") or not str(data.get("reason", "")).strip():
        raise ValidationError("请选择验收结果并填写意见")
    if result in ("rework", "reject"):
        return {}
    participants = list(Allocation.objects.filter(bounty=bounty, approved=True))
    supplied = data.get("targets", {})
    if not isinstance(supplied, dict) or set(supplied) != {str(row.id) for row in participants}:
        raise ValidationError("请为全部已批准分工填写累计通过 VC")
    targets = {}
    for row in participants:
        target = amount(supplied[str(row.id)])
        awarded = total(Ledger.objects.filter(allocation=row), "delta")
        if target < awarded or target > row.planned or (result in ("pass", "negative") and target != row.planned):
            raise ValidationError("累计贡献须在已授予与计划值之间；全部通过须达到约定计划值")
        targets[str(row.id)] = str(target)
    if sum(Decimal(value) for value in targets.values()) > bounty.budget:
        raise ValidationError("贡献超出团队预算")
    if result == "partial" and all(Decimal(targets[str(row.id)]) == row.planned for row in participants):
        raise ValidationError("部分通过须至少有一项分工尚未达到计划值")
    return targets


def apply_acceptance(acceptance, bounty, user):
    if acceptance.approved_at:
        return
    for row in Allocation.objects.select_for_update().filter(bounty=bounty, approved=True):
        if str(row.id) not in acceptance.targets:
            continue
        target = Decimal(acceptance.targets[str(row.id)])
        awarded = total(Ledger.objects.filter(allocation=row), "delta")
        if target < awarded or target > row.planned:
            raise ValidationError("复核期间贡献已变更，请重新提交验收")
        delta = target - awarded
        if delta:
            Ledger.objects.create(
                bounty=bounty,
                allocation=row,
                acceptance=acceptance,
                delta=delta,
                actor=user,
                actor_name=user.display_name,
                reason=acceptance.reason,
                task_snapshot={
                    "id": str(bounty.issue_id_snapshot),
                    "title": bounty.title,
                    "project_id": str(bounty.stage.project_id_snapshot),
                    "project": bounty.stage.project_name,
                },
                participant_snapshot={"id": str(row.user_id_snapshot), "name": row.user_name},
                request_key=uuid.uuid5(acceptance.request_key, str(row.id)),
            )
        row.closed = target == row.planned
        row.save(update_fields=["closed"])
    result = acceptance.result
    if result == "reject":
        Allocation.objects.filter(bounty=bounty, approved=True).update(closed=True)
        bounty.reserved = total(Ledger.objects.filter(bounty=bounty), "delta")
    bounty.status = (
        "done"
        if result in ("pass", "negative")
        else "partial"
        if result == "partial"
        else "rework"
        if result == "rework"
        else "rejected"
    )
    bounty.save(update_fields=["status", "reserved"])
    if bounty.issue_id:
        flow = ProjectFlow.objects.get(project_id=bounty.stage.project_id)
        bounty.issue.state = (
            flow.done
            if bounty.status == "done"
            else flow.todo
            if bounty.status == "rejected"
            else flow.active
            if bounty.status in ("partial", "rework")
            else flow.review
        )
        bounty.issue.save(update_fields=["state", "completed_at"])
    acceptance.approved_at = timezone.now()
    acceptance.save(update_fields=["approved_at"])
    audit("bounty.accepted", acceptance, user, bounty.stage.workspace, result=result, targets=acceptance.targets)


@transaction.atomic
def accept(user, bounty_id, data):
    bounty = locked_bounty(bounty_id)
    reviewer_allowed(user, bounty)
    try:
        key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("需要 UUID 幂等键")
    existing = Acceptance.objects.filter(request_key=key).first()
    if existing:
        canonical = (
            {key: str(amount(value)) for key, value in data.get("targets", {}).items()}
            if isinstance(data.get("targets", {}), dict)
            else None
        )
        if (
            existing.bounty_id != bounty.id
            or existing.reviewer_id != user.id
            or existing.result != data.get("result")
            or existing.reason != str(data.get("reason", ""))
            or existing.targets != canonical
        ):
            raise ValidationError("幂等键已用于其他验收内容")
        return existing
    if bounty.status != "review":
        raise ValidationError("任务不在待验收阶段")
    targets = acceptance_targets(bounty, data)
    acceptance = Acceptance.objects.create(
        bounty=bounty,
        reviewer=user,
        reviewer_name=user.display_name,
        result=data["result"],
        reason=str(data["reason"]),
        targets=targets,
        request_key=key,
    )
    if bounty.major:
        bounty.status = "acceptance_review"
        bounty.save(update_fields=["status"])
    else:
        apply_acceptance(acceptance, bounty, user)
    return acceptance


@transaction.atomic
def review_acceptance(user, bounty_id, acceptance_id, reason):
    bounty = locked_bounty(bounty_id)
    reviewer_allowed(user, bounty, independent=True)
    acceptance = get_object_or_404(Acceptance.objects.select_for_update(), id=acceptance_id, bounty=bounty)
    if acceptance.approved_at:
        return
    if bounty.status != "acceptance_review" or not str(reason).strip():
        raise ValidationError("需要重大任务验收复核及意见")
    acceptance.independent_reviewer = user
    acceptance.save(update_fields=["independent_reviewer"])
    apply_acceptance(acceptance, bounty, user)
    audit("bounty.acceptance_review", acceptance, user, bounty.stage.workspace, reason=str(reason))


@transaction.atomic
def cancel(user, bounty_id, reason):
    bounty = locked_bounty(bounty_id)
    require_lead(user, bounty.stage.project)
    if bounty.status in ("done", "cancelled", "rejected") or not str(reason).strip():
        raise ValidationError("已结案任务不可取消；取消须填写原因")
    bounty.status = "cancelled"
    bounty.reserved = total(Ledger.objects.filter(bounty=bounty), "delta")
    bounty.save(update_fields=["status", "reserved"])
    Allocation.objects.filter(bounty=bounty).update(closed=True)
    if bounty.issue_id:
        bounty.issue.state = ProjectFlow.objects.get(project=bounty.stage.project).todo
        bounty.issue.save(update_fields=["state", "completed_at"])
    audit("bounty.cancelled", bounty, user, bounty.stage.workspace, reason=str(reason))


@transaction.atomic
def reverse(user, ledger_id, data):
    entry = Ledger.objects.get(id=ledger_id)
    bounty = locked_bounty(entry.bounty_id)
    require_lead(user, bounty.stage.project)
    if entry.delta <= 0 or not str(data.get("reason", "")).strip():
        raise ValidationError("仅可以冲正正向贡献，必须填写原因")
    try:
        key = uuid.UUID(str(data.get("request_key")))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("需要 UUID 幂等键")
    existing = Ledger.objects.filter(reverses=entry).first()
    if existing:
        if existing.request_key != key:
            raise ValidationError("该贡献已经冲正")
        return existing
    reversal = Ledger.objects.create(
        bounty=bounty,
        allocation=entry.allocation,
        delta=-entry.delta,
        reverses=entry,
        actor=user,
        actor_name=user.display_name,
        reason=str(data["reason"]),
        task_snapshot=entry.task_snapshot,
        participant_snapshot=entry.participant_snapshot,
        request_key=key,
    )
    if bounty.status in ("rejected", "cancelled"):
        bounty.reserved = total(Ledger.objects.filter(bounty=bounty), "delta")
        bounty.save(update_fields=["reserved"])
    # Accounting corrections must succeed even when participants have full WIP.
    # A lead can explicitly reopen corrected work for independent re-acceptance.
    audit("ledger.reversed", reversal, user, bounty.stage.workspace, reason=str(data["reason"]))
    return reversal


@transaction.atomic
def reopen(user, bounty_id, reason):
    bounty = locked_bounty(bounty_id)
    require_lead(user, bounty.stage.project)
    if bounty.status not in ("done", "active", "partial", "rework") or not str(reason).strip() or not bounty.issue_id:
        raise ValidationError("仅可重新验收已关闭分工的贡献更正，须存在原任务并填写原因")
    deficient = [
        row
        for row in Allocation.objects.filter(bounty=bounty, approved=True, closed=True)
        if total(row.ledger.all(), "delta") < row.planned
    ]
    if not deficient:
        raise ValidationError("没有待复验的贡献差额")
    for row in deficient:
        row.closed = False
        row.save(update_fields=["closed"])
    bounty.status = "review"
    bounty.due_at = working_days(timezone.now(), 5 if bounty.major else 3)
    bounty.save(update_fields=["status", "due_at"])
    bounty.issue.state = ProjectFlow.objects.get(project=bounty.stage.project).review
    bounty.issue.save(update_fields=["state", "completed_at"])
    audit("bounty.reopened", bounty, user, bounty.stage.workspace, reason=str(reason))
