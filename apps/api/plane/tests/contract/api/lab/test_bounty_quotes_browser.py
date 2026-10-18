# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Opt-in browser round trip against Django's isolated live test server."""

import json
import os
from pathlib import Path
import subprocess

import pytest
from django.test import Client

from .test_bounties import action, prepare

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.mark.skipif(not os.environ.get("LAB_QUOTE_BROWSER_TEST"), reason="Requires built web assets and Playwright")
@pytest.mark.parametrize("funding_kind", ["legacy", "personal", "project"])
def test_live_quote_approval_through_browser_and_real_api(laboratory, live_server, settings, tmp_path, funding_kind):
    lab = laboratory
    roles = {role: lab[role] for role in ("member", "lead", "independent")}
    if funding_kind == "personal":
        from .test_member_vc import body, grant, historical_award, issue, post, setup

        stage = setup(lab)
        historical_award(lab, stage, lab["member"])
        assert grant(lab, "40").status_code == 201
        response = post(lab, body(lab, issue(lab), "20", project_vc="12", earned_vc="8", major=True))
        assert response.status_code == 201, response.content
        bounty_id = response.json()["id"]
        # The ordinary member publishes; the original project lead is the applicant.
        roles["lead"], roles["member"] = lab["member"], lab["lead"]
    elif funding_kind == "project":
        from .test_member_vc import body, issue, post, setup

        stage = setup(lab, "10000")
        response = post(lab, body(lab, issue(lab), "5000"), actor=lab["lead"])
        assert response.status_code == 201, response.content
        bounty_id = response.json()["id"]
    else:
        bounty_id, _, _ = prepare(lab, major=True)
    if funding_kind != "project":
        assert (
            action(lab, lab["independent"], bounty_id, "publication-review", {"reason": "发布复核"}).status_code == 200
        )
    settings.STORAGES = {
        **settings.STORAGES,
        "lab_quotes": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path / "files")},
        },
    }
    sessions = {}
    for role, user in roles.items():
        client = Client()
        client.force_login(user)
        sessions[role] = {
            "id": str(user.id),
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
                "original_vc": "5000.00" if funding_kind == "project" else "20.00",
                "quote_vc": "6000.00" if funding_kind == "project" else "45.00",
                "quote_limit": "10000.00" if funding_kind == "project" else None,
                "major": funding_kind != "project",
            }
        )
    )
    fixture_path.chmod(0o600)
    repo = Path(__file__).resolve().parents[7]
    result = subprocess.run(
        [
            "node",
            str(repo / "node_modules" / "@playwright" / "test" / "cli.js"),
            "test",
            "-c",
            "tools/lab/e2e/playwright.config.ts",
            "bounty-workflow-components.spec.ts",
            "-g",
            "live quote approval",
            "--output",
            str(tmp_path / "browser-output"),
        ],
        cwd=repo,
        env={**os.environ, "LAB_QUOTES_LIVE_FIXTURE": str(fixture_path)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    if funding_kind == "personal":
        from plane.lab.models import BountyFunding, Ledger
        from plane.lab.vc import wallet

        funding = BountyFunding.objects.get(bounty_id=bounty_id)
        assert funding.project_committed == 37 and funding.earned_committed == 8
        assert wallet(lab["member"].id, lab["project"])["available"] == "3.00"
        assert Ledger.objects.count() == 1  # The historical award; quote approval creates no contribution.
    elif funding_kind == "project":
        from plane.lab.models import BountyFunding, Ledger
        from plane.lab.vc import stage_reserved, wallet

        funding = BountyFunding.objects.get(bounty_id=bounty_id)
        assert funding.source == "project" and funding.project_committed == 6000 and funding.earned_committed == 0
        assert stage_reserved(stage) == 6000
        assert wallet(lab["lead"].id, lab["project"])["available"] == "0.00"
        assert Ledger.objects.count() == 0
