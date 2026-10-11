# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Read-only React Flow projections of project and financial source records."""

from decimal import Decimal
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.urls import path
from rest_framework.response import Response

from plane.db.models import Project

from .finance_models import (
    CashBatch,
    OfflinePayment,
    PublicDutyAward,
    PublicDutyCommitment,
    PublicDutyPayment,
    RewardSettlement,
)
from .finance_services import finance_removal_state
from .models import Audit, Bounty, Stage
from .finance_permissions import action_permission
from .permissions import project_ids, require_lead
from .planning_views import LabView


OPERATION_LABELS = {
    "manager": "指定公共资金管理人",
    "stage": "确认阶段奖励预算",
    "opening": "登记期初资金",
    "receipt": "到账及资金分池",
    "receipt-delete": "删除到账记录",
    "stage-delete": "删除阶段预算",
    "stage-restore": "恢复阶段预算",
    "project-delete": "删除资金项目",
    "project-restore": "恢复资金项目",
    "transfer": "资金划拨",
    "expense": "登记实际支出",
    "settlement": "确认最终执行奖励",
    "history-settlement": "核准历史孵化奖励",
    "commit": "批准支付安排",
    "cancel-commit": "取消未支付安排",
    "payment": "登记线下实付",
    "tax-remit": "登记扣缴汇出",
    "risk-release": "释放原批次准备金",
    "risk-use": "登记原批次责任支出",
    "future-plan": "年度未来项目资金编列",
    "exploration-allocation": "拨付阶段探索奖励",
    "stage-allocation": "结转阶段执行资金",
    "dispute": "预留争议资金",
    "resolve-dispute": "解除争议预留",
    "carryover": "结转未使用奖励",
    "reverse": "追加财务冲正",
    "public-duty": "核准月度公共职责奖励",
    "public-commit": "安排公共职责付款",
    "public-cancel-commit": "取消公共职责付款安排",
    "public-payment": "登记公共职责线下实付",
}
PROJECT_LABELS = {
    "project.created": "项目建立",
    "project.lead_changed": "负责人变更",
    "project.archived": "项目归档",
    "project.unarchived": "恢复归档项目",
    "project.deleted": "项目删除记录",
    "project.restored": "恢复删除项目",
}


def projection(workspace, user, overview, project=None, scope="finance", selected_project_id=None):
    nodes, edges, history, actions = [], [], [], []
    stages = {row["stage_id"]: row for row in overview["stages"]}
    stage_nodes = {}
    root_id = "project" if project else "funds"
    removal = finance_removal_state(workspace)
    managed_projects = {row["id"] for row in overview["projects"] if row.get("can_manage", row.get("is_lead"))}
    context_id = str(project.id) if project else selected_project_id
    closed_context = context_id in {str(identifier) for identifier in removal["projects"]}
    nodes.append(
        {"id": root_id, "label": "项目建立" if project else "真实资金账", "x": 0, "y": 0, "state": "completed"}
    )

    def node(identifier, label, x, y, state="upcoming", parent=None):
        nodes.append({"id": identifier, "label": label, "x": x, "y": y, "state": state})
        if parent:
            edges.append({"id": f"{parent}-{identifier}", "source": parent, "target": identifier})
        return identifier

    def action(kind, label, node_id, body=None, enabled=True, reason=""):
        identifier = (body or {}).get("project_id") or context_id
        target = next((row for row in overview["projects"] if row["id"] == identifier), None)
        if target and kind not in {"vc-stage", "project-archive", "project-unarchive"}:
            permission = action_permission(kind)
            if not (
                target.get("can_manage_permissions")
                if permission == "manage"
                else permission in target.get("permissions", [])
            ):
                return
        actions.append(
            {
                "id": f"{kind}:{node_id}",
                "action": kind,
                "label": label,
                "node_id": node_id,
                "body": body or {},
                "enabled": enabled,
                "reason": reason,
            }
        )

    slug = workspace.slug
    finance_link = {
        "path": f"/{slug}/lab/finance" + (f"?project_id={project.id}" if project else ""),
        "label": "资金源记录",
    }
    next_y = 180
    project_nodes = {}
    for row in overview["projects"]:
        if not row.get("deleted"):
            continue
        identifier = (
            root_id
            if context_id == row["id"]
            else node(
                f"finance-project:{row['id']}", f"{row['name']} · 资金项目已删除", 0, next_y, "completed", root_id
            )
        )
        project_nodes[row["id"]] = identifier
        if identifier != root_id:
            next_y += 190
        if row.get("can_restore"):
            action("project-restore", "恢复资金项目", identifier, {"project_id": row["id"]})
    for stage in Stage.objects.filter(workspace_id_snapshot=workspace.id, project_id_snapshot__in=managed_projects):
        if str(stage.id) in stages:
            continue
        deleted = stage.id in removal["stages"] or stage.project_id_snapshot in removal["projects"]
        pending_id = node(
            f"stage:{stage.id}:cash-budget",
            f"{stage.name} · {'预算已删除' if deleted else '待确认现金预算'}",
            0,
            next_y,
            "completed" if deleted else "current",
            root_id,
        )
        next_y += 190
        stage_nodes[str(stage.id)] = {"stage": pending_id, "stage-delete": pending_id, "stage-restore": pending_id}
        body = {"stage_id": str(stage.id), "project_id": str(stage.project_id_snapshot)}
        if not deleted:
            action("stage", "确认阶段奖励预算", pending_id, body)
        elif stage.id in removal["stages"] and stage.project_id_snapshot not in removal["projects"]:
            action("stage-restore", "恢复阶段预算", pending_id, body)
    for stage in overview["stages"]:
        stage_id, y = stage["stage_id"], next_y
        batches = [row for row in overview["batches"] if row["stage_id"] == stage_id]
        next_y += 190 + len(batches) * 100
        prefix = f"stage:{stage_id}"
        budget_id = node(f"{prefix}:budget", f"{stage['name']} · 预算与用途", 0, y, "completed", root_id)
        received = any(not row.get("reversed") for row in batches) or bool(
            stage.get("execution_funded") is not None and Decimal(stage["execution_funded"]) > 0
        )
        receipt_id = node(
            f"{prefix}:receipt", "实际资金到账", 240, y, "completed" if received else "current", budget_id
        )
        has_forecast = any(row["stage_id"] == stage_id for row in overview["forecasts"])
        formula_id = node(
            f"{prefix}:forecast", "项目公式与参考测算", 480, y, "completed" if has_forecast else "current", budget_id
        )
        settled = [row for row in overview["settlements"] if row["stage_id"] == stage_id]
        settlement_id = node(
            f"{prefix}:settlement",
            "负责人确认最终金额",
            720,
            y,
            "completed" if settled else "current" if received else "upcoming",
            receipt_id,
        )
        edges.append({"id": f"{formula_id}-{settlement_id}", "source": formula_id, "target": settlement_id})
        outstanding = any(Decimal(row["outstanding"]) > 0 for row in settled)
        commitments = [
            row for row in overview["commitments"] if any(row["settlement_id"] == award["id"] for award in settled)
        ]
        payment_id = node(
            f"{prefix}:payment",
            "支付安排与线下实付",
            960,
            y,
            "current" if outstanding else "completed" if settled else "upcoming",
            settlement_id,
        )
        risk_open = any(
            Decimal(row["risk_remaining"]) > 0 for row in overview["batches"] if row["stage_id"] == stage_id
        )
        remaining_cash = any(
            row.get("stage_id") == stage_id
            and row["kind"] in ("execution", "history", "risk", "dispute", "withholding")
            and Decimal(row["balance"]) != 0
            for row in overview["accounts"]
        )
        close_id = node(
            f"{prefix}:close",
            "留存、争议与财务结清" if stage.get("can_manage") else "个人奖励付款进度",
            1200,
            y,
            "current" if risk_open or outstanding or remaining_cash else "completed" if settled else "upcoming",
            payment_id,
        )
        stage_nodes[stage_id] = {
            "stage": budget_id,
            "stage-delete": budget_id,
            "stage-restore": budget_id,
            "receipt": receipt_id,
            "stage-allocation": receipt_id,
            "opening": receipt_id,
            "settlement": settlement_id,
            "history-settlement": settlement_id,
            "commit": payment_id,
            "cancel-commit": payment_id,
            "payment": payment_id,
            "forecast": formula_id,
            "formula": formula_id,
            "risk-release": close_id,
            "risk-use": close_id,
            "dispute": close_id,
            "resolve-dispute": close_id,
            "carryover": close_id,
            "reverse": close_id,
        }
        if stage.get("can_restore"):
            action("stage-restore", "恢复阶段预算", budget_id, {"stage_id": stage_id})
        if stage.get("can_manage") and not stage.get("deleted"):
            body = {"stage_id": stage_id, "project_id": stage["project_id"]}
            for kind, label in (
                ("receipt", "登记到账"),
                ("stage-allocation", "拨入前期留存"),
                ("formula", "配置项目公式"),
                ("forecast", "保存参考测算"),
                ("settlement", "确认最终奖励"),
                ("history-settlement", "核准历史奖励"),
                ("dispute", "预留争议金额"),
                ("carryover", "结转未使用奖励"),
            ):
                if kind == "history-settlement" and not stage.get("upgraded"):
                    continue
                action(kind, label, stage_nodes[stage_id].get(kind, close_id), body)
            for award in settled:
                if Decimal(award["outstanding"]) > Decimal(award["committed"]):
                    action(
                        "commit",
                        f"安排 {award['user_name']} 的付款",
                        payment_id,
                        {**body, "settlement_id": award["id"]},
                    )
            for commitment in commitments:
                if not commitment["cancelled"] and Decimal(commitment["remaining"]) > 0:
                    action("payment", "登记线下实付", payment_id, {**body, "commitment_id": commitment["id"]})
        for batch_index, batch in enumerate(batches):
            batch_y = y + 100 + batch_index * 100
            batch_id = node(
                f"batch:{batch['id']}",
                f"到账批次 · {batch['source']}",
                240,
                batch_y,
                "upcoming" if batch.get("reversed") else "completed",
                receipt_id,
            )
            risk_id = node(
                f"batch:{batch['id']}:risk",
                "原批次风险准备金",
                480,
                batch_y,
                "current" if Decimal(batch["risk_remaining"]) > 0 else "completed",
                batch_id,
            )
            if (
                batch.get("can_manage")
                and not batch.get("reversed")
                and not stage.get("deleted")
                and Decimal(batch["risk_remaining"]) > 0
            ):
                action("risk-release", "释放准备金", risk_id, {"batch_id": batch["id"], "stage_id": stage_id})
                action("risk-use", "登记责任支出", risk_id, {"batch_id": batch["id"], "stage_id": stage_id})

    batch_operations = {
        str(op): f"batch:{batch}"
        for op, batch in CashBatch.objects.filter(id__in=[row["id"] for row in overview["batches"]]).values_list(
            "operation_id", "id"
        )
    }
    public_nodes = {}
    for award in overview.get("public_awards", []):
        identifier = node(
            f"public:{award['id']}",
            f"{award['period']} · {award['user_name']} 公共职责",
            240,
            next_y,
            "current" if Decimal(award["outstanding"]) > 0 else "completed",
            root_id,
        )
        public_nodes[award["group_key"]] = identifier
        next_y += 110
        if (
            not closed_context
            and award.get("can_manage")
            and Decimal(award["outstanding"]) > Decimal(award["committed"])
        ):
            action("public-commit", "安排公共职责付款", identifier, {"award_id": award["id"]})
    public_revisions = list(PublicDutyAward.objects.filter(group_key__in=public_nodes).select_related("operation"))
    public_award_nodes = {str(row.id): public_nodes[str(row.group_key)] for row in public_revisions}
    public_operation_nodes = {str(row.operation_id): public_nodes[str(row.group_key)] for row in public_revisions}
    public_commitment_nodes = {}
    for commitment in overview.get("public_commitments", []):
        identifier = public_award_nodes[commitment["award_id"]]
        public_commitment_nodes[commitment["id"]] = identifier
        if (
            not closed_context
            and commitment.get("can_manage")
            and not commitment["cancelled"]
            and Decimal(commitment["remaining"]) > 0
        ):
            action("public-payment", "登记公共职责实付", identifier, {"commitment_id": commitment["id"]})

    def event_node(identifier, kind, stage_id, payload):
        if kind == "receipt" and identifier in batch_operations:
            return batch_operations[identifier]
        if kind == "receipt-delete" and payload.get("batch_id"):
            candidate = f"batch:{payload['batch_id']}"
            if any(row["id"] == candidate for row in nodes):
                return candidate
        if kind in {"project-delete", "project-restore"}:
            return project_nodes.get(str(payload.get("project_id")), root_id)
        if kind in ("risk-release", "risk-use") and payload.get("batch_id"):
            candidate = f"batch:{payload['batch_id']}:risk"
            if any(row["id"] == candidate for row in nodes):
                return candidate
        if kind.startswith("public-"):
            return (
                public_operation_nodes.get(identifier)
                or public_award_nodes.get(str(payload.get("award_id")))
                or public_commitment_nodes.get(str(payload.get("commitment_id")))
                or root_id
            )
        return stage_nodes.get(stage_id, {}).get(kind, root_id)

    for operation in overview["operations"]:
        stage_id = str(operation.get("stage_id") or operation.get("payload", {}).get("stage_id") or "")
        node_id = event_node(operation["id"], operation["kind"], stage_id, operation["payload"])
        history.append(
            {
                "id": operation["id"],
                "label": OPERATION_LABELS.get(operation["kind"], operation["kind"]),
                "node_id": node_id,
                "actor": operation["actor"],
                "created_at": operation["created_at"],
                "reason": operation["reason"],
                "source": finance_link,
                "occurred_at": operation["occurred_at"],
                "evidence": operation["evidence"],
                "snapshot": operation["payload"],
            }
        )
    for formula in overview["formulas"]:
        history.append(
            {
                "id": formula["id"],
                "label": f"奖励公式版本 {formula['version']}",
                "node_id": root_id,
                "actor": formula["actor"],
                "created_at": formula["created_at"],
                "reason": formula["reason"],
                "source": finance_link,
                "snapshot": {
                    "version": formula["version"],
                    "task_expression": formula["task_expression"],
                    "member_expression": formula["member_expression"],
                    "parameters": formula["parameters"],
                },
            }
        )
    # Audit owns the operator snapshot; the forecast owns immutable input/output.
    forecast_ids = [row["id"] for row in overview["forecasts"]]
    forecast_audits = {
        str(row.object_id): row
        for row in Audit.objects.filter(
            workspace_id_snapshot=workspace.id, object_id__in=forecast_ids, action__startswith="finance."
        )
    }
    for forecast in overview["forecasts"]:
        record = forecast_audits.get(forecast["id"])
        history.append(
            {
                "id": forecast["id"],
                "label": f"参考测算 · 公式 v{forecast['formula_version']}",
                "node_id": stage_nodes.get(forecast["stage_id"], {}).get("forecast", root_id),
                "actor": forecast.get("actor") or (record.actor_name if record else "测算记录（操作人未记录）"),
                "created_at": forecast["created_at"],
                "reason": record.details.get("reason", "") if record else "",
                "source": finance_link,
                "snapshot": {
                    "formula_version": forecast["formula_version"],
                    "expression": forecast["expression"],
                    "inputs": forecast["inputs"],
                    "result": forecast["result"],
                    "basis": forecast["basis"],
                },
            }
        )

    # Recipients can trace their own revisions/payments without receiving the
    # project's private ledger or another participant's business records.
    existing_history = {row["id"] for row in history}
    own_scope = Q(user_id_snapshot=user.id) | Q(
        budget__stage_id__in=[row["stage_id"] for row in overview["stages"] if row.get("can_manage")]
    )
    revisions = RewardSettlement.objects.filter(
        own_scope, budget_id__in=[row["id"] for row in overview["stages"]]
    ).select_related("operation", "budget")
    own_records = [(row.operation, str(row.budget.stage_id)) for row in revisions]
    own_records += [(row.operation, "") for row in public_revisions]
    own_records += [
        (row.operation, "")
        for row in PublicDutyCommitment.objects.filter(id__in=public_commitment_nodes).select_related("operation")
    ]
    own_records += [
        (row.operation, str(row.commitment.settlement.budget.stage_id))
        for row in OfflinePayment.objects.filter(id__in=[row["id"] for row in overview["payments"]]).select_related(
            "operation", "commitment__settlement__budget"
        )
    ]
    own_records += [
        (row.operation, "")
        for row in PublicDutyPayment.objects.filter(
            id__in=[row["id"] for row in overview.get("public_payments", [])]
        ).select_related("operation")
    ]
    for operation, stage_id in own_records:
        identifier = str(operation.id)
        if identifier in existing_history:
            continue
        existing_history.add(identifier)
        history.append(
            {
                "id": identifier,
                "label": OPERATION_LABELS.get(operation.kind, operation.kind),
                "node_id": event_node(identifier, operation.kind, stage_id, operation.payload),
                "actor": operation.actor_name,
                "created_at": operation.created_at.isoformat(),
                "occurred_at": operation.occurred_at.isoformat(),
                "reason": operation.reason,
                "evidence": operation.evidence,
                "snapshot": operation.payload,
                "source": finance_link,
            }
        )

    if overview.get("is_manager") and not closed_context:
        for kind, label in (
            ("manager", "指定公共资金管理人"),
            ("opening", "登记公共池期初资金"),
            ("future-plan", "编列年度未来资金"),
            ("exploration-allocation", "拨付探索奖励"),
            ("public-duty", "核准月度公共职责"),
            ("expense", "登记公共支出"),
            ("transfer", "公共资金划拨"),
        ):
            action(kind, label, root_id)

    if project:
        lead = str(project.id) in managed_projects
        if lead:
            require_lead(user, project)
            if not closed_context:
                action("formula", "配置项目预计奖励公式", root_id, {"project_id": str(project.id)})
        bounty_rows = Bounty.objects.filter(stage__project=project).select_related("stage")
        task_start = next_y
        for index, bounty in enumerate(bounty_rows):
            task_id = node(
                f"bounty:{bounty.id}",
                f"悬赏 · {bounty.title}",
                240,
                task_start + index * 110,
                "completed" if bounty.status in ("done", "cancelled", "rejected", "deleted") else "current",
                root_id,
            )
            task_source = {"path": f"/{slug}/lab/bounties?bounty_id={bounty.id}", "label": "悬赏详情与流程"}
            history.append(
                {
                    "id": f"bounty-link:{bounty.id}",
                    "label": "任务执行与独立验收",
                    "node_id": task_id,
                    "actor": "悬赏源记录",
                    "created_at": bounty.created_at.isoformat(),
                    "reason": "",
                    "source": task_source,
                }
            )
        audits = list(
            Audit.objects.filter(
                workspace_id_snapshot=workspace.id, object_id=project.id, action__startswith="project."
            ).order_by("created_at", "id")
        )
        if not any(row.action == "project.created" for row in audits):
            history.append(
                {
                    "id": f"recovered:{project.id}",
                    "label": "由现存项目记录恢复的建立信息",
                    "node_id": root_id,
                    "actor": project.created_by.display_name if project.created_by_id else "未记录操作人",
                    "created_at": project.created_at.isoformat(),
                    "reason": "仅依据当前项目记录，未补造过去审批或变更。",
                    "source": {"path": f"/{slug}/projects/{project.id}", "label": "项目源记录"},
                }
            )
        archive_id = node(
            "archive",
            "项目已归档" if project.archived_at else "项目归档",
            1440,
            0,
            "completed" if project.archived_at else "upcoming",
            root_id,
        )
        for audit in audits:
            history.append(
                {
                    "id": str(audit.id),
                    "label": PROJECT_LABELS.get(audit.action, audit.action),
                    "node_id": archive_id if audit.action in ("project.archived", "project.unarchived") else root_id,
                    "actor": audit.actor_name,
                    "created_at": audit.created_at.isoformat(),
                    "reason": audit.details.get("reason", ""),
                    "snapshot": audit.details,
                    "source": {"path": f"/{slug}/projects/{project.id}", "label": "项目源记录"},
                }
            )
        if project.archived_at and not any(row.action == "project.archived" for row in audits):
            history.append(
                {
                    "id": f"archive-recovered:{project.id}",
                    "label": "由当前记录恢复的归档时间",
                    "node_id": archive_id,
                    "actor": "未记录操作人",
                    "created_at": project.archived_at.isoformat(),
                    "reason": "不表示财务已结清。",
                    "source": None,
                }
            )
    history.sort(key=lambda row: (row["created_at"], row["id"]))
    return {
        "scope": scope,
        "project_id": str(project.id) if project else None,
        "title": f"{project.name} · 全流程" if project else "资金与奖励流程",
        "active_node_ids": [row["id"] for row in nodes if row["state"] == "current"],
        "nodes": nodes,
        "edges": edges,
        "history": history,
        "actions": actions,
    }


class ProjectLifecycleView(LabView):
    def get(self, request, slug, pk):
        from .finance_views import overview_data

        project = get_object_or_404(
            Project.objects.select_related("created_by"),
            id=pk,
            workspace=self.workspace,
            id__in=project_ids(request.user, self.workspace),
        )
        return Response(
            projection(
                self.workspace,
                request.user,
                overview_data(self.workspace, request.user, str(pk)),
                project=project,
                scope="project",
            )
        )


class FinanceLifecycleView(LabView):
    def get(self, request, slug):
        from .finance_views import overview_data

        project_id = request.query_params.get("project_id") or None
        overview = overview_data(self.workspace, request.user, project_id)
        return Response(projection(self.workspace, request.user, overview, selected_project_id=project_id))


lifecycle_patterns = [
    path("projects/<uuid:pk>/workflow/", ProjectLifecycleView.as_view()),
    path("finance/workflow/", FinanceLifecycleView.as_view()),
    path("finance/flow/", FinanceLifecycleView.as_view()),
]
