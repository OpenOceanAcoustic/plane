# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

import pytest

from .test_bounties import action, prepare
from .test_bounty_public_access import cross_member

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def quotes_url(lab, bounty):
    return lab["base"] + f"bounties/{bounty}/quotes/"


def submit_quote(lab, bounty, user=None, **extra):
    body = {
        "kind": "original",
        "vc": "20",
        "deliverable": "本人交付报告",
        "request_key": str(uuid.uuid4()),
        **extra,
    }
    return lab["client"](user or lab["member"]).post(quotes_url(lab, bounty), body, format="json")


def quote_list(lab, bounty, user=None):
    response = lab["client"](user or lab["lead"]).get(quotes_url(lab, bounty))
    assert response.status_code == 200, response.content
    return response.json()


def decide(lab, bounty, quote, verb="approve", user=None, **extra):
    body = {"request_key": str(uuid.uuid4()), "expected_budget": quote.get("budget_snapshot"), **extra}
    return lab["client"](user or lab["lead"]).post(
        quotes_url(lab, bounty) + f"{quote['id']}/{verb}/", body, format="json"
    )


def test_original_quote_approval_grants_task_and_planning_without_confirmation(laboratory):
    lab = laboratory
    bounty, issue, _ = prepare(lab)
    outsider = cross_member(lab)
    response = submit_quote(lab, bounty, outsider)
    assert response.status_code == 201, response.content
    quote = quote_list(lab, bounty)["quotes"][0]
    assert quote["status"] == "pending" and quote["vc"] == "20.00"
    response = decide(lab, bounty, quote)
    assert response.status_code == 200, response.content
    detail = lab["client"](outsider).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["access_level"] == "task"
    assert detail["allocations"][0]["approved"] and detail["allocations"][0]["confirmed"]
    assert detail["allocations"][0]["awarded"] == "0"
    planner = lab["client"](outsider).get(lab["base"] + "planner/").json()
    assert len(planner["items"]) == 1 and planner["items"][0]["issue_id"] == str(issue.id)
    assert action(lab, lab["lead"], bounty, "start").status_code == 200


def test_negotiated_quote_requires_evidence_and_rejection_keeps_history(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="12").status_code == 400
    response = submit_quote(lab, bounty, kind="negotiated", vc="12", basis="只承担数据处理")
    assert response.status_code == 201, response.content
    assert submit_quote(lab, bounty).status_code == 409
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, "reject").status_code == 400
    assert decide(lab, bounty, quote, "reject", reason="需覆盖完整交付").status_code == 200
    assert submit_quote(lab, bounty, kind="negotiated", vc="18", basis="补充完整报告").status_code == 201
    rows = quote_list(lab, bounty, lab["member"])["quotes"]
    assert [row["revision"] for row in rows] == [2, 1]
    assert rows[1]["status"] == "rejected" and rows[1]["basis"] == "只承担数据处理"
    assert rows[1]["history"][-1]["reason"] == "需覆盖完整交付"
    # A project's ordinary members and acceptance reviewer cannot read the negotiation.
    assert quote_list(lab, bounty, lab["reviewer"])["quotes"] == []
    assert quote_list(lab, bounty, cross_member(lab))["quotes"] == []
    detail = lab["client"](lab["reviewer"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["allocations"] == [] and "只承担数据处理" not in str(detail)


def test_additional_vc_uses_original_source_and_requests_are_idempotent(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    key = str(uuid.uuid4())
    first = submit_quote(lab, bounty, kind="negotiated", vc="30", basis="额外分析", request_key=key)
    replay = submit_quote(lab, bounty, kind="negotiated", vc="30", basis="额外分析", request_key=key)
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    assert submit_quote(lab, bounty, kind="negotiated", vc="31", basis="额外分析", request_key=key).status_code == 409
    old_stage = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()["stage_id"]
    created = lab["client"](lab["lead"]).post(
        lab["base"] + "stages/",
        {"project_id": str(lab["project"].id), "name": "追加预算", "budget": "1", "append": True},
        format="json",
    )
    assert created.status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert quote["adjustment"]["additional"] == "10.00"
    approval_key = str(uuid.uuid4())
    assert decide(lab, bounty, quote, request_key=approval_key).status_code == 200
    assert decide(lab, bounty, quote, request_key=approval_key).status_code == 200
    detail = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["budget"] == "30.00" and detail["reserved"] == "30.00" and detail["stage_id"] == old_stage
    assert len(detail["allocations"]) == 1 and detail["allocations"][0]["planned"] == "30.00"
    assert detail["awarded"] == "0"
    current = lab["client"](lab["lead"]).get(lab["base"] + "bounties/budgets/").json()[0]
    assert current["available"] == "971.00"


def test_major_increase_is_unreserved_until_separate_review(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="扩大分析范围").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    response = decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id))
    assert response.status_code == 200 and response.json()["status"] == "pending_review"
    detail_url = lab["base"] + f"bounties/{bounty}/detail/"
    detail = lab["client"](lab["lead"]).get(detail_url).json()
    assert detail["reserved"] == "20.00" and detail["allocations"] == []
    assert action(lab, lab["lead"], bounty, "start").status_code == 400
    assert decide(lab, bounty, quote, "review", user=lab["member"], decision="approve").status_code == 404
    reviewed = quote_list(lab, bounty, lab["independent"])["quotes"][0]
    assert reviewed["can_review"] and reviewed["basis"] == "扩大分析范围"
    result = decide(lab, bounty, reviewed, "review", user=lab["independent"], decision="approve")
    assert result.status_code == 200, result.content
    detail = lab["client"](lab["lead"]).get(detail_url).json()
    assert detail["budget"] == "45.00" and detail["major"] and "40VC" in detail["major_reasons"]
    assert detail["allocations"][0]["confirmed"]
    assert action(lab, lab["lead"], bounty, "start").status_code == 200


def test_stale_original_and_stale_approval_do_not_silently_change_price(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    outsider = cross_member(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="10", basis="半份交付").status_code == 201
    assert submit_quote(lab, bounty, outsider).status_code == 201
    rows = quote_list(lab, bounty)["quotes"]
    member_quote = next(row for row in rows if row["user_id"] == str(lab["member"].id))
    outsider_quote = next(row for row in rows if row["user_id"] == str(outsider.id))
    assert decide(lab, bounty, member_quote).status_code == 200
    assert decide(lab, bounty, outsider_quote).status_code == 409
    updated = next(row for row in quote_list(lab, bounty)["quotes"] if row["id"] == outsider_quote["id"])
    assert updated["vc"] == "20.00" and updated["adjustment"]["additional"] == "10.00"
    assert decide(lab, bounty, updated).status_code == 200


def test_review_returns_to_lead_when_budget_snapshot_changes(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="完整工作").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    # A legacy application changes this team's approved allocation without reserving the quote's top-up.
    outsider = cross_member(lab)
    legacy = action(lab, outsider, bounty, "claim", {"planned": "5", "deliverable": "另一分工"})
    assert legacy.status_code == 200
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": legacy.json()["id"]}).status_code == 200
    reviewed = quote_list(lab, bounty, lab["independent"])["quotes"][0]
    assert decide(lab, bounty, reviewed, "review", user=lab["independent"], decision="approve").status_code == 409
    returned = quote_list(lab, bounty)["quotes"][0]
    assert returned["status"] == "pending" and returned["can_approve"]
    assert returned["history"][-1]["label"] == "退回重审"


def test_quotes_cannot_bypass_legacy_claims_or_review_roles(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, lab["reviewer"]).status_code == 400
    assert submit_quote(lab, bounty).status_code == 201
    assert action(lab, lab["member"], bounty, "claim", {"planned": "1", "deliverable": "重复"}).status_code == 400
    quote = quote_list(lab, bounty)["quotes"][0]
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": quote["id"]}).status_code == 404
    assert decide(lab, bounty, quote, user=lab["reviewer"]).status_code == 404
    assert action(lab, lab["lead"], bounty, "cancel", {"reason": "取消任务"}).status_code == 200
    assert quote_list(lab, bounty, lab["member"])["quotes"][0]["status"] == "closed"
    assert decide(lab, bounty, quote).status_code == 400


def test_file_only_quote_uses_private_download_permissions(laboratory, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from plane.db.models import WorkspaceMember

    settings.STORAGES = {
        **settings.STORAGES,
        "lab_quotes": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path)},
        },
    }
    lab = laboratory
    bounty, _, _ = prepare(lab)
    outsider = cross_member(lab)
    upload = lab["client"](outsider).post(
        lab["base"] + f"bounties/{bounty}/quote-attachments/",
        {"file": SimpleUploadedFile("依据.pdf", b"quote evidence", content_type="application/pdf")},
        format="multipart",
    )
    assert upload.status_code == 201, upload.content
    attachment = upload.json()
    assert "storage" not in str(attachment) and "http" not in attachment["download_path"]
    url = lab["base"] + attachment["download_path"]
    assert lab["client"](lab["lead"]).get(url).status_code == 404
    assert submit_quote(lab, bounty, kind="negotiated", attachment_ids=[attachment["id"]]).status_code == 400
    assert submit_quote(lab, bounty, outsider, kind="negotiated", attachment_ids=[attachment["id"]]).status_code == 201
    download = lab["client"](lab["lead"]).get(url)
    assert download.status_code == 200 and download["Cache-Control"] == "private, no-store"
    assert b"".join(download.streaming_content) == b"quote evidence"
    assert lab["client"](lab["reviewer"]).get(url).status_code == 404
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=outsider).update(is_active=False)
    assert lab["client"](outsider).get(url).status_code == 403


def test_original_submission_refreshes_price_and_zero_balance_still_allows_negotiation(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    outsider = cross_member(lab)
    legacy = action(lab, outsider, bounty, "claim", {"planned": "20", "deliverable": "完整任务"})
    assert legacy.status_code == 200
    assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": legacy.json()["id"]}).status_code == 200
    assert submit_quote(lab, bounty).status_code == 409
    view = quote_list(lab, bounty, lab["member"])
    assert view["available"] == "0.00" and view["can_apply"]
    assert submit_quote(lab, bounty, kind="negotiated", vc="5", basis="追加分工").status_code == 201


def test_insufficient_original_budget_does_not_borrow_a_new_budget(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab, stage_budget="100")
    assert submit_quote(lab, bounty, kind="negotiated", vc="101", basis="超预算分工").status_code == 409
    assert submit_quote(lab, bounty, kind="negotiated", vc="100", basis="完整分工").status_code == 201
    from .test_member_vc import grant

    assert grant(lab, "1", target=lab["reviewer"]).status_code == 201
    from django.utils import timezone
    from plane.lab.models import Stage

    Stage.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=lab["project"].id,
        project_name=lab["project"].name,
        name="历史独立阶段",
        budget="1000",
        frozen_at=timezone.now(),
    )
    quote = quote_list(lab, bounty)["quotes"][0]
    assert not quote["adjustment"]["funded"]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 400
    detail = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["reserved"] == "20.00" and detail["allocations"] == []


def test_concurrent_approvals_require_an_explicit_refresh_and_never_double_reserve(laboratory):
    from concurrent.futures import ThreadPoolExecutor
    from django.db import close_old_connections

    lab = laboratory
    bounty, _, _ = prepare(lab)
    outsider = cross_member(lab)
    for user in (lab["member"], outsider):
        assert submit_quote(lab, bounty, user, kind="negotiated", vc="15", basis="分工").status_code == 201
    rows = quote_list(lab, bounty)["quotes"]

    def approve(row):
        close_old_connections()
        try:
            return decide(lab, bounty, row).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(approve, rows))
    assert sorted(statuses) == [200, 409]
    pending = next(row for row in quote_list(lab, bounty)["quotes"] if row["status"] == "pending")
    assert pending["adjustment"]["additional"] == "10.00"
    assert decide(lab, bounty, pending).status_code == 200
    detail = lab["client"](lab["lead"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["budget"] == "30.00" and detail["reserved"] == "30.00"
    assert detail["claim_available"] == "0.00" and len(detail["allocations"]) == 2


def test_web_workflow_and_inbox_show_private_review_but_legacy_workflow_stays_compatible(laboratory):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="秘密报价依据").status_code == 201
    inbox = lab["client"](lab["lead"]).get(lab["base"] + "inbox/").json()
    assert inbox[0]["action"] == "审批报价（网页）"
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    inbox = lab["client"](lab["independent"]).get(lab["base"] + "inbox/").json()
    assert inbox[0]["action"] == "加价复核（网页）"
    path = lab["base"] + f"bounties/{bounty}/workflow/"
    web = lab["client"](lab["independent"]).get(path + "?quotes=1").json()
    assert web["current_node"] == "quote_review"
    assert "confirm" not in [row["id"] for row in web["nodes"]]
    legacy = lab["client"](lab["independent"]).get(path).json()
    assert "confirm" in [row["id"] for row in legacy["nodes"]]
    private = lab["client"](lab["reviewer"]).get(path + "?quotes=1").json()
    assert not any(event["label"] == "负责人同意，待复核" for event in private["history"])


def test_approval_preserves_existing_planning_and_starts_close_other_pending_quotes(laboratory):
    from plane.lab.models import PersonalCategory, Folder, PersonalItem

    lab = laboratory
    bounty, issue, _ = prepare(lab)
    folder = Folder.objects.create(workspace=lab["workspace"], user=lab["member"], name="原目录")
    category = PersonalCategory.objects.create(
        workspace=lab["workspace"], user=lab["member"], name="原分类", color="#123456"
    )
    item = PersonalItem.objects.create(
        workspace=lab["workspace"], user=lab["member"], issue=issue, kind="project", folder=folder, category=category
    )
    outsider = cross_member(lab)
    assert submit_quote(lab, bounty).status_code == 201
    assert submit_quote(lab, bounty, outsider, kind="negotiated", vc="8", basis="另一交付").status_code == 201
    quote = next(row for row in quote_list(lab, bounty)["quotes"] if row["user_id"] == str(lab["member"].id))
    assert decide(lab, bounty, quote).status_code == 200
    planner = lab["client"](lab["member"]).get(lab["base"] + "planner/").json()
    planned = next(row for row in planner["items"] if row["id"] == str(item.id))
    assert planned["folder_id"] == str(folder.id) and planned["category_id"] == str(category.id)
    assert action(lab, lab["lead"], bounty, "start").status_code == 200
    assert quote_list(lab, bounty, outsider)["quotes"][0]["status"] == "closed"


def test_upload_limits_and_revoked_review_permissions(laboratory, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from plane.db.models import ProjectMember

    lab = laboratory
    bounty, _, _ = prepare(lab)
    settings.FILE_SIZE_LIMIT = 10
    client = lab["client"](lab["member"])
    url = lab["base"] + f"bounties/{bounty}/quote-attachments/"
    for contents in (b"", b"12345678901"):
        assert (
            client.post(url, {"file": SimpleUploadedFile("依据.txt", contents)}, format="multipart").status_code == 400
        )
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="重大分工").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    ProjectMember.objects.filter(project=lab["project"], member=lab["independent"]).update(is_active=False)
    assert quote_list(lab, bounty, lab["independent"])["quotes"] == []
    assert decide(lab, bounty, quote, "review", user=lab["independent"], decision="approve").status_code == 404


@pytest.mark.parametrize("membership", ["project", "workspace"])
def test_revoking_lead_eligibility_invalidates_outstanding_major_approval(laboratory, membership):
    from plane.db.models import ProjectMember, WorkspaceMember

    lab = laboratory
    bounty, _, _ = prepare(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="45", basis="重大分工").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    if membership == "project":
        ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(is_active=False)
    else:
        WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["lead"]).update(is_active=False)
    reviewed = quote_list(lab, bounty, lab["independent"])["quotes"][0]
    response = decide(lab, bounty, reviewed, "review", user=lab["independent"], decision="approve")
    assert response.status_code == 409, response.content
    returned = quote_list(lab, bounty, lab["independent"])["quotes"][0]
    assert returned["status"] == "pending" and returned["allocation_id"] is None
    detail = lab["client"](lab["independent"]).get(lab["base"] + f"bounties/{bounty}/detail/").json()
    assert detail["reserved"] == "20.00" and detail["allocations"] == []
