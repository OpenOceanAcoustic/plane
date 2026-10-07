# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Lab authentication contracts through the public HTTP and SSH command seams."""

import io
from urllib.parse import urlparse

import pyotp
import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import Client
from freezegun import freeze_time
from concurrent.futures import ThreadPoolExecutor
from django.db import close_old_connections

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.unit]


@pytest.fixture(autouse=True)
def lab_settings(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()


def bootstrap(client):
    output = io.StringIO()
    call_command("lab_access", "bootstrap", workspace="laboratory", stdout=output)
    token = urlparse(output.getvalue().strip().splitlines()[-1]).fragment
    start = client.post(
        "/auth/lab/enroll/",
        {"token": token, "username": "Alice", "display_name": "Alice", "email": "alice@example.org"},
        content_type="application/json",
    )
    assert start.status_code == 200, start.content
    return start.json()


def test_bootstrap_requires_totp_and_disables_legacy_paths():
    client = Client()
    enrollment = bootstrap(client)
    assert client.get("/api/users/me/").status_code in (401, 403)
    for path in (
        "/auth/sign-up/",
        "/auth/sign-in/",
        "/auth/magic-sign-in/",
        "/auth/spaces/sign-up/",
        "/api/instances/admins/sign-up/",
        "/auth/google/",
    ):
        assert client.post(path).status_code == 403
    code = pyotp.parse_uri(enrollment["otpauth"]).now()
    response = client.post(
        "/auth/lab/confirm/", {"token": enrollment["token"], "code": code}, content_type="application/json"
    )
    assert response.status_code == 201, response.content
    from plane.db.models import User, WorkspaceMember

    assert User.objects.get(username="alice").has_usable_password() is False
    assert WorkspaceMember.objects.filter(workspace__slug="laboratory", member__username="alice", role=20).exists()
    assert (
        client.post(
            "/auth/lab/confirm/", {"token": enrollment["token"], "code": code}, content_type="application/json"
        ).status_code
        == 400
    )


def test_totp_replay_and_durable_account_limit():
    from freezegun import freeze_time

    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        authenticator = pyotp.parse_uri(enrollment["otpauth"])
        assert (
            Client()
            .post(
                "/auth/lab/confirm/",
                {"token": enrollment["token"], "code": authenticator.now()},
                content_type="application/json",
            )
            .status_code
            == 201
        )
    with freeze_time("2026-10-08 03:00:30"):
        client = Client()
        body = {"username": "ALICE", "code": authenticator.now()}
        assert client.post("/auth/lab/sign-in/", body, content_type="application/json").status_code == 200
        assert Client().post("/auth/lab/sign-in/", body, content_type="application/json").status_code == 401
        for _ in range(3):
            assert (
                Client()
                .post(
                    "/auth/lab/sign-in/",
                    {"username": "alice", "code": "000000"},
                    content_type="application/json",
                    REMOTE_ADDR="10.0.0.2",
                )
                .status_code
                == 401
            )
        limited = Client().post("/auth/lab/sign-in/", body, content_type="application/json")
        assert limited.status_code == 429
        assert int(limited["Retry-After"]) == 600
    with freeze_time("2026-10-08 03:10:30"):
        assert (
            Client()
            .post(
                "/auth/lab/sign-in/",
                {"username": "alice", "code": authenticator.now()},
                content_type="application/json",
            )
            .status_code
            == 200
        )


def post(path, body, client=None):
    return (client or Client()).post("/auth/lab/" + path + "/", body, content_type="application/json")


def test_csrf_is_required_even_for_anonymous_login_and_binding():
    client = Client(enforce_csrf_checks=True)
    assert post("sign-in", {"username": "alice", "code": "123456"}, client).status_code == 403
    response = client.get("/auth/get-csrf-token/")
    csrf = response.json()["csrf_token"]
    assert (
        client.post(
            "/auth/lab/sign-in/",
            {"username": "unknown", "code": "123456"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        ).status_code
        == 401
    )


def test_revocation_expiry_and_preview_do_not_consume_invitation():
    from plane.lab.models import Invitation

    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        invitation = Invitation.objects.get()
        assert Client().get("/auth/lab/confirm/").status_code == 405
        invitation.refresh_from_db()
        assert invitation.consumed_at is None
        assert post("enroll", {"token": "not-an-invitation"}).status_code == 400
        output = io.StringIO()
        call_command("lab_access", "revoke", id=str(invitation.id), stdout=output)
        assert (
            post(
                "confirm", {"token": enrollment["token"], "code": pyotp.parse_uri(enrollment["otpauth"]).now()}
            ).status_code
            == 400
        )
        # A fresh bootstrap invitation is allowed once the first one is revoked.
        enrollment = bootstrap(Client())
    with freeze_time("2026-10-09 03:00:00"):
        assert (
            post(
                "confirm", {"token": enrollment["token"], "code": pyotp.parse_uri(enrollment["otpauth"]).now()}
            ).status_code
            == 400
        )


def test_concurrent_registration_consumes_once():
    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        body = {"token": enrollment["token"], "code": pyotp.parse_uri(enrollment["otpauth"]).now()}

        def complete(_):
            close_old_connections()
            try:
                return post("confirm", body).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(complete, range(2)))
        assert sorted(results) == [201, 400]


def test_concurrent_login_cannot_exceed_five_submissions():
    from plane.lab.models import LoginAttempt

    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        authenticator = pyotp.parse_uri(enrollment["otpauth"])
        assert post("confirm", {"token": enrollment["token"], "code": authenticator.now()}).status_code == 201
    with freeze_time("2026-10-08 03:00:30"):

        def attempt(_):
            close_old_connections()
            try:
                return post("sign-in", {"username": "ALICE", "code": "000000"}).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        assert results.count(401) == 5
        assert results.count(429) == 3
        assert LoginAttempt.objects.count() == 5


def test_reset_invalidates_sessions_tokens_and_old_authenticator_preserves_user():
    from plane.db.models import APIToken, User

    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        old = pyotp.parse_uri(enrollment["otpauth"])
        assert post("confirm", {"token": enrollment["token"], "code": old.now()}).status_code == 201
        original = User.objects.get(username="alice")
        api_token = APIToken.objects.create(user=original, label="recovery test", token="test-key")
    with freeze_time("2026-10-08 03:00:30"):
        app = Client()
        admin = Client()
        assert post("sign-in", {"username": "alice", "code": old.now()}, app).status_code == 200
    with freeze_time("2026-10-08 03:01:00"):
        assert post("admin/sign-in", {"username": "alice", "code": old.now()}, admin).status_code == 200
        assert "admin-session-id" in admin.cookies
        output = io.StringIO()
        call_command("lab_access", "reset", username="alice", stdout=output)
        api_token.refresh_from_db()
        assert not api_token.is_active
        assert app.get("/api/users/me/").status_code == 401
        assert admin.get("/api/instances/admins/me/").status_code == 401
        assert post("sign-in", {"username": "alice", "code": old.now()}).status_code == 401
        token = urlparse(output.getvalue().strip().splitlines()[-1]).fragment
        start = post("enroll", {"token": token})
        assert start.status_code == 200
        new = start.json()
        authenticator = pyotp.parse_uri(new["otpauth"])
        assert authenticator.secret != old.secret
        assert post("confirm", {"token": new["token"], "code": authenticator.now()}).status_code == 201
        assert User.objects.get(username="alice").id == original.id
    with freeze_time("2026-10-08 03:01:30"):
        assert post("sign-in", {"username": "alice", "code": authenticator.now()}).status_code == 200
        original.is_active = False
        original.save(update_fields=["is_active"])
    with freeze_time("2026-10-08 03:02:00"):
        assert post("sign-in", {"username": "alice", "code": authenticator.now()}).status_code == 401
