# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Authentication upgrades preserve live quotas and safely expire legacy API tokens."""

from datetime import datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client
from django.utils import timezone
from freezegun import freeze_time

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def test_auth_upgrade_preserves_real_login_quota_and_removes_unknown_identities(settings):
    settings.LAB_AUTH_ENABLED = True
    settings.LAB_SECURITY_LIMITS_ENABLED = False
    settings.LAB_TOTP_KEY = Fernet.generate_key().decode()
    from django.urls import resolve

    resolve("/auth/lab/sign-in/")
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    old_schema = [("lab", "0012_started_bounty_upgrade_guard")]
    try:
        executor.migrate(old_schema)
        old = executor.loader.project_state(old_schema).apps
        User = old.get_model("db", "User")
        Credential = old.get_model("lab", "Credential")
        LoginAccount = old.get_model("lab", "LoginAccount")
        LoginAttempt = old.get_model("lab", "LoginAttempt")
        APIToken = old.get_model("db", "APIToken")
        with freeze_time("2026-10-08 03:00:00"):
            user = User.objects.create(
                id="00000000-0000-0000-0000-000000000001",
                username="migration-user",
                email="migration@example.org",
                password="!",
            )
            Credential.objects.create(
                user=user,
                encrypted_secret=Fernet(settings.LAB_TOTP_KEY.encode()).encrypt(b"JBSWY3DPEHPK3PXP").decode(),
            )
            permanent = APIToken.objects.create(user=user, label="Legacy permanent", expired_at=None)
            future_expiry = timezone.now() + timedelta(days=60)
            future = APIToken.objects.create(user=user, label="Existing deadline", expired_at=future_expiry)
            past_expiry = timezone.now() - timedelta(days=1)
            expired = APIToken.objects.create(user=user, label="Already expired", expired_at=past_expiry)
            # Historical identity digest for user:00000000-0000-0000-0000-000000000001.
            account = LoginAccount.objects.create(
                identity_hash="22a932e3cce89793178aad770ae73ec3b484665d8addbf360d5ad63795418295"
            )
            attempts = [
                LoginAttempt.objects.create(account=account, submitted_at=timezone.now() - timedelta(seconds=30))
                for _ in range(5)
            ]
            for unknown_hash in (
                "f" * 64,  # Arbitrary username identities.
                "f52b7a95488e639fbe9c769e37fb86d5aff868fb302f3f45b07cbfd0d646ffea",  # Deleted user identity.
            ):
                unknown = LoginAccount.objects.create(identity_hash=unknown_hash)
                LoginAttempt.objects.create(account=unknown, submitted_at=timezone.now())
            MigrationExecutor(connection).migrate([("lab", "0014_api_token_expiry")])
            response = Client().post(
                "/auth/lab/sign-in/",
                {"username": "migration-user", "code": "invalid"},
                content_type="application/json",
            )
            assert response.status_code == 429
            assert response.json()["code"] == "RATE_LIMITED"
            assert int(response["Retry-After"]) == 570
            upgraded = MigrationExecutor(connection).loader.project_state([("lab", "0014_api_token_expiry")]).apps
            assert list(upgraded.get_model("lab", "LoginAccount").objects.values_list("id", flat=True)) == [account.id]
            assert set(upgraded.get_model("lab", "LoginAttempt").objects.values_list("id", flat=True)) == {
                attempt.id for attempt in attempts
            }
            tokens = upgraded.get_model("db", "APIToken").objects
            assert tokens.get(id=permanent.id).expired_at == datetime.fromisoformat("2026-11-07T03:00:00+00:00")
            assert tokens.get(id=future.id).expired_at == future_expiry
            assert tokens.get(id=expired.id).expired_at == past_expiry
    finally:
        MigrationExecutor(connection).migrate(latest)
