# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Opt-in browser round trip against Django's isolated live test server."""

import json
import os
from pathlib import Path
import subprocess

import pytest
from django.test import Client

from .test_bounties import prepare

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.mark.skipif(not os.environ.get("LAB_QUOTE_BROWSER_TEST"), reason="Requires built web assets and Playwright")
def test_live_quote_approval_through_browser_and_real_api(laboratory, live_server, settings, tmp_path):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)
    settings.STORAGES = {
        **settings.STORAGES,
        "lab_quotes": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path / "files")},
        },
    }
    sessions = {}
    for role in ("member", "lead", "independent"):
        client = Client()
        client.force_login(lab[role])
        sessions[role] = {
            "id": str(lab[role].id),
            "cookie": {
                "name": settings.SESSION_COOKIE_NAME,
                "value": client.cookies[settings.SESSION_COOKIE_NAME].value,
            },
        }
    fixture_path = tmp_path / "browser-fixture.json"
    fixture_path.write_text(
        json.dumps(
            {
                "server": live_server.url,
                "base": lab["base"],
                "bounty_id": bounty_id,
                "sessions": sessions,
            }
        )
    )
    fixture_path.chmod(0o600)
    repo = Path(__file__).resolve().parents[7]
    result = subprocess.run(
        [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "-c",
            "tools/lab/e2e/playwright.config.ts",
            "bounty-workflow-components.spec.ts",
            "-g",
            "live quote approval",
        ],
        cwd=repo,
        env={**os.environ, "LAB_QUOTES_LIVE_FIXTURE": str(fixture_path)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
