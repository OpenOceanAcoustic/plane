# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Immutable, decimal cash accounting, independent of the VC contribution ledger."""

import uuid

from django.conf import settings
from django.db import models
from rest_framework.exceptions import ValidationError

from .models import Record


class FinancialRecord(Record):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("财务历史不可覆盖，请追加更正或冲正")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("财务历史不可删除，请追加冲正")


class FinancePolicy(Record):
    workspace = models.OneToOneField("db.Workspace", on_delete=models.PROTECT)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class RewardFormula(FinancialRecord):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.PROTECT)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True)
    project_id_snapshot = models.UUIDField()
    version = models.PositiveIntegerField()
    task_expression = models.TextField()
    member_expression = models.TextField()
    parameters = models.JSONField(default=list)
    reason = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project_id_snapshot", "version"], name="lab_formula_version_unique")
        ]


class StageBudget(FinancialRecord):
    stage = models.OneToOneField("lab.Stage", on_delete=models.PROTECT, related_name="cash_budget")
    E = models.DecimalField(max_digits=14, decimal_places=2)
    purposes = models.JSONField(default=list)
    members = models.JSONField(default=list)
    upgraded = models.BooleanField(default=False)
    history = models.JSONField(default=list)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255)
    reason = models.TextField()

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(E__gte=0), name="lab_stage_cash_budget_nonnegative")]


class FinancialOperation(FinancialRecord):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.PROTECT)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True)
    project_id_snapshot = models.UUIDField(null=True)
    stage = models.ForeignKey("lab.Stage", on_delete=models.PROTECT, null=True)
    kind = models.CharField(max_length=40)
    request_key = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255)
    reason = models.TextField()
    evidence = models.TextField(blank=True)
    payload = models.JSONField(default=dict)
    occurred_at = models.DateTimeField()
    reverses = models.OneToOneField("self", on_delete=models.PROTECT, null=True, related_name="reversal")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "request_key"], name="lab_finance_request_unique")]


class FinancialAccount(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.PROTECT)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True)
    project_id_snapshot = models.UUIDField(null=True)
    stage = models.ForeignKey("lab.Stage", on_delete=models.PROTECT, null=True)
    kind = models.CharField(max_length=32)
    scope_key = models.CharField(max_length=160, unique=True)


class CashBatch(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    budget = models.ForeignKey(StageBudget, on_delete=models.PROTECT, related_name="batches")
    gross = models.DecimalField(max_digits=14, decimal_places=2)
    costs = models.DecimalField(max_digits=14, decimal_places=2)
    D = models.DecimalField(max_digits=14, decimal_places=2)
    source = models.TextField()
    risk = models.DecimalField(max_digits=14, decimal_places=2)
    execution = models.DecimalField(max_digits=14, decimal_places=2)
    history = models.DecimalField(max_digits=14, decimal_places=2)
    history_snapshot = models.JSONField(default=list)


class FinancialEntry(FinancialRecord):
    operation = models.ForeignKey(FinancialOperation, on_delete=models.PROTECT, related_name="entries")
    account = models.ForeignKey(FinancialAccount, on_delete=models.PROTECT, related_name="entries")
    batch = models.ForeignKey(CashBatch, on_delete=models.PROTECT, null=True)
    delta = models.DecimalField(max_digits=14, decimal_places=2)
    reverses = models.OneToOneField("self", on_delete=models.PROTECT, null=True, related_name="reversal")

    class Meta:
        constraints = [models.CheckConstraint(condition=~models.Q(delta=0), name="lab_financial_entry_nonzero")]


class RewardForecast(FinancialRecord):
    budget = models.ForeignKey(StageBudget, on_delete=models.PROTECT, related_name="forecasts")
    formula = models.ForeignKey(RewardFormula, on_delete=models.PROTECT)
    kind = models.CharField(max_length=12)
    basis = models.CharField(max_length=12)
    bounty = models.ForeignKey("lab.Bounty", on_delete=models.PROTECT, null=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField(null=True)
    expression = models.TextField()
    inputs = models.JSONField()
    result = models.DecimalField(max_digits=14, decimal_places=2)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_forecast_authors"
    )
    actor_name = models.CharField(max_length=255, default="")


class RewardSettlement(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    budget = models.ForeignKey(StageBudget, on_delete=models.PROTECT, related_name="settlements")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField()
    user_name = models.CharField(max_length=255)
    kind = models.CharField(max_length=12, default="execution")
    revision = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    forecast = models.ForeignKey(RewardForecast, on_delete=models.PROTECT, null=True)
    performance_basis = models.TextField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["budget", "user_id_snapshot", "kind", "revision"], name="lab_settlement_revision_unique"
            ),
            models.CheckConstraint(condition=models.Q(amount__gte=0), name="lab_settlement_nonnegative"),
        ]


class PaymentCommitment(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    settlement = models.ForeignKey(RewardSettlement, on_delete=models.PROTECT, related_name="commitments")
    account = models.ForeignKey(FinancialAccount, on_delete=models.PROTECT, related_name="commitments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="lab_commitment_positive")]


class CommitmentCancellation(FinancialRecord):
    commitment = models.OneToOneField(PaymentCommitment, on_delete=models.PROTECT, related_name="cancellation")
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)


class OfflinePayment(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    commitment = models.ForeignKey(PaymentCommitment, on_delete=models.PROTECT, related_name="payments")
    gross = models.DecimalField(max_digits=14, decimal_places=2)
    withheld = models.DecimalField(max_digits=14, decimal_places=2)
    net = models.DecimalField(max_digits=14, decimal_places=2)
    reference = models.CharField(max_length=255)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(gross__gt=0)
                & models.Q(withheld__gte=0)
                & models.Q(net__gte=0)
                & models.Q(gross=models.F("net") + models.F("withheld")),
                name="lab_payment_valid_amounts",
            )
        ]


class PublicDutyAward(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField()
    user_name = models.CharField(max_length=255)
    period = models.CharField(max_length=7)
    group_key = models.UUIDField(default=uuid.uuid4)
    revision = models.PositiveIntegerField(default=1)
    duty = models.TextField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gte=0), name="lab_public_duty_positive"),
            models.UniqueConstraint(fields=["group_key", "revision"], name="lab_public_duty_revision_unique"),
        ]


class PublicDutyCommitment(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    award = models.ForeignKey(PublicDutyAward, on_delete=models.PROTECT, related_name="commitments")
    account = models.ForeignKey(FinancialAccount, on_delete=models.PROTECT, related_name="public_commitments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="lab_public_commit_positive")]


class PublicDutyPayment(FinancialRecord):
    operation = models.OneToOneField(FinancialOperation, on_delete=models.PROTECT)
    commitment = models.ForeignKey(PublicDutyCommitment, on_delete=models.PROTECT, related_name="payments")
    gross = models.DecimalField(max_digits=14, decimal_places=2)
    withheld = models.DecimalField(max_digits=14, decimal_places=2)
    net = models.DecimalField(max_digits=14, decimal_places=2)
    reference = models.CharField(max_length=255)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(gross__gt=0)
                & models.Q(withheld__gte=0)
                & models.Q(net__gte=0)
                & models.Q(gross=models.F("net") + models.F("withheld")),
                name="lab_public_payment_valid",
            )
        ]
