# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from django.db import models


class FieldDefinition(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=20)
    options = models.JSONField(default=list)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]


class ProjectField(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE)
    field = models.ForeignKey(FieldDefinition, on_delete=models.PROTECT)
    enabled = models.BooleanField(default=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "field"], name="lab_project_field_unique")]
        ordering = ["position", "id"]


class IssueFieldValue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE)
    field = models.ForeignKey(FieldDefinition, on_delete=models.PROTECT)
    value = models.JSONField(null=True, default=None)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["issue", "field"], name="lab_issue_field_value_unique")]
