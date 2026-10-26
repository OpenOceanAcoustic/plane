# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only
from decimal import Decimal
from io import StringIO
import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction

from plane.lab import agent_views
from plane.lab.finance_models import FinancialOperation
from plane.lab.models import Audit, CashBounty
from .test_cash_bounty_workflow import action, prepared, publish

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def claimed(lab):
    pk = publish(lab)
    assert action(lab, pk, "claim", lab["member"]).status_code == 200
    return pk


@pytest.mark.parametrize("result,label", [("pass", "通过"), ("fail", "不通过"), ("blocked", "无法测试")])
def test_manual_test_feedback_is_text_only_and_a_defect_can_be_accepted(laboratory, result, label):
    lab = laboratory
    pk = claimed(lab)
    data = {
        "feedback_mode": "test",
        "test_result": result,
        "test_steps": "现金悬赏→我的→全部；我的能显示已领取任务",
        "feedback": "点击全部后列表空白，预期看到任务；无法继续检查" if result != "pass" else "",
    }
    response = action(lab, pk, "submit", lab["member"], **data)
    assert response.status_code == 200, response.content
    row = CashBounty.objects.get(id=pk)
    assert row.status == "submitted" and row.submitted_at
    assert f"测试结论：{label}" in row.evidence and data["test_steps"] in row.evidence
    assert (data["feedback"] or "未发现问题") in row.evidence
    assert row.amount == Decimal("5")
    assert action(lab, pk, "accept", note="有效人工反馈，缺陷另行修复").status_code == 200
    row.refresh_from_db()
    assert row.status == "accepted" and row.payment_operation_id is None
    assert not FinancialOperation.objects.exists()


@pytest.mark.parametrize(
    "overrides",
    [
        {"test_result": ""},
        {"test_result": "other"},
        {"test_result": {}},
        {"test_steps": "  "},
        {"test_result": "fail", "feedback": ""},
        {"test_result": "blocked", "feedback": "  "},
        {"feedback_mode": "invalid"},
    ],
)
def test_incomplete_test_report_keeps_the_task_claimed(laboratory, overrides):
    lab = laboratory
    pk = claimed(lab)
    response = action(
        lab,
        pk,
        "submit",
        lab["member"],
        **{
            "feedback_mode": "test",
            "test_result": "pass",
            "test_steps": "实际点击可接单、我的，显示正确",
            "feedback": "",
            **overrides,
        },
    )
    assert response.status_code == 400
    row = CashBounty.objects.get(id=pk)
    assert row.status == "claimed" and row.evidence == "" and row.submitted_at is None


def test_existing_delivery_notes_and_agent_submission_remain_compatible(laboratory):
    lab = laboratory
    pk = claimed(lab)
    assert action(lab, pk, "submit", lab["member"], evidence="原有文字交付").status_code == 200
    assert CashBounty.objects.get(id=pk).evidence == "原有文字交付"
    second = claimed(lab)
    draft = prepared(
        lab,
        "bounty_submit",
        {"feedback_mode": "test", "test_result": "pass", "test_steps": "已测我的筛选，结果正确"},
        second,
    )
    with transaction.atomic():
        agent_views.execute_bounty_action(draft, lab["member"], lab["workspace"])
    assert "测试结论：通过" in CashBounty.objects.get(id=second).evidence


def legacy(lab, title="自动点击回归", **extra):
    return CashBounty.objects.create(
        **{
            "workspace": lab["workspace"],
            "project": lab["project"],
            "publisher": lab["lead"],
            "reviewer": lab["lead"],
            "title": title,
            "deliverable": "交付一个可用页面",
            "criteria": "",
            "amount": Decimal("8"),
            "status": "open",
            **extra,
        }
    )


def repair(lab, **options):
    output = StringIO()
    call_command(
        "repair_human_test_bounties", project=lab["project"].id, actor=lab["lead"].id, stdout=output, **options
    )
    return json.loads(output.getvalue())


def test_legacy_repair_previews_then_changes_seven_tasks_without_touching_history_or_money(laboratory):
    lab = laboratory
    rows = [legacy(lab, "UI状态测试", amount="6"), legacy(lab, "卡片布局测试", amount="7")]
    rows += [legacy(lab) for _ in range(5)]
    protected = [
        legacy(lab, status="claimed", claimed_by=lab["member"]),
        legacy(lab, status="submitted", claimed_by=lab["member"], evidence="真实反馈"),
        legacy(lab, status="paid", claimed_by=lab["member"], evidence="已付款历史"),
        legacy(lab, publisher=lab["member"]),
        legacy(lab, deliverable="已有明确操作，不是旧占位说明"),
        legacy(lab, claimed_by=lab["member"]),
    ]
    before = list(CashBounty.objects.order_by("id").values())
    preview = repair(lab, expected_count=7)
    assert preview["applied"] is False and preview["count"] == 7
    assert (
        list(CashBounty.objects.order_by("id").values()) == before
        and not Audit.objects.filter(action="cash_bounty.instructions_repaired").exists()
    )
    applied = repair(lab, apply=True, expected_count=7)
    assert applied["applied"] is True and applied["count"] == 7
    for row in rows:
        original_amount = row.amount
        row.refresh_from_db()
        assert row.title.startswith("人工测试：") and "操作步骤" in row.deliverable
        assert "/lab/lab/cash" in row.deliverable and "无需开发页面、编写代码或上传截图" in row.deliverable
        assert "发现产品缺陷同样属于有效交付" in row.criteria
        assert row.amount == Decimal(original_amount) and row.status == "open" and row.claimed_by_id is None
    assert len({row.title for row in rows}) == 7
    for row in protected:
        snapshot = next(item for item in before if item["id"] == row.id)
        assert CashBounty.objects.filter(id=row.id).values().get() == snapshot
    assert Audit.objects.filter(action="cash_bounty.instructions_repaired", actor=lab["lead"]).count() == 7
    assert not FinancialOperation.objects.exists()
    assert repair(lab, apply=True)["count"] == 0


def test_legacy_repair_checks_scope_and_rolls_back_unexpected_duplicates(laboratory):
    lab = laboratory
    legacy(lab, "UI状态测试")
    with pytest.raises(CommandError, match="Expected"):
        repair(lab, apply=True, expected_count=7)
    for _ in range(6):
        legacy(lab)
    before = list(CashBounty.objects.order_by("id").values())
    with pytest.raises(CommandError, match="duplicate"):
        repair(lab, apply=True)
    assert (
        list(CashBounty.objects.order_by("id").values()) == before
        and not Audit.objects.filter(action="cash_bounty.instructions_repaired").exists()
    )
    with pytest.raises(CommandError, match="active member"):
        call_command(
            "repair_human_test_bounties",
            project=lab["project"].id,
            actor="00000000-0000-0000-0000-000000000001",
            apply=True,
        )
