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
