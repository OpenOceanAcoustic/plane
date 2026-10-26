import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("lab", "0037_project_receipts"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="PayrollSchedule",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("enabled", models.BooleanField(default=False)),
                ("start_month", models.CharField(max_length=7)),
                ("last_run_at", models.DateTimeField(null=True)),
                ("last_month", models.CharField(blank=True, max_length=7)),
                ("last_status", models.CharField(blank=True, max_length=16)),
                ("last_error", models.TextField(blank=True)),
                (
                    "authorized_by",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL
                    ),
                ),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="db.workspace")),
                (
                    "project",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lab_payroll_schedule",
                        to="db.project",
                    ),
                ),
            ],
            options={"indexes": [models.Index(fields=["enabled"], name="lab_payroll_schedule_enabled")]},
        ),
        migrations.CreateModel(
            name="PayrollRun",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("project_id_snapshot", models.UUIDField()),
                ("month", models.CharField(max_length=7)),
                ("source", models.CharField(max_length=12)),
                ("status", models.CharField(max_length=16)),
                ("created_count", models.PositiveIntegerField(default=0)),
                ("created_amount", models.DecimalField(decimal_places=2, default=0, max_digits=18)),
                ("record_ids", models.JSONField(default=list)),
                ("error", models.TextField(blank=True)),
                (
                    "actor",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL
                    ),
                ),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="db.workspace")),
                (
                    "project",
                    models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to="db.project"),
                ),
            ],
            options={"indexes": [models.Index(fields=["project", "created_at"], name="lab_payroll_run_project")]},
        ),
    ]
