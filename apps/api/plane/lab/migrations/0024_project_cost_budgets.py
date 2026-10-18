# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("lab", "0023_wip_reminders"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="ProjectCostBudget",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("project_id_snapshot", models.UUIDField()),
                ("version", models.PositiveIntegerField()),
                ("items", models.JSONField(default=list)),
                ("total", models.DecimalField(max_digits=14, decimal_places=2)),
                ("reason", models.TextField()),
                ("actor_name", models.CharField(max_length=255)),
                ("request_key", models.UUIDField()),
                ("request_snapshot", models.JSONField()),
                (
                    "actor",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to="db.project"),
                ),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="db.workspace")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=["project_id_snapshot", "version"], name="lab_cost_budget_version_unique"
                    ),
                    models.UniqueConstraint(fields=["workspace", "request_key"], name="lab_cost_budget_request_unique"),
                    models.CheckConstraint(condition=models.Q(total__gte=0), name="lab_cost_budget_nonnegative"),
                ]
            },
        ),
        migrations.RunSQL(
            "CREATE TRIGGER lab_financial_history BEFORE UPDATE OR DELETE ON lab_projectcostbudget "
            "FOR EACH ROW EXECUTE FUNCTION lab_financial_history_guard()",
            "DROP TRIGGER IF EXISTS lab_financial_history ON lab_projectcostbudget",
        ),
    ]
