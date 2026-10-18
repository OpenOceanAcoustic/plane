# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
import os
from pathlib import Path
import subprocess

import pytest
from django.test import Client

from plane.db.models import Issue
from plane.lab.models import Audit
from .test_issue_archiving import task

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.mark.skipif(not os.environ.get("LAB_ARCHIVE_BROWSER_TEST"), reason="Requires Playwright and a live test server")
def test_live_archive_lookup_and_restore(laboratory, live_server, settings, tmp_path):
    lab = laboratory
    row = task(lab, title="真实日期归档")
    task(lab, title="以后完成", completed="2026-10-16T10:00:00+00:00")
    task(lab, title="尚未完成", state="todo", completed=None)
    original = row.completed_at
    client = Client()
    client.force_login(lab["lead"])
    fixture = tmp_path / "archive-browser-fixture.json"
    fixture.write_text(
        json.dumps(
            {
                "server": live_server.url,
                "base": lab["base"],
                "project": str(lab["project"].id),
                "issue": str(row.id),
                "cookie": {
                    "name": settings.SESSION_COOKIE_NAME,
                    "value": client.cookies[settings.SESSION_COOKIE_NAME].value,
                },
            }
        )
    )
    fixture.chmod(0o600)
    repo = Path(__file__).resolve().parents[7]
    result = subprocess.run(
        [
            "node",
            str(repo / "node_modules/@playwright/test/cli.js"),
            "test",
            "-c",
            "tools/lab/e2e/playwright.config.ts",
            "task-archive-components.spec.ts",
            "-g",
            "real Django API",
            "--output",
            str(tmp_path / "browser-output"),
        ],
        cwd=repo,
        env={**os.environ, "LAB_ARCHIVE_LIVE_FIXTURE": str(fixture)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    row.refresh_from_db()
    assert row.archived_at is None and row.completed_at == original
    assert not Issue.objects.filter(archived_at__isnull=False).exists()
    assert Audit.objects.filter(object_id=row.id, action="issue.archived").count() == 1
    assert Audit.objects.filter(object_id=row.id, action="issue.restored").count() == 1
