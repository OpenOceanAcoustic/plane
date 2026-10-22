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
    # One durable quota identity per existing user; unknown usernames never create rows.
    identity_hash = models.CharField(max_length=64, unique=True)


class TrustedBrowser(Record):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=8, choices=[("user", "user"), ("admin", "admin")])
    generation = models.UUIDField()
    name = models.CharField(max_length=120, default="浏览器")
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    last_used_at = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["user", "purpose", "expires_at"], name="lab_browser_user_expiry_idx")]


class LoginAttempt(Record):
    account = models.ForeignKey(LoginAccount, on_delete=models.CASCADE)
    browser = models.ForeignKey(TrustedBrowser, on_delete=models.CASCADE, null=True)
    session_hash = models.CharField(max_length=64, blank=True, default="")
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


class PersonalCategory(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=40)
    color = models.CharField(max_length=7)
    position = models.PositiveIntegerField(default=0)
    legacy_key = models.CharField(max_length=16, blank=True, default="")

    class Meta:
        ordering = ["position", "created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user", "name"], name="lab_category_name_unique"),
            models.CheckConstraint(condition=models.Q(color__regex=r"^#[0-9a-f]{6}$"), name="lab_category_valid_color"),
        ]


class PersonalItem(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    folder = models.ForeignKey(Folder, on_delete=models.SET_NULL, null=True)
    category = models.ForeignKey(PersonalCategory, on_delete=models.SET_NULL, null=True, blank=True)
    issue = models.ForeignKey("db.Issue", on_delete=models.SET_NULL, null=True)
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=16, default="research")
    status = models.CharField(max_length=16, default="todo")
    public = models.BooleanField(default=False)
    visibility = models.CharField(
        max_length=16,
        default="private",
        choices=[
            ("private", "private"),
            ("organization", "organization"),
            ("selected", "selected"),
            ("leads", "leads"),
        ],
    )
    shared_users = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="shared_planning_items", blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "issue"],
                condition=models.Q(issue__isnull=False),
                name="lab_one_personal_reference_per_issue",
            )
        ]


class TimeBlock(Record):
    item = models.ForeignKey(PersonalItem, on_delete=models.CASCADE, related_name="blocks")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField()
    revision = models.PositiveIntegerField(default=1)
    color = models.CharField(max_length=7, default="", blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(end__gt=models.F("start")), name="lab_positive_time_block"),
            models.CheckConstraint(
                condition=models.Q(color="") | models.Q(color__regex=r"^#[0-9a-f]{6}$"),
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
    member_funded = models.BooleanField(default=False, db_default=False)
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
from .document_models import DocumentFileVersion, TaskDocumentLink  # noqa: E402,F401
from .field_models import FieldDefinition, IssueFieldValue, ProjectField  # noqa: E402,F401
from .bounty_models import BountyMaterial, BountyPublication, BountyTaskAccess  # noqa: E402,F401
from .chat_models import ChatThread, ChatMessage, ChatImage, ChatReadState, ChatSubmission, ChatMention  # noqa: E402,F401
from .quote_models import BountyQuote, BountyQuoteAttachment  # noqa: E402,F401
from .vc_models import BountyFunding, VCBudgetEntry, VCGrant  # noqa: E402,F401
from .finance_models import (  # noqa: E402,F401
    CashBatch,
    CommitmentCancellation,
    FinancialAccount,
    FinancialEntry,
    FinancialOperation,
    FinancePolicy,
    ProjectFinancePermission,
    ProjectCostBudget,
    OfflinePayment,
    PaymentCommitment,
    PublicDutyAward,
    PublicDutyCommitment,
    PublicDutyPayment,
    RewardForecast,
    RewardFormula,
    RewardSettlement,
    StageBudget,
)
from .management_models import ProjectManagementRecord  # noqa: E402,F401

class CashBounty(Record):
    """Simple fixed-cash task: first member claims, lead accepts, cash paid from project account."""

    STATUSES = ("proposed", "open", "claimed", "submitted", "accepted", "paid", "cancelled")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="lab_cash_bounties")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="lab_cash_bounties")
    title = models.CharField(max_length=255)
    deliverable = models.TextField()
    criteria = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=20, default="open")
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_cash_bounties_published"
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_cash_bounties_reviewing"
    )
    claimed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_cash_bounties_claimed"
    )
    claimed_at = models.DateTimeField(null=True)
    submitted_at = models.DateTimeField(null=True)
    accepted_at = models.DateTimeField(null=True)
    paid_at = models.DateTimeField(null=True)
    due_at = models.DateTimeField(null=True)
    evidence = models.TextField(blank=True)
    acceptance_note = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(null=True)
    review_note = models.TextField(blank=True)
    payment_operation = models.ForeignKey(
        "lab.FinancialOperation", on_delete=models.SET_NULL, null=True, related_name="lab_cash_bounties"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="lab_cash_bounty_positive"),
            models.CheckConstraint(
                condition=models.Q(status__in=("proposed", "open", "claimed", "submitted", "accepted", "paid", "cancelled")),
                name="lab_cash_bounty_status",
            ),
        ]
        indexes = [models.Index(fields=["workspace", "project", "status"], name="lab_cash_bounty_scope")]

class AgentThread(Record):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="lab_agent_threads")
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True, related_name="lab_agent_threads")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lab_agent_threads")
    title = models.CharField(max_length=160)
    last_message_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [models.Index(fields=["workspace", "user", "last_message_at"], name="lab_agent_thread_scope")]
        ordering = ("-last_message_at", "-created_at")


class AgentMessage(Record):
    thread = models.ForeignKey(AgentThread, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=12)
    content = models.TextField()
    intent = models.CharField(max_length=24, blank=True)
    draft = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [models.Index(fields=["thread", "created_at"], name="lab_agent_message_thread")]
        ordering = ("created_at", "id")


class AgentReminder(Record):
    KINDS = ("daily_brief", "weekly_brief", "payroll")

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="lab_agent_reminders")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="lab_agent_reminders")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lab_agent_reminders")
    kind = models.CharField(max_length=20)
    enabled = models.BooleanField(default=True)
    hour = models.PositiveSmallIntegerField(default=9)
    weekday = models.PositiveSmallIntegerField(null=True)
    day_of_month = models.PositiveSmallIntegerField(null=True)
    last_run_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "project", "user", "kind"], name="lab_agent_reminder_unique"
            )
        ]
        indexes = [models.Index(fields=["enabled", "kind"], name="lab_agent_reminder_scope")]


class AgentProposal(Record):
    CATEGORIES = ("process", "plan", "quality", "allocation", "policy")

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="lab_agent_proposals")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="lab_agent_proposals")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lab_agent_proposals")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, default="process")
    status = models.CharField(max_length=20, default="review")
    lead_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_agent_proposals_lead"
    )
    lead_approved_at = models.DateTimeField(null=True)
    member_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_agent_proposals_member"
    )
    member_approved_at = models.DateTimeField(null=True)
    technical_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_agent_proposals_technical"
    )
    technical_approved_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [models.Index(fields=["project", "status"], name="lab_agent_proposal_scope")]
        ordering = ("-created_at",)


class AgentLeadRequest(Record):
    STATUSES = ("pending", "approved", "rejected")

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="lab_agent_lead_requests")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="lab_agent_lead_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lab_agent_lead_requests"
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lab_agent_lead_targets"
    )
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, default="pending")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="lab_agent_lead_reviews"
    )
    reviewed_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [models.Index(fields=["project", "status"], name="lab_agent_lead_scope")]
        ordering = ("-created_at",)
