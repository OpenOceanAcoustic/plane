# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Security admission contracts at the public HTTP boundary."""

import uuid

import pytest
from django.test import Client

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture(autouse=True)
def security_settings(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_SECURITY_LIMITS_ENABLED = True
    settings.LAB_SECURITY_NAMESPACE = "test-security-" + uuid.uuid4().hex
    settings.LAB_REQUEST_IP_LIMIT = 3
    settings.LAB_REQUEST_GLOBAL_LIMIT = 20


def test_csrf_requests_are_bounded_before_authentication():
    client = Client()
    assert [client.get("/auth/get-csrf-token/").status_code for _ in range(4)] == [200, 200, 200, 429]


def test_cookie_business_write_requires_csrf(settings, create_user):
    settings.LAB_AUTH_ENABLED = False
    settings.LAB_REQUEST_IP_LIMIT = 20
    client = Client(enforce_csrf_checks=True)
    client.force_login(create_user)
    rejected = client.post("/api/users/api-tokens/", {"label": "test"}, content_type="application/json")
    assert rejected.status_code == 403
    assert rejected.json()["code"] == "CSRF_FAILED"
    token = client.get("/auth/get-csrf-token/").json()["csrf_token"]
    accepted = client.post(
        "/api/users/api-tokens/", {"label": "test"}, content_type="application/json", HTTP_X_CSRFTOKEN=token
    )
    assert accepted.status_code == 201


def test_redis_outage_fails_closed(settings):
    settings.REDIS_URL = "redis://127.0.0.1:1/0"
    response = Client().get("/auth/get-csrf-token/")
    assert response.status_code == 503
    assert response.json()["code"] == "AUTH_UNAVAILABLE"


def test_untrusted_forwarding_header_cannot_change_source_budget():
    client = Client()
    statuses = [
        client.get("/auth/get-csrf-token/", HTTP_X_FORWARDED_FOR=f"192.0.2.{number}").status_code for number in range(4)
    ]
    assert statuses == [200, 200, 200, 429]


def test_api_keys_for_one_user_share_budget(settings, create_bot_user):
    from plane.db.models import APIToken

    settings.LAB_AUTH_ENABLED = False
    settings.LAB_REQUEST_IP_LIMIT = 30
    settings.LAB_API_USER_LIMIT = 2
    first = APIToken.objects.create(user=create_bot_user)
    second = APIToken.objects.create(user=create_bot_user)
    client = Client()
    path = "/api/v1/workspaces/test-workspace/projects/"
    statuses = [client.get(path, HTTP_X_API_KEY=key.token).status_code for key in (first, second, first)]
    assert statuses[:2] != [429, 429]
    assert statuses[2] == 429


def test_untrusted_proxy_cannot_bypass_https_redirect(settings):
    settings.SECURE_SSL_REDIRECT = True
    settings.SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    settings.TRUSTED_PROXY_CIDRS = ["172.29.240.2/32"]
    response = Client().get("/auth/get-csrf-token/", HTTP_X_FORWARDED_PROTO="https")
    assert response.status_code == 301
    trusted = Client().get("/auth/get-csrf-token/", HTTP_X_FORWARDED_PROTO="https", REMOTE_ADDR="172.29.240.2")
    assert trusted.status_code == 200


def test_upload_signing_has_its_own_user_budget(settings, create_user):
    from rest_framework.test import APIClient

    settings.LAB_AUTH_ENABLED = False
    settings.LAB_REQUEST_IP_LIMIT = 30
    settings.LAB_UPLOAD_USER_LIMIT = 2
    client = APIClient()
    client.force_authenticate(create_user)
    payload = {"name": "test.png", "type": "image/png", "size": 1024, "entity_type": "USER_AVATAR"}
    responses = [client.post("/api/assets/v2/user-assets/", payload, format="json") for _ in range(3)]
    assert [response.status_code for response in responses] == [200, 200, 429]
    assert responses[0].json()["upload_data"]["url"]


def test_cookie_and_api_key_share_user_read_budget(settings, create_user):
    from plane.db.models import APIToken

    settings.LAB_AUTH_ENABLED = False
    settings.LAB_REQUEST_IP_LIMIT = 30
    settings.LAB_USER_READ_LIMIT = 2
    key = APIToken.objects.create(user=create_user)
    cookie = Client()
    cookie.force_login(create_user)
    token = Client()
    assert token.get("/api/v1/workspaces/test-workspace/projects/", HTTP_X_API_KEY=key.token).status_code != 429
    assert cookie.get("/api/users/me/").status_code == 200
    assert token.get("/api/v1/workspaces/test-workspace/projects/", HTTP_X_API_KEY=key.token).status_code == 429


def test_attack_failures_do_not_hide_successful_login_from_security_log(settings, caplog):
    import json
    import logging
    import pyotp
    from cryptography.fernet import Fernet
    from django.urls import resolve
    from freezegun import freeze_time
    from .test_auth import bootstrap

    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()
    settings.LAB_REQUEST_IP_LIMIT = 50
    settings.LAB_REQUEST_GLOBAL_LIMIT = 50
    resolve("/auth/lab/sign-in/")
    caplog.set_level(logging.INFO, logger="plane.security")
    with freeze_time("2026-10-10 01:00:00"):
        enrollment = bootstrap(Client())
        totp = pyotp.parse_uri(enrollment["otpauth"])
        assert (
            Client()
            .post(
                "/auth/lab/confirm/",
                {"token": enrollment["token"], "code": totp.now()},
                content_type="application/json",
            )
            .status_code
            == 201
        )
    with freeze_time("2026-10-10 01:00:30"):
        for _ in range(11):
            assert (
                Client()
                .post("/auth/lab/sign-in/", {"username": "unknown", "code": "000000"}, content_type="application/json")
                .status_code
                == 401
            )
        assert (
            Client()
            .post("/auth/lab/sign-in/", {"username": "alice", "code": totp.now()}, content_type="application/json")
            .status_code
            == 200
        )
    events = [json.loads(record.message) for record in caplog.records if record.name == "plane.security"]
    assert any(event["event"] == "auth.login" and event.get("result") == "success" for event in events)


def test_concurrent_sources_share_atomic_global_admission(settings):
    from concurrent.futures import ThreadPoolExecutor

    settings.LAB_REQUEST_GLOBAL_LIMIT = 7
    settings.LAB_REQUEST_IP_LIMIT = 50
    with ThreadPoolExecutor(max_workers=20) as pool:
        statuses = list(
            pool.map(
                lambda source: Client().get("/auth/get-csrf-token/", REMOTE_ADDR=f"192.0.2.{source}").status_code,
                range(1, 21),
            )
        )
    assert statuses.count(200) == 7
    assert statuses.count(429) == 13


def test_user_write_budget_is_distinct_from_reads(settings, create_user):
    from rest_framework.test import APIClient

    settings.LAB_AUTH_ENABLED = False
    settings.LAB_REQUEST_IP_LIMIT = 30
    settings.LAB_USER_WRITE_LIMIT = 2
    client = APIClient()
    client.force_authenticate(create_user)
    for _ in range(4):
        assert client.get("/api/users/me/").status_code == 200
    statuses = [
        client.post("/api/users/api-tokens/", {"label": "budget-test"}, format="json").status_code for _ in range(3)
    ]
    assert statuses == [201, 201, 429]
