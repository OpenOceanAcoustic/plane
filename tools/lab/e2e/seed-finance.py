# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# Runs only in ooa-plane-e2e; its TypeScript caller validates project_id.

import json
import uuid

from django.db import transaction
from django.utils import timezone

from plane.db.models import Issue, Page, PageVersion, Project, ProjectMember, State, User, WorkspaceMember
from plane.lab.bounties import accept, approve_claim, claim, confirm_claim, publish, start, submit
from plane.lab.finance_services import create_forecast, perform, save_formula
from plane.lab.models import PersonalCategory, PersonalItem, Stage


def finance_action(action, **values):
    return perform(lead, project.workspace, action, {
        "request_key": str(uuid.uuid4()), "reason": "隔离浏览器财务验收", **values,
    })


with transaction.atomic():
    project = Project.objects.get(id=project_id, workspace__slug="browser-lab")
    lead = User.objects.get(username="e2e-admin")
    if project.project_lead_id != lead.id:
        raise RuntimeError("Finance fixture must use the isolated administrator's project")
    reviewer, _ = User.objects.get_or_create(
        username="e2e-finance-reviewer",
        defaults={"email": "finance-reviewer@example.org", "display_name": "财务验收独立验收人"},
    )
    WorkspaceMember.objects.get_or_create(workspace=project.workspace, member=reviewer, defaults={"role": 15})
    ProjectMember.objects.get_or_create(
        workspace=project.workspace, project=project, member=reviewer, defaults={"role": 15},
    )
    stage = Stage.objects.create(
        workspace=project.workspace, project=project, workspace_id_snapshot=project.workspace_id,
        project_id_snapshot=project.id, project_name=project.name, name="浏览器真实资金阶段",
        budget=100, frozen_at=timezone.now(),
    )
    finance_action(
        "stage", stage_id=str(stage.id), E="1000",
        purposes=[{"name": "复验数据整理奖励", "amount": "1000"}],
        members=[{"user_id": str(lead.id), "b": "0.5", "r": "0.5", "planned_vc": "20"}],
    )
    formula = save_formula(lead, project, {
        "task_expression": "min(E, E * VC / B * performance)",
        "member_expression": "E * (0.5 * b + 0.3 * r + 0.2 * VC / B)",
        "parameters": [{"name": "performance", "scope": "task", "unit": "倍", "source": "负责人预计绩效", "default": "1"}],
        "reason": "本项目使用独立的任务预计奖励公式",
    })
    issue = Issue.objects.create(
        workspace=project.workspace, project=project, name="Finance browser bounty",
        state=State.objects.filter(project=project, group="unstarted").first(),
    )
    bounty = publish(lead, stage.id, {
        "issue_id": str(issue.id), "budget": "20", "deliverable": "经过独立验收的实验数据",
        "criteria": "配置和结果均可复验", "public_summary": "独立公式及真实现金支付验收",
        "public_deliverable": "可公开复验的数据报告", "public_criteria": "报告可复验",
        "reviewer_id": str(reviewer.id),
    })
    allocation = claim(lead, bounty.id, {"planned": "20", "deliverable": "实验数据整理"})
    approve_claim(lead, bounty.id, allocation.id)
    confirm_claim(lead, bounty.id)
    confirm_claim(lead, bounty.id)
    category, _ = PersonalCategory.objects.get_or_create(
        workspace=project.workspace, user=lead, name="财务验收分类", defaults={"color": "#0d9488"},
    )
    item = PersonalItem.objects.get(workspace=project.workspace, user=lead, issue=issue)
    item.category = category
    item.save(update_fields=["category"])
    start(lead, bounty.id)
    submit(lead, bounty.id, "可复验的配置和实验成果")
    accept(reviewer, bounty.id, {
        "request_key": str(uuid.uuid4()), "result": "pass", "reason": "独立复验满足发布标准",
        "targets": {str(allocation.id): "20"},
    })
    task_forecast = create_forecast(lead, project.workspace, {
        "stage_id": str(stage.id), "kind": "task", "basis": "budget", "bounty_id": str(bounty.id),
    })
    member_forecast = create_forecast(lead, project.workspace, {
        "stage_id": str(stage.id), "kind": "member", "basis": "budget", "user_id": str(lead.id),
    })
    receipt = finance_action(
        "receipt", stage_id=str(stage.id), gross="2000", costs="0", D="2000",
        source="浏览器验收实际到账", evidence="隔离到账凭证 E2E-RECEIPT",
    )
    page = Page.objects.create(workspace=project.workspace, owned_by=lead, name="财务共享实验版本")
    from plane.db.models import ProjectPage

    ProjectPage.objects.create(workspace=project.workspace, project=project, page=page)
    version = PageVersion.objects.create(
        workspace=project.workspace, page=page, owned_by=lead,
        description_html="<p>冻结的财务执行证据 v1</p>", description_json={"type": "doc"},
    )
    PageVersion.objects.create(workspace=project.workspace, page=page, owned_by=lead,
                               description_html="<p>未共享的新版本</p>")

print(json.dumps({
    "stage": str(stage.id), "bounty": str(bounty.id), "issue": str(issue.id), "user": str(lead.id),
    "item": str(item.id), "category_color": category.color, "formula_version": formula.version,
    "task_forecast": str(task_forecast.id), "member_forecast": str(member_forecast.id),
    "task_amount": str(task_forecast.result), "member_amount": str(member_forecast.result),
    "batch": receipt["id"], "version": str(version.id),
}))
