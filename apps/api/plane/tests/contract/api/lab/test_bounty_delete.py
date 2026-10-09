# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import Issue, Page, PageVersion, ProjectPage
from plane.lab.bounty_models import BountyMaterial, BountyPublication, BountyTaskAccess
from plane.lab.finance_models import FinancialEntry, OfflinePayment, PaymentCommitment, RewardForecast, RewardSettlement
from plane.lab.models import Allocation, Audit, Bounty, Folder, Ledger, PersonalCategory, PersonalItem, TimeBlock
from .test_bounties import action, prepare, start
from .test_bounty_public_access import approve_cross, cross_member
from .test_finance import commit, pay, plan, receipt, settle

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_project_lead_can_delete_published_bounty_without_deleting_native_issue(laboratory):
    lab = laboratory
    bounty_id, issue, body = prepare(lab)
    lead = lab["client"](lab["lead"])
    endpoint = lab["base"] + f"bounties/{bounty_id}/detail/"
    response = lead.delete(endpoint, {"reason": "撤回误发布的团队悬赏"}, format="json")
    assert response.status_code == 204, response.content
    assert all(row["id"] != bounty_id for row in lead.get(lab["base"] + "bounties/").json())
    bounty = Bounty.objects.get(id=bounty_id)
    assert bounty.status == "deleted" and bounty.reserved == 0
    assert Issue.objects.filter(id=issue.id).exists()
    event = Audit.objects.get(action="bounty.deleted", object_id=bounty_id)
    assert event.actor_id == lab["lead"].id
    assert event.details["reason"] == "撤回误发布的团队悬赏"
    assert event.details["issue_id"] == str(issue.id)
    republished = lead.post(lab["base"] + "bounties/", body, format="json")
    assert republished.status_code == 201, republished.content
    assert republished.json()["id"] != bounty_id
    assert Bounty.objects.get(id=bounty_id).issue_id is None
    assert Bounty.objects.get(id=bounty_id).issue_id_snapshot == issue.id


def test_delete_requires_lead_and_reason_and_is_idempotent(laboratory):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)
    endpoint = lab["base"] + f"bounties/{bounty_id}/detail/"
    public_user = cross_member(lab)
    for user in (lab["member"], lab["reviewer"], public_user):
        assert lab["client"](user).delete(endpoint, {"reason": "禁止越权删除"}, format="json").status_code == 403
    lead = lab["client"](lab["lead"])
    assert lead.delete(endpoint, {}, format="json").status_code == 400
    assert Bounty.objects.get(id=bounty_id).status == "open"
    assert not Audit.objects.filter(action="bounty.deleted").exists()
    for _ in range(2):
        assert lead.delete(endpoint, {"reason": "重复请求同次删除"}, format="json").status_code == 204
    assert Audit.objects.filter(action="bounty.deleted", object_id=bounty_id).count() == 1
    assert lab["client"](public_user).get(endpoint).status_code == 404
    assert lab["client"](public_user).get(lab["base"] + "bounties/").json() == []
    details = lead.get(endpoint).json()
    assert details["status"] == "deleted" and not details["can_delete"] and not details["can_manage_materials"]
    workflow = lead.get(lab["base"] + f"bounties/{bounty_id}/workflow/").json()
    assert workflow["current_node"] == "deleted" and workflow["actions"] == []
    assert workflow["history"][-1]["label"] == "删除悬赏"
    assert (
        action(lab, lab["lead"], bounty_id, "public-summary", {"enabled": True, "reason": "恢复公示"}).status_code
        == 400
    )


def test_delete_revokes_execution_materials_and_preserves_existing_planning(laboratory):
    lab = laboratory
    bounty_id, issue, _ = prepare(lab)
    cross = cross_member(lab)
    approve_cross(lab, bounty_id, cross)
    assert action(lab, cross, bounty_id, "confirm").status_code == 200
    internal_allocation = action(lab, lab["member"], bounty_id, "claim", {"planned": "1", "deliverable": "原任务分工"})
    # The external allocation uses all 20VC, so do not approve this extra application.
    assert internal_allocation.status_code == 200
    category = PersonalCategory.objects.create(
        workspace=lab["workspace"], user=lab["member"], name="实验", color="#abcdef"
    )
    folder = Folder.objects.create(workspace=lab["workspace"], user=lab["member"], name="原有文件夹")
    own = PersonalItem.objects.create(
        workspace=lab["workspace"], user=lab["member"], issue=issue, category=category, folder=folder, kind="project"
    )
    begin = timezone.now().replace(minute=0, second=0, microsecond=0)
    cross_item = PersonalItem.objects.get(user=cross, issue=issue)
    for item in (own, cross_item):
        TimeBlock.objects.create(item=item, start=begin, end=begin + timedelta(hours=1), color="#123456")
    originals = list(PersonalItem.objects.order_by("id").values_list("id", "folder_id", "category_id", "issue_id"))
    blocks = list(TimeBlock.objects.order_by("id").values_list("id", "start", "end", "revision", "color"))
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["lead"], name="执行资料")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    version = PageVersion.objects.create(
        workspace=lab["workspace"], page=page, owned_by=lab["lead"], description_html="<p>版本一</p>"
    )
    lead = lab["client"](lab["lead"])
    sources = lab["base"] + f"bounties/{bounty_id}/materials/"
    material = lead.post(sources, {"kind": "document_version", "page_version_id": str(version.id)}, format="json")
    assert material.status_code == 201, material.content
    assert action(lab, lab["lead"], bounty_id, "start").status_code == 200
    issue.refresh_from_db()
    native_state = issue.state_id
    assert (
        lead.delete(lab["base"] + f"bounties/{bounty_id}/detail/", {"reason": "终止执行"}, format="json").status_code
        == 204
    )
    issue.refresh_from_db()
    assert issue.state_id == native_state
    assert (
        list(PersonalItem.objects.order_by("id").values_list("id", "folder_id", "category_id", "issue_id")) == originals
    )
    assert list(TimeBlock.objects.order_by("id").values_list("id", "start", "end", "revision", "color")) == blocks
    assert not BountyTaskAccess.objects.filter(allocation__bounty_id=bounty_id, revoked_at__isnull=True).exists()
    assert not BountyMaterial.objects.filter(bounty_id=bounty_id, revoked_at__isnull=True).exists()
    assert not BountyPublication.objects.get(bounty_id=bounty_id).enabled
    assert not Allocation.objects.filter(bounty_id=bounty_id, closed=False).exists()
    assert lab["client"](cross).get(sources + material.json()["id"] + "/").status_code == 404
    assert lab["client"](cross).get(lab["base"] + "planner/").json()["items"] == []
    kept = lab["client"](lab["member"]).get(lab["base"] + "planner/").json()["items"][0]
    assert kept["id"] == str(own.id) and kept["category_color"] == "#abcdef" and kept.get("bounty_id") is None
    metadata = (
        lab["client"](lab["member"])
        .get(lab["base"] + f"task-card-metadata/?project_id={lab['project'].id}")
        .json()["items"]
    )
    assert metadata[0]["bounty_id"] is None and metadata[0]["color"] == "#abcdef"
    assert metadata[0]["bounty_budget"] is None
    assert lead.get(sources).json()["materials"] == []
    assert (
        lead.post(sources, {"kind": "document_version", "page_version_id": str(version.id)}, format="json").status_code
        == 400
    )
    assert action(lab, cross, bounty_id, "submit", {"evidence": "失效授权不能提交"}).status_code == 404


def test_delete_finished_bounty_preserves_earned_vc_forecasts_and_paid_cash(laboratory):
    lab = laboratory
    bounty_id, issue, body = prepare(lab)
    allocation = start(lab, bounty_id)
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "已验收交付"}).status_code == 200
    accepted = action(
        lab,
        lab["reviewer"],
        bounty_id,
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "pass",
            "reason": "验收通过",
            "targets": {allocation: "20"},
        },
    )
    assert accepted.status_code == 200, accepted.content
    stage_id, _ = plan(lab, bounty=bounty_id, E="1000")
    receipt(lab, stage_id, gross="1000", costs="0", D="1000")
    lead = lab["client"](lab["lead"])
    forecast = lead.post(
        lab["base"] + "finance/forecast/",
        {"stage_id": stage_id, "kind": "task", "basis": "budget", "bounty_id": bounty_id},
        format="json",
    )
    assert forecast.status_code == 201, forecast.content
    settlement_id = settle(lab, stage_id, amount="200")
    commitment_id = commit(lab, settlement_id, amount="200")
    pay(lab, commitment_id, gross="200", withheld="20")
    models = (Ledger, RewardForecast, RewardSettlement, PaymentCommitment, OfflinePayment, FinancialEntry)
    facts = [list(model.objects.order_by("id").values()) for model in models]
    assert (
        lead.delete(
            lab["base"] + f"bounties/{bounty_id}/detail/", {"reason": "移除已完成悬赏卡"}, format="json"
        ).status_code
        == 204
    )
    assert [list(model.objects.order_by("id").values()) for model in models] == facts
    assert Bounty.objects.get(id=bounty_id).reserved == 20
    assert Issue.objects.filter(id=issue.id, state=lab["states"]["done"]).exists()
    assert lead.get(lab["base"] + "ledger/").json()[0]["delta"] == "20.00"
    issue.refresh_from_db()
    issue.state = lab["states"]["todo"]
    issue.save(update_fields=["state", "completed_at"])
    republished = lead.post(lab["base"] + "bounties/", body, format="json")
    assert republished.status_code == 201, republished.content
    assert [list(model.objects.order_by("id").values()) for model in models] == facts


def test_concurrent_delete_is_one_audit_and_one_reservation_release(laboratory):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)

    def remove(_):
        close_old_connections()
        try:
            return (
                lab["client"](lab["lead"])
                .delete(lab["base"] + f"bounties/{bounty_id}/detail/", {"reason": "并发删除"}, format="json")
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(remove, range(2))) == [204, 204]
    assert Bounty.objects.get(id=bounty_id).reserved == 0
    events = Audit.objects.filter(action="bounty.deleted", object_id=bounty_id)
    assert events.count() == 1 and events.get().details["released_vc"] == "20.00"


def test_delete_partial_bounty_releases_only_unearned_budget_and_keeps_corrections_available(laboratory):
    lab = laboratory
    bounty_id, issue, body = prepare(lab, stage_budget="100")
    allocation_id = start(lab, bounty_id)
    assert action(lab, lab["member"], bounty_id, "submit", {"evidence": "已完成一半"}).status_code == 200
    accepted = action(
        lab,
        lab["reviewer"],
        bounty_id,
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": "partial",
            "reason": "部分验收通过",
            "targets": {allocation_id: "10"},
        },
    )
    assert accepted.status_code == 200, accepted.content
    ledger = Ledger.objects.get(bounty_id=bounty_id)
    lead = lab["client"](lab["lead"])
    assert (
        lead.delete(
            lab["base"] + f"bounties/{bounty_id}/detail/", {"reason": "停止剩余工作"}, format="json"
        ).status_code
        == 204
    )
    bounty = Bounty.objects.get(id=bounty_id)
    assert bounty.reserved == 10 and bounty.issue_id is None
    assert Audit.objects.get(action="bounty.deleted", object_id=bounty_id).details["released_vc"] == "10.00"
    next_issue = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"]["todo"], name="新的团队任务"
    )
    new_body = {**body, "issue_id": str(next_issue.id), "budget": "90"}
    new_bounty = lead.post(lab["base"] + "bounties/", new_body, format="json")
    assert new_bounty.status_code == 201, new_bounty.content
    assert sum(Bounty.objects.filter(stage=bounty.stage).values_list("reserved", flat=True)) == 100
    assert Ledger.objects.get(id=ledger.id).delta == 10
    reversal = lead.post(
        lab["base"] + f"ledger/{ledger.id}/reverse/",
        {
            "request_key": str(uuid.uuid4()),
            "reason": "追加纠正已删除悬赏的验收记录",
        },
        format="json",
    )
    assert reversal.status_code == 200, reversal.content
    bounty.refresh_from_db()
    assert bounty.reserved == 0 and bounty.status == "deleted"
    assert Ledger.objects.get(id=ledger.id).delta == 10
    assert sum(Ledger.objects.filter(bounty=bounty).values_list("delta", flat=True)) == 0
    assert Issue.objects.filter(id=issue.id).exists()
