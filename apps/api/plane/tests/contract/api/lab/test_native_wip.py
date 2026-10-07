# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.core.management import call_command
from django.db import IntegrityError, close_old_connections, transaction
from django.test import Client

from plane.db.models import APIToken, Issue, IssueAssignee, Project, ProjectMember, State, Workspace
from plane.lab.models import Credential, WorkspacePolicy

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture
def native_workspace(laboratory, settings, monkeypatch):
    from plane.app.views.issue import base as issue_views
    from plane.app.views.workspace import base as workspace_views

    settings.LAB_AUTH_ENABLED = True
    for task in (
        workspace_views.workspace_seed,
        workspace_views.track_event,
        issue_views.issue_activity,
        issue_views.model_activity,
        issue_views.issue_description_version_task,
    ):
        monkeypatch.setattr(task, "delay", lambda *args, **kwargs: None)
    user = laboratory["member"]
    credential = Credential.objects.create(user=user, encrypted_secret="unused-by-session-fixture")
    client = Client()
    client.force_login(user)
    session = client.session
    session["lab_generation"] = str(credential.generation)
    session.save()
    response = client.post(
        "/api/workspaces/", {"name": "Native workspace", "slug": "native-only"}, content_type="application/json"
    )
    assert response.status_code == 201, response.content
    workspace = Workspace.objects.get(id=response.json()["id"])
    assert WorkspacePolicy.objects.filter(workspace=workspace).exists()
    project = Project.objects.create(workspace=workspace, name="Native project", identifier="NW", project_lead=user)
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20)
    todo = State.objects.create(workspace=workspace, project=project, name="Todo", group="unstarted", default=True)
    active = State.objects.create(workspace=workspace, project=project, name="Active", group="started")
    return client, user, project, todo, active, f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"


@pytest.mark.parametrize("transport", ["app", "api"])
def test_native_workspace_enforces_wip_before_any_lab_page_and_rolls_back_assignment(native_workspace, transport):
    client, user, project, todo, active, endpoint = native_workspace
    if transport == "api":
        token = APIToken.objects.create(user=user, label="Native API contract")
        client = Client(HTTP_X_API_KEY=token.token)
        endpoint = endpoint.replace("/api/", "/api/v1/", 1)
    state_field, assignee_field = ("state_id", "assignee_ids") if transport == "app" else ("state", "assignees")
    for number in range(2):
        response = client.post(
            endpoint,
            {"name": f"Active {number}", state_field: str(active.id), assignee_field: [str(user.id)]},
            content_type="application/json",
        )
        assert response.status_code == 201, response.content
    rejected = client.post(
        endpoint,
        {"name": "Over quota", state_field: str(active.id), assignee_field: [str(user.id)]},
        content_type="application/json",
    )
    assert rejected.status_code == 409, rejected.content
    assert Issue.objects.filter(project=project).count() == 2
    assert IssueAssignee.objects.filter(project=project, assignee=user).count() == 2
    waiting = Issue.objects.create(workspace=project.workspace, project=project, name="Waiting", state=todo)
    rejected = client.patch(
        endpoint + str(waiting.id) + "/",
        {state_field: str(active.id), assignee_field: [str(user.id)]},
        content_type="application/json",
    )
    assert rejected.status_code == 409, rejected.content
    waiting.refresh_from_db()
    assert waiting.state_id == todo.id
    assert not IssueAssignee.objects.filter(issue=waiting).exists()


def test_native_concurrent_creations_cannot_exceed_wip(native_workspace):
    client, user, project, todo, active, endpoint = native_workspace
    body = {"state_id": str(active.id), "assignee_ids": [str(user.id)]}
    assert client.post(endpoint, {**body, "name": "First"}, content_type="application/json").status_code == 201

    def create(index):
        close_old_connections()
        try:
            parallel = Client()
            parallel.cookies.update(client.cookies)
            return parallel.post(
                endpoint, {**body, "name": f"Parallel {index}"}, content_type="application/json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(create, (1, 2)))
    assert sorted(outcomes) == [201, 409]
    assert Issue.objects.filter(project=project, state=active).count() == 2
    assert IssueAssignee.objects.filter(project=project, assignee=user).count() == 2


def test_migrate_backfills_missing_policies_and_allows_existing_work_to_finish(laboratory, settings):
    lab = laboratory
    assert not WorkspacePolicy.objects.filter(workspace=lab["workspace"]).exists()
    tasks = []
    for number in range(3):
        issue = Issue.objects.create(
            workspace=lab["workspace"], project=lab["project"], name=f"Existing {number}", state=lab["states"]["active"]
        )
        IssueAssignee.objects.create(
            workspace=lab["workspace"], project=lab["project"], issue=issue, assignee=lab["member"]
        )
        tasks.append(issue)
    settings.LAB_AUTH_ENABLED = True
    call_command("migrate", interactive=False, verbosity=0)
    assert WorkspacePolicy.objects.filter(workspace=lab["workspace"]).exists()
    Issue.objects.filter(id=tasks[0].id).update(name="Existing work can be edited")
    with pytest.raises(IntegrityError), transaction.atomic():
        extra = Issue.objects.create(
            workspace=lab["workspace"], project=lab["project"], name="New work", state=lab["states"]["active"]
        )
        IssueAssignee.objects.create(
            workspace=lab["workspace"], project=lab["project"], issue=extra, assignee=lab["member"]
        )
    Issue.objects.filter(id=tasks[0].id).update(state=lab["states"]["done"])
    assert Issue.objects.filter(state=lab["states"]["active"]).count() == 2
