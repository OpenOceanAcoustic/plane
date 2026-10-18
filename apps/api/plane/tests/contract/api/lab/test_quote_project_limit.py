# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from decimal import Decimal

import pytest

from plane.lab.models import Allocation, Bounty, BountyFunding, Ledger
from plane.lab.vc import stage_reserved, wallet
from .test_bounties import action
from .test_bounty_public_access import cross_member
from .test_bounty_quotes import decide, quote_list, submit_quote
from .test_member_vc import body, grant, issue, post, setup

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def published(lab, *, personal=False, major=False):
    stage = setup(lab, "10000")
    if personal:
        assert grant(lab, "5000").status_code == 201
    response = post(lab, body(lab, issue(lab), "5000", major=major), actor=lab["member"] if personal else lab["lead"])
    assert response.status_code == 201, response.content
    bounty = response.json()["id"]
    if major:
        assert action(lab, lab["independent"], bounty, "publication-review", {"reason": "发布复核"}).status_code == 200
    return stage, bounty


@pytest.mark.parametrize("major", [False, True])
def test_quote_above_bounty_price_uses_only_the_project_topup(laboratory, major):
    lab = laboratory
    stage, bounty = published(lab, major=major)
    view = quote_list(lab, bounty, lab["member"])
    assert view["available"] == "5000.00"
    assert view["project_available"] == "5000.00" and view["quote_limit"] == "10000.00"
    assert submit_quote(lab, bounty, kind="negotiated", vc="6000", basis="补充分析工作").status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert quote["adjustment"]["additional"] == "1000.00" and quote["adjustment"]["funded"]
    assert decide(lab, bounty, quote, reviewer_id=str(lab["independent"].id)).status_code == 200
    if major:
        assert stage_reserved(stage) == 5000 and not Allocation.objects.filter(bounty_id=bounty).exists()
        quote = quote_list(lab, bounty, lab["independent"])["quotes"][0]
        assert decide(lab, bounty, quote, "review", user=lab["independent"], decision="approve").status_code == 200
    assert stage_reserved(stage) == 6000
    assert BountyFunding.objects.get(bounty_id=bounty).project_committed == 6000
    allocation = Allocation.objects.get(bounty_id=bounty)
    assert allocation.planned == 6000 and allocation.approved and allocation.confirmed
    assert wallet(lab["lead"].id, lab["project"])["available"] == "0.00"
    assert not Ledger.objects.filter(bounty_id=bounty).exists()


def test_submission_rejects_quote_above_the_remaining_project_capacity(laboratory):
    lab = laboratory
    stage, bounty = published(lab)
    response = submit_quote(lab, bounty, kind="negotiated", vc="10000.01", basis="超出可用项目额度")
    assert response.status_code == 409, response.content
    assert stage_reserved(stage) == 5000 and quote_list(lab, bounty)["quotes"] == []
    assert submit_quote(lab, bounty, kind="negotiated", vc="10000", basis="全部交付").status_code == 201


def test_other_approved_plans_reduce_the_quote_limit_without_double_counting_reservation(laboratory):
    lab = laboratory
    _, bounty = published(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="4500", basis="第一份分工").status_code == 201
    assert decide(lab, bounty, quote_list(lab, bounty)["quotes"][0]).status_code == 200
    outsider = cross_member(lab)
    view = quote_list(lab, bounty, outsider)
    assert view["available"] == "500.00" and view["project_available"] == "5000.00"
    assert view["quote_limit"] == "5500.00"
    assert submit_quote(lab, bounty, outsider, kind="negotiated", vc="5500.01", basis="其他分工").status_code == 409
    assert submit_quote(lab, bounty, outsider, kind="negotiated", vc="5500", basis="其他分工").status_code == 201


def test_approval_rechecks_project_balance_after_a_valid_quote_was_submitted(laboratory):
    lab = laboratory
    stage, bounty = published(lab)
    assert submit_quote(lab, bounty, kind="negotiated", vc="6000", basis="补充工作").status_code == 201
    assert grant(lab, "4500", target=lab["reviewer"]).status_code == 201
    quote = quote_list(lab, bounty)["quotes"][0]
    assert quote["vc"] == "6000.00" and not quote["adjustment"]["funded"]
    assert quote_list(lab, bounty)["quote_limit"] == "5500.00"
    over_limit = submit_quote(lab, bounty, cross_member(lab), kind="negotiated", vc="6000", basis="旧额度报价")
    assert over_limit.status_code == 409
    assert decide(lab, bounty, quote).status_code == 400
    assert stage_reserved(stage) == Decimal("9500")
    assert Bounty.objects.get(id=bounty).budget == 5000


def test_personal_publication_keeps_its_private_wallet_and_cannot_borrow_project_pool(laboratory):
    lab = laboratory
    stage, bounty = published(lab, personal=True)
    applicant = cross_member(lab)
    view = quote_list(lab, bounty, applicant)
    assert view["funding_source"] == "personal"
    assert view["quote_limit"] is None and view["project_available"] is None and "wallet" not in view
    assert submit_quote(lab, bounty, applicant, kind="negotiated", vc="6000", basis="补充工作").status_code == 201
    quote = quote_list(lab, bounty, lab["member"])["quotes"][0]
    assert quote["adjustment"]["source_available"] == "0.00" and not quote["adjustment"]["funded"]
    rejected = decide(lab, bounty, quote, user=lab["member"])
    assert rejected.status_code == 400
    assert "个人可用 VC" in str(rejected.json())
    assert stage_reserved(stage) == 5000
