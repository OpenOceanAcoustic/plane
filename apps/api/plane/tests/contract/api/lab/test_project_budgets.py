# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from copy import deepcopy
from uuid import uuid4

import pytest
from django.utils import timezone
from plane.db.models import Project, ProjectMember, Workspace, WorkspaceMember
from plane.lab.finance_models import FinancialAccount, FinancialEntry, ProjectCostBudget, StageBudget
from plane.lab.models import Ledger, Stage
from .test_finance_permissions import grant

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def payload(**overrides):
    return {
        "request_key": str(uuid4()),
        "expected_version": 0,
        "reason": "启动预算",
        "items": [
            {"category": category, "name": label, "amount": amount, "note": "测算依据"}
            for category, label, amount in [
                ("labor", "劳务费", "1000.10"),
                ("travel", "差旅费", "200.20"),
                ("outsourcing", "外协费", "300"),
                ("equipment", "设备费", "400"),
            ]
        ],
        **overrides,
    }


def endpoint(lab, project=None):
    return lab["base"] + f"finance/project-budgets/{(project or lab['project']).id}/"


def test_exact_versioned_report_and_idempotent_retries(laboratory):
    lab = laboratory
    client = lab["client"](lab["lead"])
    models = (FinancialAccount, FinancialEntry, StageBudget, Stage, Ledger)
    before = [model.objects.count() for model in models]
    body = payload()
    first = client.post(endpoint(lab), body, format="json")
    assert first.status_code == 201, first.content
    assert first.json()["total"] == "1900.30"
    assert first.json()["subtotals"]["labor"] == "1000.10"
    assert first.json()["version"] == 1
    assert client.post(endpoint(lab), body, format="json").json()["id"] == first.json()["id"]
    adjusted = payload(expected_version=1, reason="增加差旅费")
    adjusted["items"][1]["amount"] = "250.20"
    second = client.post(endpoint(lab), adjusted, format="json")
    assert second.status_code == 201, second.content
    assert second.json()["total"] == "1950.30"
    versions = client.get(endpoint(lab)).json()["versions"]
    assert [row["version"] for row in versions] == [2, 1]
    assert versions[1]["items"][1]["amount"] == "200.20"
    assert client.post(endpoint(lab), body, format="json").json()["version"] == 1
    assert before == [model.objects.count() for model in models]
    assert client.post(endpoint(lab), payload(), format="json").status_code == 409
    changed = deepcopy(body)
    changed["reason"] = "重用请求修改内容"
    assert client.post(endpoint(lab), changed, format="json").status_code == 409
    assert ProjectCostBudget.objects.count() == 2


@pytest.mark.parametrize(
    "amount", ["-1", "1.001", "NaN", "Infinity", "1e3", "1000000000000", "", " 1", True, 100, None]
)
def test_invalid_amounts(laboratory, amount):
    body = payload()
    body["items"][0]["amount"] = amount
    result = laboratory["client"](laboratory["lead"]).post(endpoint(laboratory), body, format="json")
    assert result.status_code == 400, result.content
    assert not ProjectCostBudget.objects.exists()


@pytest.mark.parametrize(
    "updates",
    [
        {"items": []},
        {"items": [None]},
        {"items": [{"category": []}]},
        {"expected_version": True},
        {"expected_version": "0"},
        {"expected_version": -1},
        {"request_key": "invalid"},
        {"reason": " "},
    ],
)
def test_invalid_payload(laboratory, updates):
    result = laboratory["client"](laboratory["lead"]).post(endpoint(laboratory), payload(**updates), format="json")
    assert result.status_code == 400, result.content


def test_total_limit_and_category_subtotals(laboratory):
    lab = laboratory
    client = lab["client"](lab["lead"])
    body = payload(
        items=[
            {"category": "labor", "name": "测算", "amount": "999999999999.99"},
            {"category": "labor", "name": "附加", "amount": "0.01"},
        ]
    )
    assert client.post(endpoint(lab), body, format="json").status_code == 400
    body["items"][0]["amount"] = "0.10"
    result = client.post(endpoint(lab), body, format="json")
    assert result.status_code == 201, result.content
    assert result.json()["total"] == result.json()["subtotals"]["labor"] == "0.11"


def test_permissions_project_scope_and_revocation(laboratory):
    lab = laboratory
    owner, member = lab["client"](lab["lead"]), lab["client"](lab["member"])
    assert owner.post(endpoint(lab), payload(), format="json").status_code == 201
    assert member.get(endpoint(lab)).status_code == 403
    assert member.get(endpoint(lab), {"format": "csv"}).status_code == 403
    for permission in ("view", "approve", "pay"):
        assert grant(lab, lab["member"], [permission]).status_code == 200
        assert member.get(endpoint(lab)).json()["can_edit"] is False
        assert member.post(endpoint(lab), payload(expected_version=1), format="json").status_code == 403
    assert grant(lab, lab["member"], ["record"]).status_code == 200
    assert member.get(endpoint(lab)).json()["can_edit"]
    assert member.post(endpoint(lab), payload(expected_version=1), format="json").status_code == 201
    foreign = Project.objects.create(workspace=lab["workspace"], name="其他项目", identifier="OTHER")
    ProjectMember.objects.create(workspace=lab["workspace"], project=foreign, member=lab["member"], role=15)
    assert member.get(endpoint(lab, foreign)).status_code == 403
    assert grant(lab, lab["member"], []).status_code == 200
    assert member.get(endpoint(lab)).status_code == 403
    assert grant(lab, lab["member"], ["record"]).status_code == 200
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert member.get(endpoint(lab)).status_code == 403


def test_cross_workspace_and_archived_project(laboratory):
    lab = laboratory
    workspace = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    project = Project.objects.create(workspace=workspace, name="Other", identifier="OTHER")
    client = lab["client"](lab["lead"])
    assert client.get(endpoint(lab, project)).status_code == 404
    assert client.post(endpoint(lab, project), payload(), format="json").status_code == 404
    assert client.post(endpoint(lab), payload(), format="json").status_code == 201
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now())
    assert client.get(endpoint(lab)).json()["can_edit"] is False
    assert client.post(endpoint(lab), payload(expected_version=1), format="json").status_code == 400


def test_csv_versions_and_formula_escaping(laboratory):
    lab = laboratory
    client = lab["client"](lab["lead"])
    assert client.get(endpoint(lab), {"format": "csv"}).status_code == 400
    body = payload()
    body["items"][0].update(name="=1+1", note="+cmd")
    assert client.post(endpoint(lab), body, format="json").status_code == 201
    assert client.post(endpoint(lab), payload(expected_version=1), format="json").status_code == 201
    result = client.get(endpoint(lab), {"format": "csv", "version": "1"})
    assert result.status_code == 200
    content = result.content.decode("utf-8-sig")
    assert "'=1+1" in content and "'+cmd" in content and "1900.30" in content
    assert "project-budget-v1.csv" in result["Content-Disposition"]
    assert client.get(endpoint(lab), {"format": "csv", "version": "bad"}).status_code == 400
    assert client.get(endpoint(lab), {"format": "csv", "version": "999"}).status_code == 404


@pytest.mark.parametrize("same_request", [True, False])
def test_concurrent_budget_submissions(laboratory, same_request):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections

    lab = laboratory
    body = payload()
    barrier = Barrier(2)

    def submit(index):
        close_old_connections()
        try:
            request = body if same_request or index == 0 else payload()
            barrier.wait(timeout=10)
            result = lab["client"](lab["lead"]).post(endpoint(lab), request, format="json")
            return result.status_code, result.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(result[0] for result in results) == ([201, 201] if same_request else [201, 409])
    assert ProjectCostBudget.objects.count() == 1
    if same_request:
        assert results[0][1] == results[1][1]
