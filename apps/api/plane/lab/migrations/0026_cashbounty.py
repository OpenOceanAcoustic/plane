# Generated for the simple cash bounty feature.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0025_projectmanagementrecord"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CashBounty",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("title", models.CharField(max_length=255)),
                ("deliverable", models.TextField()),
                ("criteria", models.TextField(blank=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                ("status", models.CharField(default="open", max_length=20)),
                ("claimed_at", models.DateTimeField(null=True)),
                ("submitted_at", models.DateTimeField(null=True)),
                ("accepted_at", models.DateTimeField(null=True)),
                ("paid_at", models.DateTimeField(null=True)),
                ("due_at", models.DateTimeField(null=True)),
                ("evidence", models.TextField(blank=True)),
                ("acceptance_note", models.TextField(blank=True)),
                (
                    "claimed_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="lab_cash_bounties_claimed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "payment_operation",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="lab_cash_bounties",
                        to="lab.financialoperation",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lab_cash_bounties",
                        to="db.project",
                    ),
                ),
                (
                    "publisher",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="lab_cash_bounties_published",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "reviewer",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="lab_cash_bounties_reviewing",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lab_cash_bounties",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="lab_cash_bounty_positive"),
                    models.CheckConstraint(
                        condition=models.Q(("status__in", ("open", "claimed", "submitted", "accepted", "paid", "cancelled"))),
                        name="lab_cash_bounty_status",
                    ),
                ],
                "indexes": [models.Index(fields=["workspace", "project", "status"], name="lab_cash_bounty_scope")],
            },
        ),
    ]
