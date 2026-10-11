# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest

from plane.db.models import ProjectMember, WorkspaceMember
from plane.lab.finance_models import FinancialOperation
from .test_finance import act, overview, plan, receipt

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_future_limits_use_workspace_year_and_include_funds_outside_managers_projects(laboratory):
    lab = laboratory
    lab["workspace"].timezone = "Pacific/Honolulu"
    lab["workspace"].save(update_fields=["timezone"])
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at="2026-01-01T05:00:00+00:00")
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["reviewer"]).update(role=20)
    changed = act(lab, "manager", {"user_id": str(lab["reviewer"].id)})
    assert changed.status_code == 200, changed.content
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    data = overview(lab, lab["reviewer"])
    assert not any(row["kind"] == "receipt" for row in data["operations"])
    assert data["future_plan_limits"] == {"2025": "150.00"}
    assert overview(lab)["future_plan_limits"] == {"2025": "150.00"}
    scoped = lab["client"](lab["reviewer"]).get(lab["base"] + f"finance/overview/?project_id={lab['project'].id}")
    assert scoped.status_code == 403


def test_future_limits_exclude_previous_plans_and_track_append_only_reversals(laboratory):
    lab = laboratory
    lab["workspace"].timezone = "Asia/Shanghai"
    lab["workspace"].save(update_fields=["timezone"])
    stage, _ = plan(lab)
    receipt(lab, stage, gross="1000", costs="0", D="1000", occurred_at="2026-06-01T00:00:00+08:00")
    assert overview(lab)["future_plan_limits"] == {"2026": "150.00"}
    scheduled = act(lab, "future-plan", {"year": 2026, "amount": "150"})
    assert scheduled.status_code == 200, scheduled.content
    assert overview(lab)["future_plan_limits"] == {"2026": "0.00"}
    operation = FinancialOperation.objects.get(workspace=lab["workspace"], kind="future-plan")
    undone = act(lab, "reverse", {"operation_id": str(operation.id), "evidence": "年度编列撤销凭证"})
    assert undone.status_code == 200, undone.content
    assert overview(lab)["future_plan_limits"] == {"2026": "150.00"}
    operation = FinancialOperation.objects.get(workspace=lab["workspace"], kind="receipt")
    undone = act(lab, "reverse", {"operation_id": str(operation.id), "evidence": "到账原路退回凭证"})
    assert undone.status_code == 200, undone.content
    assert overview(lab)["future_plan_limits"] == {"2025": "150.00"}
