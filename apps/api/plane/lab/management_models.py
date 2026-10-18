# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Append-only source records for project costs and quality deliverables."""

from django.conf import settings
from django.db import models
from .finance_models import FinancialRecord


class ProjectManagementRecord(FinancialRecord):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.PROTECT)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True)
    project_id_snapshot = models.UUIDField()
    kind = models.CharField(max_length=16)
    object_key = models.UUIDField()
    version = models.PositiveIntegerField()
    state = models.CharField(max_length=16)
    data = models.JSONField(default=dict)
    document_version = models.ForeignKey("db.PageVersion", on_delete=models.PROTECT, null=True)
    reason = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255)
    request_key = models.UUIDField()
    request_snapshot = models.JSONField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project_id_snapshot", "object_key", "version"], name="lab_management_version_unique"
            ),
            models.UniqueConstraint(fields=["workspace", "request_key"], name="lab_management_request_unique"),
        ]
        indexes = [models.Index(fields=["project_id_snapshot", "kind"], name="lab_management_project_kind")]


def latest_records(project_id):
    rows = ProjectManagementRecord.objects.filter(project_id_snapshot=project_id)
    identifiers = rows.order_by("object_key", "-version").distinct("object_key").values("pk")
    return rows.filter(pk__in=identifiers).order_by("-created_at", "-id")
