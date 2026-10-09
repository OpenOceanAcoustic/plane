# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.db.models import Project, ProjectMember
from plane.lab.models import Audit, Stage
from plane.lab.finance_models import FinancialOperation, RewardForecast, RewardSettlement

pytestmark = pytest.mark.django_db


def command(lab, action, **values):
    response = lab["client"](lab["lead"]).post(
        lab["base"] + f"finance/{action}/",
        {"request_key": str(uuid.uuid4()), "reason": "负责人核准依据", **values},
        format="json",
    )
    assert response.status_code == 200, response.data
    return response.data


def financed_stage(lab, name="首期"):
    stage = Stage.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        workspace_id_snapshot=lab["workspace"].id,
        project_id_snapshot=lab["project"].id,
        project_name=lab["project"].name,
        name=name,
        budget=1000,
        frozen_at=timezone.now(),
    )
    command(
        lab,
        "stage",
        stage_id=str(stage.id),
        E="700",
        purposes=[{"name": "样本处理奖励", "amount": "700"}],
        members=[{"user_id": str(lab["member"].id), "b": "1", "r": "1", "planned_vc": "100"}],
    )
    response = lab["client"](lab["lead"]).post(
        lab["base"] + f"finance/formulas/{lab['project'].id}/",
        {
            "task_expression": "E * VC / B",
            "member_expression": "E * VC / B",
            "parameters": [],
            "reason": "本项目按贡献预测",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    return stage


def test_project_and_cash_graphs_have_parallel_batches_snapshots_and_read_only_refresh(laboratory):
    lab = laboratory
    stage = financed_stage(lab)
    for source in ("首笔到账", "第二笔到账"):
        command(
            lab, "receipt", stage_id=str(stage.id), gross="500", costs="0", D="500", source=source, evidence="银行凭证"
        )
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "finance/forecast/",
        {"stage_id": str(stage.id), "kind": "member", "basis": "budget", "user_id": str(lab["member"].id)},
        format="json",
    )
    assert response.status_code == 201, response.data
    forecast_id = response.data["id"]
    # Reference 70 can be confirmed as 100 on actual performance, without changing the forecast.
    command(
        lab,
        "settlement",
        stage_id=str(stage.id),
        user_id=str(lab["member"].id),
        amount="100",
        performance_basis="质量额外核准",
        forecast_id=forecast_id,
    )
    counts = (FinancialOperation.objects.count(), Audit.objects.count(), RewardForecast.objects.count())
    client = lab["client"](lab["lead"])
    graph = client.get(lab["base"] + f"projects/{lab['project'].id}/workflow/")
    assert graph.status_code == 200, graph.data
    assert graph.data["scope"] == "project"
    batch_nodes = [
        row for row in graph.data["nodes"] if row["id"].startswith("batch:") and not row["id"].endswith(":risk")
    ]
    assert len(batch_nodes) == 2
    assert batch_nodes[0]["y"] != batch_nodes[1]["y"]
    forecast_event = next(row for row in graph.data["history"] if row["id"] == forecast_id)
    assert Decimal(forecast_event["snapshot"]["result"]) == Decimal("70")
    assert forecast_event["snapshot"]["expression"] == "E * VC / B"
    assert forecast_event["actor"] == "负责人"
    assert any(row.get("evidence") == "银行凭证" for row in graph.data["history"])
    assert {row["action"] for row in graph.data["actions"]} >= {"receipt", "settlement", "risk-release", "risk-use"}
    assert client.get(lab["base"] + f"projects/{lab['project'].id}/workflow/").data == graph.data
    assert counts == (FinancialOperation.objects.count(), Audit.objects.count(), RewardForecast.objects.count())
    assert RewardSettlement.objects.count() == 1


def test_archive_has_atomic_native_event_and_remains_separate_from_financial_close(laboratory):
    lab = laboratory
    stage = financed_stage(lab)
    command(
        lab, "receipt", stage_id=str(stage.id), gross="1000", costs="0", D="1000", source="资金到账", evidence="凭证"
    )
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now(), updated_by=lab["lead"])
    graph = lab["client"](lab["lead"]).get(lab["base"] + f"projects/{lab['project'].id}/workflow/")
    assert graph.status_code == 200
    nodes = {row["id"]: row for row in graph.data["nodes"]}
    assert nodes["archive"]["state"] == "completed"
    assert nodes[f"stage:{stage.id}:close"]["state"] == "current"
    event = next(row for row in graph.data["history"] if row["label"] == "项目归档")
    assert event["actor"] == "负责人"
    assert event["snapshot"]["before"]["archived_at"] is None
    assert event["snapshot"]["after"]["archived_at"] is not None
    # A bulk ORM update cannot replace financial or workflow evidence.
    with pytest.raises(IntegrityError), transaction.atomic():
        Audit.objects.filter(id=event["id"]).update(actor_name="改写人")
    assert Audit.objects.get(id=event["id"]).actor_name == "负责人"


def test_member_flow_traces_own_final_revisions_without_private_project_ledger(laboratory):
    lab = laboratory
    stage = financed_stage(lab)
    command(
        lab,
        "receipt",
        stage_id=str(stage.id),
        gross="1000",
        costs="0",
        D="1000",
        source="私有来源",
        evidence="私有到账凭证",
    )
    for amount in ("100", "120"):
        command(
            lab,
            "settlement",
            stage_id=str(stage.id),
            user_id=str(lab["member"].id),
            amount=amount,
            performance_basis="本人成果质量",
        )
    graph = lab["client"](lab["member"]).get(lab["base"] + f"finance/workflow/?project_id={lab['project'].id}")
    assert graph.status_code == 200
    assert not graph.data["actions"]
    revisions = [row for row in graph.data["history"] if row["label"] == "确认最终执行奖励"]
    assert len(revisions) == 2
    assert "私有到账凭证" not in str(graph.data)
    outsider = lab["independent"]
    ProjectMember.objects.filter(project=lab["project"], member=outsider).delete()
    assert lab["client"](outsider).get(lab["base"] + f"projects/{lab['project'].id}/workflow/").status_code == 404
    assert (
        lab["client"](outsider).get(lab["base"] + f"finance/workflow/?project_id={lab['project'].id}").status_code
        == 403
    )


def test_public_duty_node_exposes_only_recipients_own_source_events(laboratory):
    lab = laboratory
    command(lab, "opening", kind="public", amount="1000", source="公共期初凭证", evidence="期初核准")
    award = command(lab, "public-duty", user_id=str(lab["member"].id), period="2026-10", duty="仪器管理", amount="100")
    graph = lab["client"](lab["member"]).get(lab["base"] + "finance/workflow/")
    assert graph.status_code == 200, graph.data
    node_id = f"public:{award['id']}"
    assert any(row["id"] == node_id for row in graph.data["nodes"])
    events = [row for row in graph.data["history"] if row["node_id"] == node_id]
    assert len(events) == 1
    assert events[0]["label"] == "核准月度公共职责奖励"
    assert events[0]["snapshot"]["amount"] == "100"
    assert events[0]["actor"] == "负责人"
    assert not graph.data["actions"]
    assert "公共期初凭证" not in str(graph.data)


@pytest.mark.django_db(transaction=True)
def test_parallel_partial_payments_cannot_consume_one_promise_twice(laboratory):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    from plane.lab.finance_models import OfflinePayment, PaymentCommitment
    from plane.lab.finance_services import commitment_remaining

    lab = laboratory
    stage = financed_stage(lab)
    command(
        lab, "receipt", stage_id=str(stage.id), gross="1000", costs="0", D="1000", source="到账", evidence="到账凭证"
    )
    final = command(
        lab,
        "settlement",
        stage_id=str(stage.id),
        user_id=str(lab["member"].id),
        amount="300",
        performance_basis="实际工作",
    )
    promise = command(lab, "commit", settlement_id=final["id"], amount="300")
    barrier = Barrier(2)

    def pay():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return (
                lab["client"](lab["lead"])
                .post(
                    lab["base"] + "finance/payment/",
                    {
                        "request_key": str(uuid.uuid4()),
                        "reason": "并发部分付款",
                        "commitment_id": promise["id"],
                        "gross": "200",
                        "withheld": "20",
                        "evidence": "线下凭证",
                        "reference": str(uuid.uuid4()),
                    },
                    format="json",
                )
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: pay(), range(2)))
    assert sorted(results) == [200, 400]
    payments = list(OfflinePayment.objects.all())
    assert len(payments) == 1
    assert payments[0].gross == Decimal("200")
    assert payments[0].withheld == Decimal("20")
    assert payments[0].net == Decimal("180")
    assert commitment_remaining(PaymentCommitment.objects.get(id=promise["id"])) == Decimal("100")


def test_cash_csv_preserves_signed_numeric_debits_for_reconciliation(laboratory):
    import csv
    from io import StringIO

    lab = laboratory
    stage = financed_stage(lab)
    command(lab, "receipt", stage_id=str(stage.id), gross="1000", costs="0", D="1000", source="到账", evidence="凭证")
    response = lab["client"](lab["lead"]).get(lab["base"] + "finance/entries/?format=csv")
    assert response.status_code == 200
    values = [Decimal(row["delta"]) for row in csv.DictReader(StringIO(response.content.decode()))]
    assert any(value < 0 for value in values)
    assert sum(values) == Decimal("1000")
