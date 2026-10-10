# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import io
from urllib.parse import urlparse

import pyotp
import pytest
from cryptography.fernet import Fernet
from django.db import close_old_connections
from django.core.management import call_command
from django.test import Client
from django.urls import resolve
from freezegun import freeze_time

from .test_auth import bootstrap, post

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture
def token_client(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()
    resolve("/auth/lab/sign-in/")
    with freeze_time("2026-10-08 03:00:00"):
        enrollment = bootstrap(Client())
        totp = pyotp.parse_uri(enrollment["otpauth"])
        assert post("confirm", {"token": enrollment["token"], "code": totp.now()}).status_code == 201
    with freeze_time("2026-10-08 03:00:30"):
        client = Client()
        assert post("sign-in", {"username": "alice", "code": totp.now()}, client).status_code == 200
        yield client


def test_api_token_defaults_to_thirty_days_and_expiry_stays_readonly(token_client):
    response = token_client.post(
        "/api/users/api-tokens/", {"label": "Default lifetime"}, content_type="application/json"
    )
    assert response.status_code == 201
    assert datetime.fromisoformat(response.json()["expired_at"]) == datetime.fromisoformat("2026-11-07T03:00:30+00:00")
    patched = token_client.patch(
        f"/api/users/api-tokens/{response.json()['id']}/",
        {"expired_at": None, "label": "Renamed"},
        content_type="application/json",
    )
    assert patched.status_code == 200
    assert datetime.fromisoformat(patched.json()["expired_at"]) == datetime.fromisoformat("2026-11-07T03:00:30+00:00")


def test_api_token_cap_cannot_be_exceeded_by_concurrent_creations(token_client):
    def create(number):
        close_old_connections()
        try:
            client = Client()
            client.cookies.update(token_client.cookies)
            return client.post(
                "/api/users/api-tokens/", {"label": f"Parallel {number}"}, content_type="application/json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create, range(8)))
    assert sorted(results) == [201] * 5 + [409] * 3
    assert len(token_client.get("/api/users/api-tokens/").json()) == 5


@pytest.mark.parametrize("expiry", ["2027-01-07T03:00:30Z", "2026-10-08T03:00:00Z", "invalid-timestamp"])
def test_api_token_rejects_invalid_past_or_over_ninety_day_expiry(token_client, expiry):
    response = token_client.post(
        "/api/users/api-tokens/",
        {"label": "Bounded lifetime", "expired_at": expiry},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_TOKEN_EXPIRY"
    assert token_client.get("/api/users/api-tokens/").json() == []


def test_rebinding_shows_previous_api_tokens_as_inactive(token_client):
    created = token_client.post("/api/users/api-tokens/", {"label": "Before recovery"}, content_type="application/json")
    assert created.status_code == 201
    output = io.StringIO()
    call_command("lab_access", "reset", username="alice", stdout=output)
    invitation = urlparse(output.getvalue().strip().splitlines()[-1]).fragment
    enrollment = post("enroll", {"token": invitation}).json()
    totp = pyotp.parse_uri(enrollment["otpauth"])
    assert post("confirm", {"token": enrollment["token"], "code": totp.now()}).status_code == 201
    with freeze_time("2026-10-08 03:01:00"):
        client = Client()
        assert post("sign-in", {"username": "alice", "code": totp.now()}, client).status_code == 200
        assert client.get("/api/users/api-tokens/").json()[0]["is_active"] is False
