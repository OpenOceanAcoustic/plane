# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from rest_framework.test import APIClient
from plane.db.models import User, Workspace, WorkspaceMember, Project, ProjectMember, State


@pytest.fixture
def laboratory(settings):
    settings.LAB_AUTH_ENABLED = False  # Business contracts use DRF's authenticated client seam.
    lead = User.objects.create(username="leader", email="lead@example.org", display_name="负责人")
    member = User.objects.create(username="member", email="member@example.org", display_name="成员")
    reviewer = User.objects.create(username="reviewer", email="review@example.org", display_name="验收人")
    independent = User.objects.create(username="independent", email="independent@example.org", display_name="复核人")
    workspace = Workspace.objects.create(name="Lab", slug="lab", owner=lead, timezone="Asia/Shanghai")
    for user in (lead, member, reviewer, independent):
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=20 if user == lead else 15)
    project = Project.objects.create(workspace=workspace, name="Acoustics", identifier="OA", project_lead=lead)
    for user in (lead, member, reviewer, independent):
        ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20 if user == lead else 15)
    states = {
        key: State.objects.create(workspace=workspace, project=project, name=key, group=group, default=key == "todo")
        for key, group in (("todo", "unstarted"), ("active", "started"), ("review", "started"), ("done", "completed"))
    }

    def client(user):
        result = APIClient()
        result.force_authenticate(user=user)
        return result

    return {
        "lead": lead,
        "member": member,
        "reviewer": reviewer,
        "independent": independent,
        "workspace": workspace,
        "project": project,
        "states": states,
        "client": client,
        "base": "/api/workspaces/lab/lab/",
    }
