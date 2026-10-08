# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Explicit public projections and grants; never project membership."""

from django.conf import settings
from django.db import models

from .models import Record


class BountyPublication(Record):
    bounty = models.OneToOneField("lab.Bounty", on_delete=models.CASCADE, related_name="publication")
    summary = models.TextField(blank=True)
    deliverable = models.TextField(blank=True)
    criteria = models.TextField(blank=True)
    # Old tasks without this record retain their original project visibility.
    enabled = models.BooleanField(default=True)


class BountyTaskAccess(Record):
    allocation = models.OneToOneField("lab.Allocation", on_delete=models.CASCADE, related_name="task_access")
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    requires_project_membership = models.BooleanField(default=False)
    revoked_at = models.DateTimeField(null=True)


class BountyMaterial(Record):
    bounty = models.ForeignKey("lab.Bounty", on_delete=models.CASCADE, related_name="materials")
    kind = models.CharField(
        max_length=24, choices=[("document_version", "document_version"), ("attachment", "attachment")]
    )
    label = models.CharField(max_length=255)
    page_version = models.ForeignKey("db.PageVersion", on_delete=models.SET_NULL, null=True)
    attachment = models.ForeignKey("db.FileAsset", on_delete=models.SET_NULL, null=True)
    # Version contents are frozen at sharing, even if a native version later changes.
    document_snapshot = models.JSONField(default=dict)
    attachment_key = models.CharField(max_length=800, blank=True)
    shared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    revoked_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(kind="document_version", attachment__isnull=True)
                    | models.Q(kind="attachment", page_version__isnull=True)
                ),
                name="lab_bounty_material_kind",
            ),
        ]
