# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models

from .models import Record


class BountyQuote(Record):
    bounty = models.ForeignKey("lab.Bounty", on_delete=models.PROTECT, related_name="quotes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField()
    user_name = models.CharField(max_length=255)
    revision = models.PositiveIntegerField()
    kind = models.CharField(max_length=16, choices=[("original", "original"), ("negotiated", "negotiated")])
    vc = models.DecimalField(max_digits=14, decimal_places=2)
    available_at_submission = models.DecimalField(max_digits=14, decimal_places=2)
    deliverable = models.TextField()
    basis = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        default="pending",
        choices=[(value, value) for value in ("pending", "pending_review", "approved", "rejected", "closed")],
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_quote_reviews"
    )
    approval_snapshot = models.JSONField(default=dict)
    allocation = models.OneToOneField("lab.Allocation", on_delete=models.PROTECT, null=True, related_name="quote")
    request_key = models.UUIDField(unique=True)
    request_snapshot = models.JSONField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bounty", "user_id_snapshot", "revision"], name="lab_quote_revision"),
            models.UniqueConstraint(
                fields=["bounty", "user_id_snapshot"],
                condition=models.Q(status__in=["pending", "pending_review"]),
                name="lab_quote_pending",
            ),
            models.CheckConstraint(condition=models.Q(vc__gt=0), name="lab_quote_positive_vc"),
        ]


class BountyQuoteAttachment(Record):
    bounty = models.ForeignKey("lab.Bounty", on_delete=models.PROTECT)
    quote = models.ForeignKey(BountyQuote, on_delete=models.PROTECT, related_name="attachments", null=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    name = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    storage_key = models.CharField(max_length=800)
