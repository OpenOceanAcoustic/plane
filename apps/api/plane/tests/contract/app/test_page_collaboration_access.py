import pytest
import json
from datetime import timedelta
from unittest.mock import Mock
from django.test import Client, override_settings
from django.utils import timezone
from plane.db.models import Page, Project, ProjectMember, ProjectPage, Session, User, WorkspaceMember


@pytest.fixture
def collaboration(workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="Test", identifier="COLLAB")
    membership = ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    owner = User.objects.create(email="owner@example.org", username="owner")
    page = Page.objects.create(workspace=workspace, owned_by=owner, name="Fixture", access=Page.PUBLIC_ACCESS)
    link = ProjectPage.objects.create(workspace=workspace, project=project, page=page)
    client = Client()
    client.force_login(create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/{page.id}/collaboration-access/"
    return client, url, project, membership, page, link


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
def test_collaboration_access_is_pure_and_reports_persisted_session_expiry(workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="Test", identifier="COLLAB")
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Fixture", is_locked=True)
    ProjectPage.objects.create(workspace=workspace, project=project, page=page)
    client = Client()
    client.force_login(create_user)
    session = Session.objects.get(session_key=client.session.session_key)
    response = client.get(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/{page.id}/collaboration-access/"
    )
    assert response.status_code == 200
    assert response.json() == {
        "document": {
            "id": str(page.id),
            "type": "project_page",
            "workspace_id": str(workspace.id),
            "workspace_slug": workspace.slug,
            "project_id": str(project.id),
        },
        "user": {"id": str(create_user.id), "display_name": create_user.display_name},
        "can_read": True,
        "can_write": False,
        "session_expires_at": session.expire_date.isoformat(),
        "credential_generation": None,
    }
    assert "no-store" in response["Cache-Control"]


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
@pytest.mark.parametrize(
    "role,owner,locked,archived,status,writable",
    [
        (20, False, False, False, 200, True),
        (15, False, False, False, 200, True),
        (5, False, False, False, 200, False),
        (5, True, False, False, 200, True),
        (20, True, True, False, 200, False),
        (20, True, False, True, 200, False),
    ],
)
def test_collaboration_preserves_page_roles_and_lock_archive_rules(
    collaboration, create_user, role, owner, locked, archived, status, writable
):
    client, url, project, membership, page, _ = collaboration
    membership.role = role
    membership.save()
    project.guest_view_all_features = True
    project.save()
    if owner:
        page.owned_by = create_user
    page.is_locked = locked
    page.archived_at = timezone.now() if archived else None
    page.save()
    response = client.get(url)
    assert response.status_code == status
    assert response.json()["can_read"] is True
    assert response.json()["can_write"] is writable


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
@pytest.mark.parametrize(
    "change",
    [
        "private",
        "project",
        "project-member",
        "workspace-member",
        "link",
        "archived-project",
        "guest-disabled",
        "inactive-user",
        "deleted-workspace",
    ],
)
def test_collaboration_denies_invalid_scope_and_revoked_membership(collaboration, create_user, change):
    client, url, project, membership, page, link = collaboration
    if change == "private":
        page.access = Page.PRIVATE_ACCESS
        page.save()
    elif change == "project":
        other = Project.objects.create(workspace=project.workspace, name="Other", identifier="OTHER")
        ProjectMember.objects.create(workspace=project.workspace, project=other, member=create_user, role=20)
        url = url.replace(str(project.id), str(other.id))
    elif change == "project-member":
        membership.is_active = False
        membership.save()
    elif change == "workspace-member":
        member = WorkspaceMember.objects.get(workspace=project.workspace, member=create_user)
        member.is_active = False
        member.save()
    elif change == "link":
        link.delete()
    elif change == "archived-project":
        project.archived_at = timezone.now()
        project.save()
    elif change == "guest-disabled":
        membership.role = 5
        membership.save()
        project.guest_view_all_features = False
        project.save()
    elif change == "inactive-user":
        create_user.is_active = False
        create_user.save()
    elif change == "deleted-workspace":
        project.workspace.deleted_at = timezone.now()
        project.workspace.save()
    assert client.get(url).status_code in (401, 403)


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
def test_workspace_scope_changes_publish_after_commit_via_http(
    collaboration, monkeypatch, django_capture_on_commit_callbacks
):
    client, url, project, _, _, _ = collaboration
    redis = Mock()
    monkeypatch.setattr("plane.app.page_signals.redis_instance", lambda: redis)
    with django_capture_on_commit_callbacks(execute=True):
        response = client.patch(
            f"/api/workspaces/{project.workspace.slug}/", {"slug": "renamed-workspace"}, content_type="application/json"
        )
        assert response.status_code == 200
        redis.publish.assert_not_called()
    event = json.loads(redis.publish.call_args.args[1])
    assert event["command"] == "invalidate_access"
    assert event["workspaceId"] == str(project.workspace_id)
    assert client.get(url).status_code == 403


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=True)
def test_collaboration_reports_generation_and_denies_replaced_credentials(collaboration, create_user):
    from plane.lab.models import Credential

    client, url, _, _, _, _ = collaboration
    credential = Credential.objects.create(user=create_user, encrypted_secret="not-used-by-this-test")
    session = client.session
    session["lab_generation"] = str(credential.generation)
    session["lab_purpose"] = "user"
    session["lab_expires_at"] = (timezone.now() + timedelta(hours=12)).timestamp()
    session.save()
    response = client.get(url)
    assert response.status_code == 200
    assert response.json()["credential_generation"] == str(credential.generation)
    import uuid

    credential.generation = uuid.uuid4()
    credential.save()
    assert client.get(url).status_code == 401


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
def test_permission_changes_publish_only_after_commit_via_http(
    collaboration, create_user, monkeypatch, django_capture_on_commit_callbacks
):
    client, url, project, _, page, _ = collaboration
    page.owned_by = create_user
    page.save()
    redis = Mock()
    monkeypatch.setattr("plane.app.page_signals.redis_instance", lambda: redis)
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(url.replace("collaboration-access/", "lock/"))
        assert response.status_code == 204
        redis.publish.assert_not_called()
    channel, message = redis.publish.call_args.args
    event = json.loads(message)
    assert channel == "hocuspocus:admin"
    assert event["command"] == "invalidate_access"
    assert event["pageId"] == str(page.id)
    assert event["workspaceId"] == str(project.workspace_id)
    assert client.get(url).json()["can_write"] is False


@pytest.mark.contract
@pytest.mark.django_db
@override_settings(LAB_AUTH_ENABLED=False)
def test_live_write_challenge_passes_real_drf_csrf_checks(collaboration, create_user):
    _, url, _, _, page, _ = collaboration
    page.owned_by = create_user
    page.save()
    client = Client(enforce_csrf_checks=True)
    client.force_login(create_user)
    endpoint = url.replace("collaboration-access/", "")
    denied = client.patch(
        endpoint, {"name": "Denied"}, content_type="application/json", secure=True, HTTP_ORIGIN="https://testserver"
    )
    assert denied.status_code == 403
    challenge = client.get("/auth/get-csrf-token/", secure=True, HTTP_ORIGIN="https://testserver")
    token = challenge.json()["csrf_token"]
    response = client.patch(
        endpoint,
        {"name": "Allowed"},
        content_type="application/json",
        secure=True,
        HTTP_ORIGIN="https://testserver",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    page.refresh_from_db()
    assert page.name == "Allowed"
