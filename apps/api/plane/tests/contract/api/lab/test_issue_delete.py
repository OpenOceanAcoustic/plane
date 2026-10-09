# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
import uuid

import pytest
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.bgtasks.deletion_task import soft_delete_related_objects
from plane.db.models import Issue, ProjectMember
from plane.lab.bounty_models import BountyTaskAccess, BountyMaterial, BountyPublication
from plane.lab.finance_models import FinancialEntry, RewardForecast, RewardSettlement, PaymentCommitment, OfflinePayment
from plane.lab.models import Audit, Bounty, Ledger, PersonalItem, TimeBlock
from .test_bounty_delete import prepare
from .test_bounty_public_access import approve_cross, cross_member
from .test_bounties import action, start
from .test_finance import plan, receipt, settle, commit, pay

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def endpoint(lab, issue, native=False):
    return (
        f"/api/workspaces/lab/projects/{lab['project'].id}/issues/{issue.id}/"
        if native
        else lab["base"] + f"tasks/{issue.id}/"
    )


@pytest.mark.parametrize("native", [True, False])
def test_delete_real_issue_releases_unearned_budget_and_preserves_earned_history(laboratory, native):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab, stage_budget="100")
    allocation_id = start(lab, bounty_id)
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "已完成一半"}).status_code == 200
    accepted = action(
        lab,
        lab["reviewer"],
        bounty_id,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "partial", "reason": "部分通过", "targets": {allocation_id: "10"}},
    )
    assert accepted.status_code == 200, accepted.content
    stage_id, _ = plan(lab, bounty=bounty_id, E="1000")
    receipt(lab, stage_id, gross="1000", costs="0", D="1000")
    forecast = lab["client"](lab["lead"]).post(
        lab["base"] + "finance/forecast/",
        {"stage_id": stage_id, "kind": "task", "basis": "budget", "bounty_id": bounty_id},
        format="json",
    )
    assert forecast.status_code == 201, forecast.content
    settlement_id = settle(lab, stage_id, amount="100")
    commitment_id = commit(lab, settlement_id, amount="100")
    pay(lab, commitment_id, gross="100", withheld="10")
    item = PersonalItem.objects.get(user=lab["member"], issue=issue)
    begin = timezone.now().replace(minute=0, second=0, microsecond=0)
    block = TimeBlock.objects.create(item=item, start=begin, end=begin + timedelta(hours=1), color="#123456")
    member = lab["client"](lab["member"])
    window = {"start": begin.isoformat(), "end": (begin + timedelta(hours=2)).isoformat()}
    assert member.get(lab["base"] + "planner/").json()["items"][0]["issue_id"] == str(issue.id)
    assert member.get(lab["base"] + "calendar/", window).json()["events"][0]["issue_id"] == str(issue.id)
    models = (Ledger, FinancialEntry, RewardForecast, RewardSettlement, PaymentCommitment, OfflinePayment)
    facts = [list(model.objects.order_by("id").values()) for model in models]
    response = lab["client"](lab["lead"]).delete(
        endpoint(lab, issue, native),
        {"reason": "移除原工作项"},
        format="json",
    )
    assert response.status_code == 204, response.content
    issue.refresh_from_db()
    bounty = Bounty.objects.get(id=bounty_id)
    assert issue.deleted_at is not None and bounty.status == "deleted" and bounty.issue_id is None
    assert bounty.reserved == Decimal("10") and bounty.issue_id_snapshot == issue.id
    assert [list(model.objects.order_by("id").values()) for model in models] == facts
    soft_delete_related_objects.run("db", "issue", issue.id)
    assert [list(model.objects.order_by("id").values()) for model in models] == facts
    assert FinancialEntry.objects.exists() and OfflinePayment.objects.exists()
    assert Ledger.objects.get(bounty_id=bounty_id).task_snapshot["title"] == issue.name
    item.refresh_from_db()
    assert item.issue_id is None and TimeBlock.objects.filter(id=block.id, color="#123456").exists()
    assert member.get(lab["base"] + "planner/").json()["items"] == []
    assert member.get(lab["base"] + "calendar/", window).json()["events"] == []
    assert Audit.objects.get(action="bounty.deleted", object_id=bounty_id).details["released_vc"] == "10.00"
    assert lab["client"](lab["lead"]).get(lab["base"] + "bounties/budgets/").json()[0]["available"] == "90.00"


def test_creator_and_admin_can_delete_ordinary_issues_but_members_cannot_delete_other_work(laboratory):
    lab = laboratory
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["active"], name="创建者自己的任务"
    )
    Issue.objects.filter(id=issue.id).update(created_by=lab["member"])
    assert lab["client"](lab["reviewer"]).delete(endpoint(lab, issue), format="json").status_code == 403
    assert lab["client"](lab["member"]).delete(endpoint(lab, issue), format="json").status_code == 204
    other = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["done"], name="归档的已完成任务"
    )
    assert lab["client"](lab["lead"]).delete(endpoint(lab, other, True), format="json").status_code == 204
    other.refresh_from_db()
    assert other.deleted_at and other.state_id == lab["states"]["done"].id


@pytest.mark.parametrize("native", [True, False])
def test_linked_bounty_only_lead_can_delete_and_execution_grants_are_revoked(laboratory, native):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    external = cross_member(lab)
    approve_cross(lab, bounty_id, external)
    assert action(lab, external, bounty_id, "confirm").status_code == 200
    Issue.objects.filter(id=issue.id).update(created_by=lab["member"])
    for user in (lab["member"], lab["reviewer"], external):
        result = lab["client"](user).delete(endpoint(lab, issue, native), {"reason": "越权删除"}, format="json")
        assert result.status_code in (403, 404)
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=15)
    response = lab["client"](lab["lead"]).delete(endpoint(lab, issue, native), {"reason": "终止任务"}, format="json")
    assert response.status_code == 204, response.content
    assert not BountyTaskAccess.objects.filter(allocation__bounty_id=bounty_id, revoked_at__isnull=True).exists()
    assert not BountyMaterial.objects.filter(bounty_id=bounty_id, revoked_at__isnull=True).exists()
    assert not BountyPublication.objects.get(bounty_id=bounty_id).enabled
    assert lab["client"](external).get(lab["base"] + "planner/").json()["items"] == []


def test_issue_deletion_failure_rolls_back_budget_and_grant_cleanup(laboratory, monkeypatch):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    external = cross_member(lab)
    approve_cross(lab, bounty_id, external)
    originals = list(BountyTaskAccess.objects.order_by("id").values())

    save = Issue.save

    def reject(instance, *args, **kwargs):
        if instance.deleted_at:
            raise ValidationError("工作项删除失败")
        return save(instance, *args, **kwargs)

    monkeypatch.setattr(Issue, "save", reject)
    result = lab["client"](lab["lead"]).delete(endpoint(lab, issue), {"reason": "验证事务"}, format="json")
    assert result.status_code == 400
    issue.refresh_from_db()
    bounty = Bounty.objects.get(id=bounty_id)
    assert issue.deleted_at is None and bounty.status == "open" and bounty.issue_id == issue.id
    assert bounty.reserved == 20
    assert list(BountyTaskAccess.objects.order_by("id").values()) == originals
    assert not Audit.objects.filter(action="bounty.deleted").exists()


def test_former_creator_cannot_delete_after_project_membership_is_revoked(laboratory):
    lab = laboratory
    issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name="旧成员创建的工作项"
    )
    Issue.objects.filter(id=issue.id).update(created_by=lab["member"])
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    client = lab["client"](lab["member"])
    for native in (True, False):
        assert client.delete(endpoint(lab, issue, native), format="json").status_code == 403
    assert client.get(lab["base"] + f"task-card-metadata/?issue_ids={issue.id}").json()["items"] == []
    issue.refresh_from_db()
    assert issue.deleted_at is None


@pytest.mark.parametrize("bulk", [True, False])
def test_native_confirmation_can_delete_linked_bounty_without_an_extra_reason_form(laboratory, bulk):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    lead = lab["client"](lab["lead"])
    if bulk:
        path = f"/api/workspaces/lab/projects/{lab['project'].id}/bulk-delete-issues/"
        result = lead.delete(path, {"issue_ids": [str(issue.id)]}, format="json")
        assert result.status_code == 200, result.content
        source = "原生批量工作项删除确认"
    else:
        result = lead.delete(endpoint(lab, issue, True), format="json")
        assert result.status_code == 204, result.content
        source = "原生工作项删除确认"
    assert Bounty.objects.get(id=bounty_id).status == "deleted"
    assert Audit.objects.get(action="bounty.deleted", object_id=bounty_id).details["reason"] == source
    assert Audit.objects.get(action="issue.deleted", object_id=issue.id).details["reason"] == source


def test_parent_deletion_requires_explicit_cleanup_of_a_historical_child_bounty(laboratory):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    allocation_id = start(lab, bounty_id)
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "全部完成"}).status_code == 200
    accepted = action(
        lab,
        lab["reviewer"],
        bounty_id,
        "accept",
        {"request_key": str(uuid.uuid4()), "result": "pass", "reason": "验收通过", "targets": {allocation_id: "20"}},
    )
    assert accepted.status_code == 200, accepted.content
    stage_id, _ = plan(lab, bounty=bounty_id, E="1000")
    receipt(lab, stage_id, gross="1000", costs="0", D="1000")
    parent = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name="父工作项"
    )
    Issue.objects.filter(id=issue.id).update(parent=parent)
    facts = [list(model.objects.order_by("id").values()) for model in (Ledger, FinancialEntry)]
    lead = lab["client"](lab["lead"])
    for native in (True, False):
        rejected = lead.delete(endpoint(lab, parent, native), format="json")
        assert rejected.status_code == 400, rejected.content
        assert "子工作项关联悬赏，请先删除关联悬赏工作项" in rejected.content.decode()
    parent.refresh_from_db()
    issue.refresh_from_db()
    assert parent.deleted_at is None and issue.deleted_at is None
    assert Bounty.objects.get(id=bounty_id).status == "done"
    assert not Audit.objects.filter(action="issue.deleted").exists()
    assert lead.delete(endpoint(lab, issue), {"reason": "清理历史子工作项"}, format="json").status_code == 204
    assert lead.delete(endpoint(lab, parent, True), format="json").status_code == 204
    soft_delete_related_objects.run("db", "issue", parent.id)
    assert [list(model.objects.order_by("id").values()) for model in (Ledger, FinancialEntry)] == facts
    bounty = Bounty.objects.get(id=bounty_id)
    assert bounty.status == "deleted" and bounty.issue_id is None and bounty.reserved == 20


def test_concurrent_issue_deletion_is_idempotent(laboratory):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)

    def remove(_):
        close_old_connections()
        try:
            response = lab["client"](lab["lead"]).delete(endpoint(lab, issue), {"reason": "并发移除"}, format="json")
            return response.status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(remove, range(2))) == [204, 204]
    assert Bounty.objects.get(id=bounty_id).reserved == 0
    assert Audit.objects.filter(action="bounty.deleted", object_id=bounty_id).count() == 1
    assert Audit.objects.filter(action="issue.deleted", object_id=issue.id).count() == 1


def test_bulk_delete_is_atomic_when_a_linked_bounty_is_forbidden(laboratory):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    ordinary = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name="普通任务"
    )
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=20)
    url = f"/api/workspaces/lab/projects/{lab['project'].id}/bulk-delete-issues/"
    body = {"issue_ids": [str(ordinary.id), str(issue.id)], "reason": "批量删除"}
    assert lab["client"](lab["member"]).delete(url, body, format="json").status_code == 403
    assert Issue.objects.filter(id__in=body["issue_ids"]).count() == 2
    assert Bounty.objects.get(id=bounty_id).reserved == 20
    result = lab["client"](lab["lead"]).delete(url, body, format="json")
    assert result.status_code == 200, result.content
    assert not Issue.objects.filter(id__in=body["issue_ids"]).exists()
    assert Bounty.objects.get(id=bounty_id).status == "deleted"
