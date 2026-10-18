# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
import os
from pathlib import Path
import subprocess

import pytest
from django.test import Client

from plane.db.models import Issue
from plane.lab.models import Ledger, WorkspacePolicy
from plane.lab.workload import workload
from .test_bounties import assigned_task

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.mark.skipif(not os.environ.get("LAB_WIP_BROWSER_TEST"), reason="Requires Playwright and a live test server")
def test_live_planner_start_over_recommendation(laboratory, live_server, settings, tmp_path):
    lab = laboratory
    WorkspacePolicy.objects.create(workspace=lab["workspace"])
    member = lab["client"](lab["member"])
    for title, state in (("第一项", "active"), ("第二项", "active"), ("第三项", "todo"), ("第四项", "todo")):
        issue = assigned_task(lab, title, state=state)
        response = member.post(lab["base"] + "items/", {"issue_id": str(issue.id)}, format="json")
        assert response.status_code == 201
    client = Client()
    client.force_login(lab["member"])
    fixture = tmp_path / "wip-browser-fixture.json"
    fixture.write_text(
        json.dumps(
            {
                "server": live_server.url,
                "base": lab["base"],
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
            "wip-reminder-components.spec.ts",
            "-g",
            "real Django API",
            "--output",
            str(tmp_path / "browser-output"),
        ],
        cwd=repo,
        env={**os.environ, "LAB_WIP_LIVE_FIXTURE": str(fixture)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert Issue.objects.filter(state=lab["states"]["active"]).count() == 4
    assert workload(lab["member"], lab["workspace"])["active"] == 4
    assert not Ledger.objects.exists()
