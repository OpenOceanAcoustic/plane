# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from plane.db.models.base import BaseModel


class TaskDocumentLink(BaseModel):
    """An explicit association, independent of mentions extracted from editor content."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="lab_documents")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="lab_tasks")

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "page"],
                condition=models.Q(deleted_at__isnull=True),
                name="lab_unique_active_task_document",
            )
        ]


class DocumentFileVersion(BaseModel):
    """The original private file belonging to one native document version."""

    page_version = models.OneToOneField("db.PageVersion", on_delete=models.PROTECT, related_name="lab_file")
    asset = models.OneToOneField("db.FileAsset", on_delete=models.PROTECT, related_name="lab_document_file")
    name = models.CharField(max_length=255)
    extension = models.CharField(max_length=8)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    asset_key = models.CharField(max_length=800)
