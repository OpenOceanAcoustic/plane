# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

from django.conf import settings
from django.db import models


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class Invitation(Record):
    token_hash = models.CharField(max_length=64, unique=True)
    kind = models.CharField(
        max_length=16, choices=[("bootstrap", "bootstrap"), ("member", "member"), ("rebind", "rebind")]
    )
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, null=True)
    workspace_slug = models.SlugField(max_length=48, blank=True)
    role = models.PositiveSmallIntegerField(default=15)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    consumed_at = models.DateTimeField(null=True)


class Enrollment(Record):
    invitation = models.ForeignKey(Invitation, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    encrypted_secret = models.TextField()
    username = models.CharField(max_length=128)
    display_name = models.CharField(max_length=255)
    email = models.EmailField()
    attempts = models.PositiveSmallIntegerField(default=0)


class Credential(Record):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    encrypted_secret = models.TextField()
    enabled = models.BooleanField(default=True)
    generation = models.UUIDField(default=uuid.uuid4)
    last_step = models.BigIntegerField(default=-1)


class LoginAccount(Record):
    # Durable lock row; hashed canonical username also covers unknown accounts.
    identity_hash = models.CharField(max_length=64, unique=True)


class LoginAttempt(Record):
    account = models.ForeignKey(LoginAccount, on_delete=models.CASCADE)
    submitted_at = models.DateTimeField(db_index=True)

    class Meta:
        indexes = [models.Index(fields=["account", "submitted_at"], name="lab_login_account_time_idx")]


class Audit(Record):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255, blank=True)
    workspace_id_snapshot = models.UUIDField(null=True)
    action = models.CharField(max_length=80)
    object_id = models.UUIDField(null=True)
    details = models.JSONField(default=dict)


class WorkspacePolicy(Record):
    workspace = models.OneToOneField("db.Workspace", on_delete=models.CASCADE)


class Folder(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=40)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]


class PersonalItem(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    folder = models.ForeignKey(Folder, on_delete=models.SET_NULL, null=True)
    issue = models.ForeignKey("db.Issue", on_delete=models.SET_NULL, null=True)
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=16, default="research")
    status = models.CharField(max_length=16, default="todo")
    public = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "issue"],
                condition=models.Q(issue__isnull=False),
                name="lab_one_personal_reference_per_issue",
            )
        ]


class TimeBlock(Record):
    COLOR_CHOICES = [
        ("", "按类别"),
        ("blue", "蓝色"),
        ("purple", "紫色"),
        ("green", "绿色"),
        ("orange", "橙色"),
        ("pink", "粉色"),
        ("cyan", "青色"),
    ]
    item = models.ForeignKey(PersonalItem, on_delete=models.CASCADE, related_name="blocks")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField()
    revision = models.PositiveIntegerField(default=1)
    color = models.CharField(max_length=8, choices=COLOR_CHOICES, default="", blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(end__gt=models.F("start")), name="lab_positive_time_block"),
            models.CheckConstraint(
                condition=models.Q(color__in=["", "blue", "purple", "green", "orange", "pink", "cyan"]),
                name="lab_valid_block_color",
            ),
        ]


class ProjectFlow(Record):
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE)
    todo = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="lab_todo")
    active = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="lab_active")
    review = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="lab_review")
    done = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="lab_done")


class Stage(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.SET_NULL, null=True)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True)
    workspace_id_snapshot = models.UUIDField()
    project_id_snapshot = models.UUIDField()
    project_name = models.CharField(max_length=255)
    name = models.CharField(max_length=120)
    budget = models.DecimalField(max_digits=14, decimal_places=2)
    frozen_at = models.DateTimeField()

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(budget__gt=0), name="lab_positive_stage_budget")]


class Bounty(Record):
    stage = models.ForeignKey(Stage, on_delete=models.PROTECT, related_name="bounties")
    issue = models.OneToOneField("db.Issue", on_delete=models.SET_NULL, null=True)
    issue_id_snapshot = models.UUIDField()
    title = models.CharField(max_length=255)
    deliverable = models.TextField()
    criteria = models.TextField()
    budget = models.DecimalField(max_digits=14, decimal_places=2)
    reserved = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=20, default="draft")
    major = models.BooleanField(default=False)
    major_reasons = models.JSONField(default=list)
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_published"
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_reviews"
    )
    independent_reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_major_reviews"
    )
    published_at = models.DateTimeField(null=True)
    submitted_at = models.DateTimeField(null=True)
    due_at = models.DateTimeField(null=True)
    evidence = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(budget__gt=0)
                & models.Q(reserved__gte=0)
                & models.Q(reserved__lte=models.F("budget")),
                name="lab_valid_team_budget",
            )
        ]


class Allocation(Record):
    bounty = models.ForeignKey(Bounty, on_delete=models.PROTECT, related_name="allocations")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    user_id_snapshot = models.UUIDField()
    user_name = models.CharField(max_length=255)
    deliverable = models.TextField()
    planned = models.DecimalField(max_digits=14, decimal_places=2)
    approved = models.BooleanField(default=False)
    confirmed = models.BooleanField(default=False)
    closed = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bounty", "user_id_snapshot"], name="lab_unique_participant"),
            models.CheckConstraint(condition=models.Q(planned__gt=0), name="lab_positive_planned_vc"),
        ]


class Acceptance(Record):
    bounty = models.ForeignKey(Bounty, on_delete=models.PROTECT, related_name="acceptances")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    reviewer_name = models.CharField(max_length=255)
    result = models.CharField(max_length=16)
    reason = models.TextField()
    targets = models.JSONField(default=dict)
    independent_reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_acceptance_checks"
    )
    approved_at = models.DateTimeField(null=True)
    request_key = models.UUIDField(unique=True)


class Ledger(Record):
    bounty = models.ForeignKey(Bounty, on_delete=models.PROTECT, related_name="ledger")
    allocation = models.ForeignKey(Allocation, on_delete=models.PROTECT, related_name="ledger")
    acceptance = models.ForeignKey(Acceptance, on_delete=models.PROTECT, null=True)
    delta = models.DecimalField(max_digits=14, decimal_places=2)
    reverses = models.OneToOneField("self", on_delete=models.PROTECT, null=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    actor_name = models.CharField(max_length=255)
    reason = models.TextField()
    task_snapshot = models.JSONField()
    participant_snapshot = models.JSONField()
    request_key = models.UUIDField(unique=True)


class WIPException(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    approver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="lab_wip_approvals")
    reason = models.TextField()
    expires_at = models.DateTimeField()
    active_limit = models.PositiveSmallIntegerField(default=2)
    major_limit = models.PositiveSmallIntegerField(default=1)


# Register extension models in this Django app while keeping their interfaces separate.
from .document_models import TaskDocumentLink  # noqa: E402,F401
from .field_models import FieldDefinition, IssueFieldValue, ProjectField  # noqa: E402,F401
