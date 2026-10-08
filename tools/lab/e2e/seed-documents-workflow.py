# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# Executed only by the isolated browser test helper, which supplies project_id.

import json
from django.db import transaction
from django.utils import timezone
from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember
from plane.lab.bounties import publish
from plane.lab.models import Stage

with transaction.atomic():
    project = Project.objects.get(id=project_id, workspace__slug="browser-lab")
    lead = User.objects.get(username="e2e-admin")
    reviewer, _ = User.objects.get_or_create(
        username="e2e-workflow-reviewer",
        defaults={"email": "workflow-reviewer@example.org", "display_name": "浏览器独立验收人"},
    )
    WorkspaceMember.objects.get_or_create(workspace=project.workspace, member=reviewer, defaults={"role": 15})
    ProjectMember.objects.get_or_create(
        workspace=project.workspace, project=project, member=reviewer, defaults={"role": 15}
    )
    issue = Issue.objects.create(
        workspace=project.workspace, project=project, name="Workflow browser bounty",
        state_id=State.objects.filter(project=project, group="unstarted").first().id,
    )
    stage = Stage.objects.create(
        workspace=project.workspace, project=project,
        workspace_id_snapshot=project.workspace_id, project_id_snapshot=project.id,
        project_name=project.name, name="浏览器流程验收", budget=1000, frozen_at=timezone.now(),
    )
    bounty = publish(lead, stage.id, {
        "issue_id": str(issue.id), "budget": "20", "deliverable": "可复验实验记录",
        "criteria": "提供完整配置与结果", "reviewer_id": str(reviewer.id),
    })
print(json.dumps({"bounty": str(bounty.id), "issue": str(issue.id)}))
