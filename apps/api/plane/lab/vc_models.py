# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Project-scoped VC grants and the two sources committed to member publications."""

from django.conf import settings
from django.db import models

from .models import Record


class VCGrant(Record):
    stage = models.ForeignKey("lab.Stage", on_delete=models.PROTECT, related_name="vc_grants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField()
    user_name = models.CharField(max_length=255)
    delta = models.DecimalField(max_digits=14, decimal_places=2)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_vc_grants"
    )
    reason = models.TextField()
    request_key = models.UUIDField(unique=True)
    request_snapshot = models.JSONField()

    class Meta:
        constraints = [models.CheckConstraint(condition=~models.Q(delta=0), name="lab_vc_grant_nonzero")]
        indexes = [models.Index(fields=["stage", "user_id_snapshot"], name="lab_vc_grant_member")]


class BountyFunding(Record):
    bounty = models.OneToOneField("lab.Bounty", on_delete=models.PROTECT, related_name="funding")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    owner_id_snapshot = models.UUIDField()
    source = models.CharField(
        max_length=16,
        choices=[("personal", "personal"), ("project", "project")],
        default="personal",
        db_default="personal",
    )
    project_committed = models.DecimalField(max_digits=14, decimal_places=2)
    earned_committed = models.DecimalField(max_digits=14, decimal_places=2)
    request_key = models.UUIDField(unique=True, null=True)
    request_snapshot = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(source="personal") | models.Q(source="project", earned_committed=0),
                name="lab_vc_funding_source",
            ),
            models.CheckConstraint(
                condition=models.Q(project_committed__gte=0, earned_committed__gte=0),
                name="lab_vc_funding_nonnegative",
            ),
        ]
        indexes = [models.Index(fields=["owner_id_snapshot"], name="lab_vc_funding_owner")]


class VCBudgetEntry(Record):
    stage = models.ForeignKey("lab.Stage", on_delete=models.PROTECT, related_name="vc_budget_entries")
    name = models.CharField(max_length=120)
    initial_amount = models.DecimalField(max_digits=14, decimal_places=2)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    revision = models.PositiveIntegerField(default=1)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    request_key = models.UUIDField(unique=True, null=True)
    request_snapshot = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gte=0, initial_amount__gte=0), name="lab_vc_budget_entry_nonnegative"
            )
        ]
