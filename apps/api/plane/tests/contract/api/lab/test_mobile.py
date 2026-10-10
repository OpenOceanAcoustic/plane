# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Android contracts through real cookie-authenticated HTTP requests."""

import json

import pyotp
import pytest
from cryptography.fernet import Fernet
from django.test import Client
from django.utils import timezone

from plane.db.models import Page, ProjectPage, Session, User
from plane.lab.models import Credential
from plane.license.models import Instance, InstanceAdmin

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture
def mobile_identity(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()
    user = User.objects.create(username="android", email="android@example.org", display_name="Android")
    secret = pyotp.random_base32()
    credential = Credential.objects.create(
        user=user, encrypted_secret=Fernet(settings.LAB_TOTP_KEY.encode()).encrypt(secret.encode()).decode()
    )
    return user, pyotp.TOTP(secret), credential


def login(client, authenticator, admin=False):
    path = "/auth/lab/mobile/admin/sign-in/" if admin else "/auth/lab/mobile/sign-in/"
    return client.post(path, {"username": "android", "code": authenticator.now()}, content_type="application/json")


def test_mobile_login_session_and_replay(mobile_identity):
    user, totp, _ = mobile_identity
    client = Client()
    response = login(client, totp)
    assert response.status_code == 200
    assert response.json()["client_platform"] == "android"
    assert response.json()["capabilities"]["data_export"] is False
    assert "session-id" in client.cookies
    session = client.get("/api/lab/session/")
    assert session.status_code == 200
    assert session.json()["user"]["id"] == str(user.id)
    assert session.json()["client_platform"] == "android"
    assert session.json()["mobile_api_version"] == 1
    assert login(Client(), totp).status_code == 401
    assert Client().get("/api/lab/session/").status_code == 401


def test_mobile_admin_has_independent_cookie_and_role_gate(mobile_identity):
    user, totp, _ = mobile_identity
    assert login(Client(), totp, admin=True).status_code == 401
    instance = Instance.objects.create(instance_name="Mobile contract", current_version="1.4.2", last_checked_at=timezone.now())
    InstanceAdmin.objects.create(instance=instance, user=user)
    client = Client()
    assert login(client, totp, admin=True).status_code == 200
    assert "admin-session-id" in client.cookies
    assert "session-id" not in client.cookies
    session = Session.objects.get(session_key=client.cookies["admin-session-id"].value).get_decoded()
    assert session["lab_purpose"] == "admin"
    assert session["lab_client"] == "android"
    assert session["lab_expires_at"] > timezone.now().timestamp()
    assert session["lab_admin_reauthenticated_at"] > timezone.now().timestamp() - 10
    assert client.get("/api/lab/session/?admin=true").json()["client_platform"] == "android"
    assert client.get("/api/lab/session/").status_code == 401


def test_mobile_auth_requires_csrf_and_never_trusts_client_platform(mobile_identity):
    _, totp, _ = mobile_identity
    client = Client(enforce_csrf_checks=True)
    assert login(client, totp).status_code == 403
    csrf = client.get("/auth/get-csrf-token/").json()["csrf_token"]
    response = client.post(
        "/auth/lab/mobile/sign-in/",
        {"username": "android", "code": totp.now(), "client_platform": "web", "lab_client": "web"},
        content_type="application/json", HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 200
    assert client.get("/api/lab/session/").json()["capabilities"]["data_export"] is False


@pytest.mark.parametrize("path", [
    "/api/workspaces/lab/lab/planning-export/",
    "/api/workspaces/lab/lab/planner/?format=csv",
    "/api/workspaces/lab/lab/analytics/?format=csv",
    "/api/workspaces/lab/lab/analytics/?format=png",
    "/api/workspaces/lab/lab/analytics/?format=svg",
    "/api/workspaces/lab/lab/finance/entries/?format=csv",
    "/api/workspaces/lab/export-issues/",
    "/api/workspaces/lab/export-analytics/",
    "/api/workspaces/lab/user-activity/00000000-0000-0000-0000-000000000001/export/",
])
def test_mobile_cannot_request_dedicated_export_directly(mobile_identity, path):
    _, totp, _ = mobile_identity
    client = Client()
    assert login(client, totp).status_code == 200
    response = client.get(path)
    assert response.status_code == 403
    assert response.json()["code"] == "mobile_export_disabled"


def test_web_login_preserves_export_capability(mobile_identity):
    _, totp, _ = mobile_identity
    client = Client()
    response = client.post("/auth/lab/sign-in/", {"username": "android", "code": totp.now()}, content_type="application/json")
    assert response.status_code == 200
    assert client.get("/api/lab/session/").json()["capabilities"]["data_export"] is True


def test_instance_advertises_mobile_api_version():
    assert Client().get("/api/instances/").json()["mobile_api_version"] == 1


def test_recovery_revokes_mobile_session(mobile_identity):
    _, totp, credential = mobile_identity
    client = Client()
    assert login(client, totp).status_code == 200
    credential.enabled = False
    credential.save(update_fields=["enabled"])
    assert client.get("/api/lab/session/").status_code == 401


def test_mobile_json_reads_workspaces_named_export(laboratory):
    lab = laboratory
    lab["workspace"].slug = "export-lab"
    lab["workspace"].save(update_fields=["slug"])
    client = Client()
    client.force_login(lab["member"])
    session = client.session
    session["lab_client"] = "android"
    session.save()
    assert client.get("/api/workspaces/export-lab/lab/planner/").status_code == 200
    denied = client.get("/api/workspaces/export-lab/lab/planning-export/")
    assert denied.status_code == 403
    assert denied.json()["code"] == "mobile_export_disabled"


def test_ticket_is_short_lived_and_page_session_bound(laboratory, settings):
    lab = laboratory
    client = Client()
    client.force_login(lab["member"])
    session = client.session
    session["lab_client"] = "android"
    session.save()
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["member"], name="Collaborative mobile")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    response = client.post(lab["base"] + "live-ticket/", {"project_id": str(lab["project"].id), "page_id": str(page.id)}, content_type="application/json")
    assert response.status_code == 201
    body = response.json()
    assert body["expires_in"] == 60
    assert body["document_name"] == str(page.id)
    assert body["read_only"] is False
    assert "cookie" not in body
    from plane.lab.mobile import ticket_key
    from plane.settings.redis import redis_instance
    redis = redis_instance()
    key = ticket_key(body["ticket"])
    assert 0 < redis.ttl(key) <= 60
    stored = json.loads(redis.getdel(key))
    assert stored["user_id"] == str(lab["member"].id)
    assert stored["page_id"] == str(page.id)
    assert stored["workspace_slug"] == "lab"
    assert stored["project_id"] == str(lab["project"].id)
    assert stored["cookie"] == "session-id=" + client.cookies["session-id"].value
    assert redis.getdel(key) is None


def test_ticket_rejects_private_pages_restricted_guests_and_missing_session(laboratory):
    from plane.db.models import ProjectMember
    lab = laboratory
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["lead"], name="Private", access=1)
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    body = {"project_id": str(lab["project"].id), "page_id": str(page.id)}
    client = Client()
    client.force_login(lab["member"])
    assert client.post(lab["base"] + "live-ticket/", body, content_type="application/json").status_code == 404
    page.access = 0
    page.save(update_fields=["access"])
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert client.post(lab["base"] + "live-ticket/", body, content_type="application/json").status_code == 403
    assert Client().post(lab["base"] + "live-ticket/", body, content_type="application/json").status_code in (401,403)

@pytest.mark.parametrize("restriction", ["locked", "archived", "guest"])
def test_readonly_live_ticket_retains_authorized_document_synchronization(laboratory, restriction):
    from plane.db.models import ProjectMember
    lab = laboratory
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["member"], name="Read-only collaboration")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    if restriction == "locked":
        page.is_locked = True
        page.save(update_fields=["is_locked"])
    elif restriction == "archived":
        page.archived_at = timezone.now()
        page.save(update_fields=["archived_at"])
    else:
        lab["project"].guest_view_all_features = True
        lab["project"].save(update_fields=["guest_view_all_features"])
        ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
        page.owned_by = lab["lead"]
        page.save(update_fields=["owned_by"])
    client = Client()
    client.force_login(lab["member"])
    response = client.post(lab["base"] + "live-ticket/", {"project_id": str(lab["project"].id), "page_id": str(page.id)}, content_type="application/json")
    assert response.status_code == 201
    assert response.json()["read_only"] is True
