# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# Executed only against the isolated browser-test stack; project_id is validated by its caller.

import json
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember
from plane.lab.bounties import accept, approve_claim, claim, confirm_claim, publish, reverse, start, submit
from plane.lab.models import Ledger, PersonalItem, Stage, TimeBlock

with transaction.atomic():
    project = Project.objects.get(id=project_id, workspace__slug="browser-lab")
    lead = User.objects.get(username="e2e-admin")
    reviewer = User.objects.get(username="e2e-workflow-reviewer")
    participant, _ = User.objects.get_or_create(
        username="e2e-analytics-participant",
        defaults={"email": "analytics-participant@example.org", "display_name": "浏览器贡献成员"},
    )
    WorkspaceMember.objects.get_or_create(workspace=project.workspace, member=participant, defaults={"role": 15})
    ProjectMember.objects.get_or_create(
        workspace=project.workspace, project=project, member=participant, defaults={"role": 15}
    )
    today = timezone.now().astimezone(ZoneInfo("Asia/Shanghai")).date()
    todo = State.objects.filter(project=project, group="unstarted").first()
    overdue = Issue.objects.create(
        workspace=project.workspace,
        project=project,
        name="浏览器统计逾期任务",
        state=todo,
        target_date=today - timedelta(days=1),
    )
    issue = Issue.objects.create(
        workspace=project.workspace,
        project=project,
        name="浏览器统计悬赏",
        state=todo,
    )
    stage = Stage.objects.create(
        workspace=project.workspace,
        project=project,
        workspace_id_snapshot=project.workspace_id,
        project_id_snapshot=project.id,
        project_name=project.name,
        name="浏览器统计预算",
        budget=100,
        frozen_at=timezone.now(),
    )
    bounty = publish(
        lead,
        stage.id,
        {
            "issue_id": str(issue.id),
            "budget": "20",
            "deliverable": "可复验统计数据",
            "criteria": "原始记录与统计一致",
            "reviewer_id": str(reviewer.id),
        },
    )
    allocation = claim(participant, bounty.id, {"planned": "20", "deliverable": "实验分析"})
    approve_claim(lead, bounty.id, allocation.id)
    confirm_claim(participant, bounty.id)
    start(lead, bounty.id)
    for result, amount in (("partial", "10"), ("negative", "20")):
        submit(participant, bounty.id, "可复验的配置与有效探索记录")
        body = {
            "request_key": str(uuid.uuid4()),
            "result": result,
            "reason": "独立验收统计证据",
            "targets": {str(allocation.id): amount},
        }
        accept(reviewer, bounty.id, body)
        # Reusing the exact key must not grant a second contribution.
        accept(reviewer, bounty.id, body)
    first_award = Ledger.objects.filter(bounty=bounty, delta=10).order_by("created_at").first()
    reverse(lead, first_award.id, {"request_key": str(uuid.uuid4()), "reason": "浏览器审计冲正"})
    item = PersonalItem.objects.create(
        workspace=project.workspace,
        user=participant,
        title="NEVER_EXPOSE_PRIVATE_TITLE",
        description="NEVER_EXPOSE_PRIVATE_DESCRIPTION",
        kind="study",
        public=False,
    )
    for begin, finish in ((9, 11), (10, 12)):
        TimeBlock.objects.create(
            item=item,
            start=datetime.combine(today, time(begin), tzinfo=ZoneInfo("Asia/Shanghai")),
            end=datetime.combine(today, time(finish), tzinfo=ZoneInfo("Asia/Shanghai")),
        )

print(
    json.dumps(
        {
            "project": str(project.id),
            "project_name": project.name,
            "bounty": str(bounty.id),
            "stage": str(stage.id),
            "issue": str(issue.id),
            "participant": str(participant.id),
            "today": today.isoformat(),
            "tomorrow": (today + timedelta(days=1)).isoformat(),
            "overdue": str(overdue.id),
        }
    )
)
