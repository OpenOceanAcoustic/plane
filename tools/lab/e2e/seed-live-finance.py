# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# Used only by the guarded isolated browser test.
import json
import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember
from plane.lab.finance_services import perform
from plane.lab.models import Stage

with transaction.atomic():
    lead = User.objects.get(username="e2e-live-finance-admin")
    workspace = Workspace.objects.get(slug="browser-money-lab")
    suffix = uuid.uuid4().hex[:6].upper()
    project = Project.objects.create(
        workspace=workspace, name=f"Live financial limits {suffix}", identifier=f"LIVE{suffix}", project_lead=lead
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=lead, role=20)
    states = {
        key: State.objects.create(workspace=workspace, project=project, name=key, group=group, default=key == "todo")
        for key, group in (("todo", "unstarted"), ("active", "started"), ("done", "completed"))
    }
    issue = Issue.objects.create(
        workspace=workspace, project=project, name="Same reviewer bounty", state=states["todo"], created_by=lead
    )
    Stage.objects.create(
        workspace=workspace,
        project=project,
        workspace_id_snapshot=workspace.id,
        project_id_snapshot=project.id,
        project_name=project.name,
        name="实时VC配额",
        budget=Decimal("100"),
        frozen_at=timezone.now(),
    )
    opening = perform(
        lead,
        workspace,
        "opening",
        {
            "request_key": str(uuid.uuid4()),
            "project_id": str(project.id),
            "kind": "project",
            "amount": "12.50",
            "source": "隔离实际资金",
            "reason": "真实输入上限验收",
            "evidence": "E2E-OPENING",
        },
    )
    member = User.objects.create(
        username=f"e2e-live-participant-{suffix.lower()}",
        email=f"participant-{suffix.lower()}@example.org",
        display_name="真实悬赏参与者",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    ProjectMember.objects.create(workspace=workspace, project=project, member=member, role=15)
print(
    json.dumps(
        {
            "project": str(project.id),
            "issue": str(issue.id),
            "lead": str(lead.id),
            "account": opening["id"],
            "member": str(member.id),
        }
    )
)
