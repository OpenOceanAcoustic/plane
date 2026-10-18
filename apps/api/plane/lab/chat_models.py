# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.utils import timezone

from .models import Record


class ChatThread(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    scope = models.CharField(max_length=16, choices=[(value, value) for value in ("workspace", "project", "issue")])
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True)
    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, null=True, related_name="chat_thread")
    baseline_at = models.DateTimeField(default=timezone.now)
    activity_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace"], condition=models.Q(scope="workspace"), name="lab_chat_workspace"
            ),
            models.UniqueConstraint(fields=["project"], condition=models.Q(scope="project"), name="lab_chat_project"),
            models.CheckConstraint(
                condition=(
                    models.Q(scope="workspace", project__isnull=True, issue__isnull=True)
                    | models.Q(scope="project", project__isnull=False, issue__isnull=True)
                    | models.Q(scope="issue", project__isnull=False, issue__isnull=False)
                ),
                name="lab_chat_scope",
            ),
        ]


class ChatMessage(Record):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name="messages")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    comment_html = models.TextField()
    comment_json = models.JSONField(default=dict, blank=True)
    comment_stripped = models.TextField(blank=True)
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True)
    edited_at = models.DateTimeField(null=True)
    deleted_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [models.Index(fields=["thread", "created_at", "id"], name="lab_chat_message_order")]


class ChatImage(Record):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE)
    asset = models.OneToOneField("db.FileAsset", on_delete=models.CASCADE)
    message = models.ForeignKey(ChatMessage, on_delete=models.CASCADE, null=True)


class ChatReadState(Record):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    read_at = models.DateTimeField()
    message_id = models.UUIDField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["thread", "user"], name="lab_chat_read_user")]


class ChatSubmission(Record):
    """A receipt makes a lost HTTP response safe to retry, including legacy comments."""

    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    key = models.UUIDField()
    message_id = models.UUIDField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["thread", "user", "key"], name="lab_chat_submission_key")]


class ChatMention(Record):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE)
    message_id = models.UUIDField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    notification = models.OneToOneField("db.Notification", on_delete=models.SET_NULL, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["thread", "message_id", "user"], name="lab_chat_mention_once")]
