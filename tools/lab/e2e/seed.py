# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# Executed with manage.py shell only against the isolated browser test stack.
import json
from datetime import date
from django.db import transaction
from plane.db.models import User, Workspace, Project, ProjectMember, State, Issue
from plane.lab.planning import configure_flow

with transaction.atomic():
    user = User.objects.get(username="e2e-admin")
    workspace = Workspace.objects.get(slug="browser-lab")
    project = Project.objects.create(
        workspace=workspace,
        name="Browser acoustics",
        identifier="E2E",
        project_lead=user,
    )
    ProjectMember.objects.create(
        workspace=workspace, project=project, member=user, role=20
    )
    states = {
        key: State.objects.create(
            workspace=workspace,
            project=project,
            name=key,
            group=group,
            default=key == "todo",
        )
        for key, group in (
            ("todo", "unstarted"),
            ("active", "started"),
            ("review", "started"),
            ("done", "completed"),
        )
    }
    configure_flow(user, project, {key: str(state.id) for key, state in states.items()})
    issue = Issue.objects.create(
        workspace=workspace,
        project=project,
        name="Original project task",
        state=states["todo"],
        start_date=date.today(),
        target_date=date.today(),
    )
print(json.dumps({"project": str(project.id), "issue": str(issue.id)}))
