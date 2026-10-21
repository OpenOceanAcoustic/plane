# Add in-app AI reminders for daily/weekly briefs and payroll cutoff.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0028_agent_thread_message"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentReminder",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("kind", models.CharField(max_length=20)),
                ("enabled", models.BooleanField(default=True)),
                ("hour", models.PositiveSmallIntegerField(default=9)),
                ("weekday", models.PositiveSmallIntegerField(null=True)),
                ("day_of_month", models.PositiveSmallIntegerField(null=True)),
                ("last_run_at", models.DateTimeField(null=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_reminders", to="db.project")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_reminders", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_reminders", to="db.workspace")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=["workspace", "project", "user", "kind"], name="lab_agent_reminder_unique")],
                "indexes": [models.Index(fields=["enabled", "kind"], name="lab_agent_reminder_scope")],
            },
        ),
    ]
