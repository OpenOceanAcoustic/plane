# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import csv
from io import StringIO

from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember, WorkspaceMember
from .export import csv_cell
from .finance_formulas import TEMPLATES
from .finance_models import (
    CashBatch,
    FinancialAccount,
    FinancialEntry,
    FinancialOperation,
    OfflinePayment,
    PaymentCommitment,
    RewardForecast,
    RewardFormula,
    StageBudget,
    PublicDutyCommitment,
    PublicDutyPayment,
)
from .finance_services import (
    LABELS,
    PUBLIC_KINDS,
    ZERO,
    active_operations,
    aggregate,
    available,
    balance,
    committed,
    commitment_cancelled,
    commitment_paid,
    commitment_remaining,
    create_forecast,
    authorized_participations,
    funded,
    manager_allowed,
    perform,
    policy,
    preview_formula,
    save_formula,
    settlement_latest,
    settlement_paid,
    settlement_payments,
    settlement_reserved,
    public_latest,
    public_award_paid,
    public_award_reserved,
    public_commitment_paid,
    public_commitment_remaining,
    public_commitment_cancelled,
    workspace_zone,
    finance_removal_state,
    stage_deletion_reason,
    project_deletion_reason,
    receipt_deletion_reason,
)
from .permissions import collaboration_projects as project_ids
from .planning_views import LabView


def formula_data(row):
    return {
        "id": str(row.id),
        "project_id": str(row.project_id_snapshot),
        "version": row.version,
        "task_expression": row.task_expression,
        "member_expression": row.member_expression,
        "parameters": row.parameters,
        "reason": row.reason,
        "actor": row.actor_name,
        "created_at": row.created_at.isoformat(),
    }


def forecast_data(row):
    return {
        "id": str(row.id),
        "stage_id": str(row.budget.stage_id),
        "project_id": str(row.budget.stage.project_id_snapshot),
        "kind": row.kind,
        "basis": row.basis,
        "bounty_id": str(row.bounty_id) if row.bounty_id else None,
        "user_id": str(row.user_id_snapshot) if row.user_id_snapshot else None,
        "formula_id": str(row.formula_id),
        "formula_version": row.formula.version,
        "expression": row.expression,
        "inputs": row.inputs,
        "result": str(row.result),
        "actor": row.actor_name,
        "created_at": row.created_at.isoformat(),
    }


def entry_data(row):
    op, account = row.operation, row.account
    return {
        "id": str(row.id),
        "operation_id": str(op.id),
        "account_id": str(account.id),
        "project_id": str(account.project_id_snapshot) if account.project_id_snapshot else None,
        "stage_id": str(account.stage_id) if account.stage_id else None,
        "kind": account.kind,
        "delta": str(row.delta),
        "reason": op.reason,
        "evidence": op.evidence,
        "actor": op.actor_name,
        "created_at": row.created_at.isoformat(),
        "occurred_at": op.occurred_at.isoformat(),
        "reverses_id": str(row.reverses_id) if row.reverses_id else None,
    }


def future_plan_limits(workspace, source):
    if source is None:
        return {}
    yearly = {}
    zone = workspace_zone(workspace)
    entries = source.entries.filter(
        operation__kind__in=("receipt", "opening", "future-plan"), operation__reversal__isnull=True
    ).select_related("operation")
    for row in entries:
        operation = row.operation
        if operation.kind in ("receipt", "opening") and row.delta > ZERO:
            year = operation.occurred_at.astimezone(zone).year
        elif operation.kind == "future-plan":
            year = int(operation.payload["year"])
        else:
            continue
        yearly[year] = yearly.get(year, ZERO) + row.delta
    return {str(year): f"{max(value, ZERO):.2f}" for year, value in sorted(yearly.items())}


def financial_scope(workspace, user, project_id=None):
    joined = set(project_ids(user, workspace))
    leads = set(
        Project.objects.filter(
            workspace=workspace,
            project_lead=user,
            id__in=ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True, role__gte=15).values(
                "project_id"
            ),
            deleted_at__isnull=True,
        ).values_list("id", flat=True)
    )
    participants = {row.bounty.stage_id for row in authorized_participations(user, workspace)}
    participated_projects = set(
        StageBudget.objects.filter(stage_id__in=participants).values_list("stage__project_id_snapshot", flat=True)
    )
    visible = joined | participated_projects
    if project_id:
        try:
            import uuid

            identifier = uuid.UUID(str(project_id))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("项目ID无效")
        if identifier not in visible:
            raise PermissionDenied("无项目资金访问权限")
        visible, leads = {identifier}, leads & {identifier}
    return visible, leads, participants


def settlement_data(row, can_manage):
    paid = settlement_paid(row)
    payments = settlement_payments(row)
    forecast = row.forecast.result if row.forecast else None
    return {
        "id": str(row.id),
        "stage_id": str(row.budget.stage_id),
        "project_id": str(row.budget.stage.project_id_snapshot),
        "user_id": str(row.user_id_snapshot),
        "user_name": row.user_name,
        "kind": row.kind,
        "revision": row.revision,
        "amount": str(row.amount),
        "forecast_id": str(row.forecast_id) if row.forecast_id else None,
        "forecast_amount": str(forecast) if forecast is not None else None,
        "difference": str(row.amount - forecast) if forecast is not None else None,
        "performance_basis": row.performance_basis,
        "paid": str(paid),
        "withheld": str(aggregate(payments, "withheld")),
        "net_paid": str(aggregate(payments, "net")),
        "outstanding": str(row.amount - paid),
        "committed": str(settlement_reserved(row)),
        "can_manage": can_manage,
    }


def overview_data(workspace, user, project_id=None):
    visible, leads, participants = financial_scope(workspace, user, project_id)
    removal = finance_removal_state(workspace)

    def scope_open(project_id, stage_id=None):
        return project_id not in removal["projects"] and stage_id not in removal["stages"]

    is_manager = manager_allowed(user, workspace)
    cash_scope = Q(project_id_snapshot__in=leads)
    if is_manager and not project_id:
        cash_scope |= Q(kind__in=PUBLIC_KINDS) | Q(kind="withholding", project_id_snapshot__isnull=True)
    accounts = []
    for row in FinancialAccount.objects.filter(cash_scope, workspace=workspace).select_related("project", "stage"):
        accounts.append(
            {
                "id": str(row.id),
                "project_id": str(row.project_id_snapshot) if row.project_id_snapshot else None,
                "stage_id": str(row.stage_id) if row.stage_id else None,
                "kind": row.kind,
                "label": LABELS[row.kind],
                "balance": str(balance(row)),
                "committed": str(committed(row)),
                "available": str(available(row)),
                "can_manage": (
                    row.project_id_snapshot in leads
                    and scope_open(row.project_id_snapshot, row.stage_id)
                    or (row.kind in PUBLIC_KINDS or row.kind == "withholding" and row.project_id_snapshot is None)
                    and is_manager
                ),
            }
        )
    public_summary = []
    for kind in sorted(PUBLIC_KINDS):
        row = FinancialAccount.objects.filter(workspace=workspace, kind=kind).first()
        public_summary.append(
            {
                "kind": kind,
                "label": LABELS[kind],
                "balance": str(balance(row) if row else ZERO),
                "committed": str(committed(row) if row else ZERO),
                "available": str(available(row) if row else ZERO),
            }
        )
    budgets = list(
        StageBudget.objects.filter(
            stage__workspace_id_snapshot=workspace.id, stage__project_id_snapshot__in=visible
        ).select_related("stage__project")
    )
    # Cross-project participants receive only the explicitly authorized task's stage, never sibling stages.
    budgets = [
        row
        for row in budgets
        if row.stage.project_id_snapshot in set(project_ids(user, workspace)) or row.stage_id in participants
    ]
    stages, settlements = [], []
    for row in budgets:
        manage = row.stage.project_id_snapshot in leads
        deleted = row.stage_id in removal["stages"] or row.stage.project_id_snapshot in removal["projects"]
        blocked = stage_deletion_reason(workspace, row.stage, removal) if manage else "仅项目负责人可以执行"
        formula = (
            RewardFormula.objects.filter(project_id_snapshot=row.stage.project_id_snapshot).order_by("-version").first()
        )
        stages.append(
            {
                "id": str(row.id),
                "stage_id": str(row.stage_id),
                "project_id": str(row.stage.project_id_snapshot),
                "name": row.stage.name,
                "B": str(row.stage.budget),
                "E": str(row.E),
                "purposes": row.purposes,
                "members": row.members if manage else [item for item in row.members if item["user_id"] == str(user.id)],
                "upgraded": row.upgraded,
                "history": row.history if manage else [item for item in row.history if item["user_id"] == str(user.id)],
                "execution_funded": str(funded(row)) if manage else None,
                "history_funded": str(funded(row, "history")) if manage else None,
                "formula_version": formula.version if formula else None,
                "can_manage": manage,
                "deleted": deleted,
                "can_restore": manage
                and row.stage_id in removal["stages"]
                and row.stage.project_id_snapshot not in removal["projects"],
                "can_delete": manage and blocked is None,
                "delete_reason": blocked,
            }
        )
        for kind in ("execution", "history"):
            for settlement in settlement_latest(row, kind).values():
                if manage or settlement.user_id_snapshot == user.id:
                    settlements.append(settlement_data(settlement, manage and not deleted))
    budget_ids = [row.id for row in budgets]
    forecast_scope = Q(budget__stage__project_id_snapshot__in=leads) | Q(user_id_snapshot=user.id)
    task_ids = [row.bounty_id for row in authorized_participations(user, workspace)]
    forecast_scope |= Q(bounty_id__in=task_ids)
    forecasts = [
        forecast_data(row)
        for row in RewardForecast.objects.filter(forecast_scope, budget_id__in=budget_ids)
        .select_related("budget__stage", "formula")
        .order_by("-created_at")
    ]
    commitments = []
    commitments_q = (
        PaymentCommitment.objects.filter(settlement__budget_id__in=budget_ids)
        .filter(Q(settlement__budget__stage__project_id_snapshot__in=leads) | Q(settlement__user_id_snapshot=user.id))
        .select_related("settlement__budget__stage", "operation")
    )
    for row in commitments_q:
        commitments.append(
            {
                "id": str(row.id),
                "settlement_id": str(row.settlement_id),
                "stage_id": str(row.settlement.budget.stage_id),
                "account_id": str(row.account_id),
                "user_id": str(row.settlement.user_id_snapshot),
                "amount": str(row.amount),
                "paid": str(commitment_paid(row)),
                "remaining": str(commitment_remaining(row)),
                "cancelled": commitment_cancelled(row),
                "can_manage": row.settlement.budget.stage.project_id_snapshot in leads
                and scope_open(row.settlement.budget.stage.project_id_snapshot, row.settlement.budget.stage_id),
            }
        )
    payments = []
    for row in OfflinePayment.objects.filter(commitment__in=commitments_q).select_related(
        "operation", "commitment__settlement"
    ):
        payments.append(
            {
                "id": str(row.id),
                "commitment_id": str(row.commitment_id),
                "settlement_id": str(row.commitment.settlement_id),
                "user_id": str(row.commitment.settlement.user_id_snapshot),
                "gross": str(row.gross),
                "withheld": str(row.withheld),
                "net": str(row.net),
                "evidence": row.operation.evidence,
                "reference": row.reference,
                "created_at": row.created_at.isoformat(),
                "occurred_at": row.operation.occurred_at.isoformat(),
                "reversed": hasattr(row.operation, "reversal"),
            }
        )
    batches = []
    for row in CashBatch.objects.filter(
        budget_id__in=budget_ids, budget__stage__project_id_snapshot__in=leads
    ).select_related("budget__stage", "operation"):
        risk_entries = FinancialEntry.objects.filter(account__stage=row.budget.stage, account__kind="risk", batch=row)
        remaining = aggregate(risk_entries, "delta")
        blocked = receipt_deletion_reason(row)
        if not blocked and (
            row.budget.stage_id in removal["stages"] or row.budget.stage.project_id_snapshot in removal["projects"]
        ):
            blocked = "请先恢复资金项目或阶段预算"
        batches.append(
            {
                "id": str(row.id),
                "operation_id": str(row.operation_id),
                "kind": row.operation.kind,
                "stage_id": str(row.budget.stage_id),
                "project_id": str(row.budget.stage.project_id_snapshot),
                "gross": str(row.gross),
                "costs": str(row.costs),
                "D": str(row.D),
                "source": row.source,
                "risk": str(row.risk),
                "execution": str(row.execution),
                "history": str(row.history),
                "risk_released": str(
                    -aggregate(
                        risk_entries.filter(operation__kind="risk-release", operation__reversal__isnull=True),
                        "delta",
                    )
                ),
                "risk_used": str(
                    -aggregate(
                        risk_entries.filter(operation__kind="risk-use", operation__reversal__isnull=True),
                        "delta",
                    )
                ),
                "risk_remaining": str(remaining),
                "history_snapshot": row.history_snapshot,
                "created_at": row.created_at.isoformat(),
                "occurred_at": row.operation.occurred_at.isoformat(),
                "reversed": hasattr(row.operation, "reversal"),
                "can_manage": not hasattr(row.operation, "reversal")
                and scope_open(row.budget.stage.project_id_snapshot, row.budget.stage_id),
                "can_delete": blocked is None,
                "delete_reason": blocked,
            }
        )
    operations = []
    closed_operations = set(
        FinancialEntry.objects.filter(
            Q(account__project_id_snapshot__in=removal["projects"]) | Q(account__stage_id__in=removal["stages"]),
            account__workspace=workspace,
        ).values_list("operation_id", flat=True)
    )
    op_scope = Q(project_id_snapshot__in=leads)
    if is_manager and not project_id:
        op_scope |= Q(project_id_snapshot__isnull=True) | Q(kind="exploration-allocation")
    for row in FinancialOperation.objects.filter(op_scope, workspace=workspace).order_by("created_at"):
        operations.append(
            {
                "id": str(row.id),
                "project_id": str(row.project_id_snapshot) if row.project_id_snapshot else None,
                "stage_id": str(row.stage_id) if row.stage_id else None,
                "kind": row.kind,
                "actor": row.actor_name,
                "reason": row.reason,
                "evidence": row.evidence,
                "payload": row.payload,
                "created_at": row.created_at.isoformat(),
                "occurred_at": row.occurred_at.isoformat(),
                "reverses_id": str(row.reverses_id) if row.reverses_id else None,
                "reversed": hasattr(row, "reversal"),
                "can_manage": (
                    is_manager
                    if row.kind == "exploration-allocation"
                    else row.project_id_snapshot in leads or row.project_id_snapshot is None and is_manager
                )
                and scope_open(row.project_id_snapshot, row.stage_id)
                and row.id not in closed_operations
                and row.kind not in {"stage-delete", "stage-restore", "project-delete", "project-restore"},
            }
        )
    entries = [
        entry_data(row)
        for row in FinancialEntry.objects.filter(
            account__workspace=workspace, account_id__in=[item["id"] for item in accounts]
        )
        .select_related("account", "operation")
        .order_by("created_at")
    ]
    members = [
        {"id": str(row.member_id), "name": row.member.display_name, "is_admin": row.role == 20}
        for row in WorkspaceMember.objects.filter(
            workspace=workspace, is_active=True, member__is_active=True
        ).select_related("member")
    ]
    projects = []
    for row in Project.objects.filter(workspace=workspace, id__in=visible):
        manage = row.id in leads
        deleted = row.id in removal["projects"]
        blocked = project_deletion_reason(workspace, row, removal) if manage else "仅项目负责人可以执行"
        projects.append(
            {
                "id": str(row.id),
                "name": row.name,
                "is_lead": manage,
                "archived": bool(row.archived_at),
                "finance_deleted": deleted,
                "deleted": deleted,
                "can_manage": manage,
                "can_restore": manage and deleted,
                "can_delete": manage and blocked is None,
                "delete_reason": blocked,
            }
        )
    formulas = [
        formula_data(row)
        for row in RewardFormula.objects.filter(workspace=workspace, project_id_snapshot__in=visible).order_by(
            "-version"
        )
    ]
    public_awards = []
    for row in public_latest(workspace):
        if is_manager or row.user_id_snapshot == user.id:
            paid = public_award_paid(row)
            payments_for_award = active_operations(
                PublicDutyPayment.objects.filter(commitment__award__group_key=row.group_key)
            )
            public_awards.append(
                {
                    "id": str(row.id),
                    "group_key": str(row.group_key),
                    "revision": row.revision,
                    "user_id": str(row.user_id_snapshot),
                    "user_name": row.user_name,
                    "period": row.period,
                    "duty": row.duty,
                    "amount": str(row.amount),
                    "paid": str(paid),
                    "outstanding": str(row.amount - paid),
                    "committed": str(public_award_reserved(row)),
                    "withheld": str(aggregate(payments_for_award, "withheld")),
                    "net_paid": str(aggregate(payments_for_award, "net")),
                    "can_manage": is_manager,
                }
            )
    public_commitments = []
    duty_commitments = PublicDutyCommitment.objects.filter(account__workspace=workspace).select_related(
        "award", "operation"
    )
    if not is_manager:
        duty_commitments = duty_commitments.filter(award__user_id_snapshot=user.id)
    for row in duty_commitments:
        public_commitments.append(
            {
                "id": str(row.id),
                "award_id": str(row.award_id),
                "user_id": str(row.award.user_id_snapshot),
                "user_name": row.award.user_name,
                "account_id": str(row.account_id),
                "amount": str(row.amount),
                "paid": str(public_commitment_paid(row)),
                "remaining": str(public_commitment_remaining(row)),
                "cancelled": public_commitment_cancelled(row),
                "can_manage": is_manager,
            }
        )
    public_payments = []
    for row in PublicDutyPayment.objects.filter(commitment__in=duty_commitments).select_related(
        "operation", "commitment__award"
    ):
        public_payments.append(
            {
                "id": str(row.id),
                "commitment_id": str(row.commitment_id),
                "award_id": str(row.commitment.award_id),
                "user_id": str(row.commitment.award.user_id_snapshot),
                "gross": str(row.gross),
                "withheld": str(row.withheld),
                "net": str(row.net),
                "evidence": row.operation.evidence,
                "reference": row.reference,
                "created_at": row.created_at.isoformat(),
                "occurred_at": row.operation.occurred_at.isoformat(),
                "reversed": hasattr(row.operation, "reversal"),
            }
        )
    funding_targets = (
        [
            {
                "stage_id": str(row.stage_id),
                "project_id": str(row.stage.project_id_snapshot),
                "project": row.stage.project_name,
                "name": row.stage.name,
                "E": str(row.E),
            }
            for row in StageBudget.objects.filter(stage__workspace_id_snapshot=workspace.id).select_related("stage")
            if row.stage_id not in removal["stages"] and row.stage.project_id_snapshot not in removal["projects"]
        ]
        if is_manager
        else []
    )
    return {
        "manager_id": str(policy(workspace).manager_id),
        "is_manager": is_manager,
        "projects": projects,
        "members": members,
        "accounts": accounts,
        "public_summary": public_summary,
        "stages": stages,
        "formulas": formulas,
        "forecasts": forecasts,
        "batches": batches,
        "settlements": settlements,
        "commitments": commitments,
        "payments": payments,
        "operations": operations,
        "entries": entries,
        "public_awards": public_awards,
        "public_commitments": public_commitments,
        "public_payments": public_payments,
        "funding_targets": funding_targets,
        "future_plan_limits": future_plan_limits(
            workspace,
            FinancialAccount.objects.filter(workspace=workspace, kind="future_pool").first() if is_manager else None,
        ),
    }


class FinanceOverviewView(LabView):
    def get(self, request, slug):
        return Response(overview_data(self.workspace, request.user, request.query_params.get("project_id")))


class FinanceEntriesView(LabView):
    def get(self, request, slug):
        data = overview_data(self.workspace, request.user, request.query_params.get("project_id"))["entries"]
        if request.query_params.get("format") == "csv":
            output = StringIO()
            writer = csv.writer(output)
            fields = [
                "id",
                "created_at",
                "occurred_at",
                "project_id",
                "stage_id",
                "account_id",
                "kind",
                "delta",
                "actor",
                "reason",
                "evidence",
                "operation_id",
                "reverses_id",
            ]
            writer.writerow(fields)
            for row in data:
                # A Decimal-derived signed amount is safe numeric CSV data;
                # quoting '-' as text would make spreadsheet totals omit debits.
                writer.writerow([row["delta"] if key == "delta" else csv_cell(row.get(key)) for key in fields])
            response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = 'attachment; filename="lab-cash-ledger.csv"'
            return response
        return Response(data)


class FinanceActionView(LabView):
    def post(self, request, slug, action):
        return Response(perform(request.user, self.workspace, action, request.data))


class RewardFormulaView(LabView):
    def get(self, request, slug, pk):
        visible, _, _ = financial_scope(self.workspace, request.user, pk)
        return Response(
            {
                "templates": TEMPLATES,
                "versions": [
                    formula_data(row)
                    for row in RewardFormula.objects.filter(
                        workspace=self.workspace, project_id_snapshot__in=visible
                    ).order_by("-version")
                ],
            }
        )

    def post(self, request, slug, pk):
        project = get_object_or_404(Project, id=pk, workspace=self.workspace)
        return Response(formula_data(save_formula(request.user, project, request.data)), status=201)


class RewardPreviewView(LabView):
    def post(self, request, slug, pk):
        project = get_object_or_404(Project, id=pk, workspace=self.workspace)
        return Response(preview_formula(request.user, project, request.data))


class RewardForecastView(LabView):
    def post(self, request, slug):
        return Response(forecast_data(create_forecast(request.user, self.workspace, request.data)), status=201)
