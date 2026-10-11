# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Registration capability checks before the proxy serves any page."""

import io
import re
from datetime import timedelta
from urllib.parse import urlparse

import pyotp
import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import Client
from django.utils import timezone

from plane.lab.models import Enrollment, Invitation

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture(autouse=True)
def lab_settings(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()


def invitation():
    output = io.StringIO()
    call_command("lab_access", "bootstrap", workspace="entrance-lab", stdout=output)
    parsed = urlparse(output.getvalue().strip().splitlines()[-1])
    assert parsed.path.startswith("/lab/register/"), "SSH must issue a token-bearing page path"
    assert parsed.fragment == ""
    assert parsed.query == ""
    token = parsed.path.rsplit("/", 1)[-1]
    assert bool(re.fullmatch(r"[A-Za-z0-9_-]{43}", token))
    return token


def check(token, method="get"):
    return getattr(Client(), method)("/auth/lab/invitation/", HTTP_X_LAB_INVITATION_TOKEN=token)


def test_invitation_preview_is_read_only_and_never_cached():
    token = invitation()
    for method in ("get", "head", "get"):
        response = check(token, method)
        assert response.status_code == 200
        assert "no-store" in response["Cache-Control"]
        assert response["Referrer-Policy"] == "no-referrer"
    assert Invitation.objects.get().consumed_at is None
    assert Enrollment.objects.count() == 0


def test_binding_immediately_removes_access_to_registration_page():
    token = invitation()
    assert check(token).status_code == 200
    client = Client()
    started = client.post(
        "/auth/lab/enroll/",
        {"token": token, "username": "entrance-admin", "display_name": "Admin", "email": "admin@example.org"},
        content_type="application/json",
    )
    assert started.status_code == 200
    enrollment = started.json()
    confirmed = client.post(
        "/auth/lab/confirm/",
        {"token": enrollment["token"], "code": pyotp.parse_uri(enrollment["otpauth"]).now()},
        content_type="application/json",
    )
    assert confirmed.status_code == 201
    assert check(token).status_code == 404
    assert check(token, "head").status_code == 404
    assert client.post("/auth/lab/enroll/", {"token": token}, content_type="application/json").status_code == 400


@pytest.mark.parametrize("state", ["consumed_at", "revoked_at", "expires_at"])
def test_used_revoked_and_expired_invitations_return_the_same_404(state):
    token = invitation()
    Invitation.objects.update(**{state: timezone.now() - timedelta(seconds=1)})
    response = check(token)
    assert response.status_code == 404
    assert response.content == b"Not found"
    assert "no-store" in response["Cache-Control"]


@pytest.mark.parametrize("token", ["", "missing", "A" * 43, "A" * 100, "/" * 43])
def test_missing_unknown_and_malformed_tokens_return_404(token):
    assert check(token).status_code == 404
