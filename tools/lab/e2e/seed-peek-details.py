# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# This fixture is run only by the isolated ooa-plane-e2e browser test.
import json
import uuid
from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from plane.db.models import Issue, Page, Project, ProjectMember, ProjectPage, State, User, Workspace, WorkspaceMember
from plane.lab.bounties import approve_claim, claim, confirm_claim, publish
from plane.lab.document_models import TaskDocumentLink
from plane.lab.field_models import FieldDefinition, IssueFieldValue, ProjectField
from plane.lab.models import Stage
from plane.lab.planning import configure_flow

with transaction.atomic():
    lead = User.objects.get(username="e2e-detail-admin")
    workspace = Workspace.objects.get(slug="browser-peek-lab")
    suffix = uuid.uuid4().hex[:6].upper()
    project = Project.objects.create(
        workspace=workspace, name=f"Work item detail parity {suffix}", identifier=f"PEEK{suffix}", project_lead=lead
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=lead, role=20)
    states = {
        key: State.objects.create(workspace=workspace, project=project, name=key, group=group, default=key == "todo")
        for key, group in (("todo", "unstarted"), ("active", "started"), ("review", "started"), ("done", "completed"))
    }
    configure_flow(lead, project, {key: str(state.id) for key, state in states.items()})
    ordinary = Issue.objects.create(
        workspace=workspace,
        project=project,
        name="Ordinary native detail",
        state=states["todo"],
        created_by=lead,
        priority="low",
        description_html="<p>同一工作项的完整原生说明</p>",
    )
    issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        name="Bounty native detail",
        state=states["todo"],
        created_by=lead,
        priority="medium",
        description_html="<p>悬赏工作项的完整原生说明</p>",
    )
    field = FieldDefinition.objects.create(workspace=workspace, name="实测实验参数", kind="text")
    ProjectField.objects.create(project=project, field=field)
    for task in (ordinary, issue):
        IssueFieldValue.objects.create(issue=task, field=field, value="相同原始参数 42")
        document = Page.objects.create(workspace=workspace, owned_by=lead, name=f"{task.name}关联实验记录")
        ProjectPage.objects.create(workspace=workspace, project=project, page=document)
        TaskDocumentLink.objects.create(workspace=workspace, issue=task, page=document)
    reviewer = User.objects.create(
        username=f"peek-reviewer-{project.id.hex[:8]}", email=f"peek-reviewer-{project.id.hex[:8]}@example.org"
    )
    WorkspaceMember.objects.create(workspace=workspace, member=reviewer, role=15)
    ProjectMember.objects.create(workspace=workspace, project=project, member=reviewer, role=15)
    stage = Stage.objects.create(
        workspace=workspace,
        project=project,
        workspace_id_snapshot=workspace.id,
        project_id_snapshot=project.id,
        project_name=project.name,
        name="详情验证VC预算",
        budget=Decimal("100"),
        frozen_at=timezone.now(),
    )
    bounty = publish(
        lead,
        stage.id,
        {
            "issue_id": str(issue.id),
            "budget": "12.50",
            "deliverable": "关联实验结果",
            "criteria": "实测参数完整",
            "reviewer_id": str(reviewer.id),
        },
    )
    allocation = claim(lead, bounty.id, {"planned": "12.50", "deliverable": "实验记录"})
    approve_claim(lead, bounty.id, allocation.id)
    confirm_claim(lead, bounty.id)
print(
    json.dumps(
        {
            "project": str(project.id),
            "ordinary": str(ordinary.id),
            "issue": str(issue.id),
            "bounty": str(bounty.id),
            "field": str(field.id),
        }
    )
)
