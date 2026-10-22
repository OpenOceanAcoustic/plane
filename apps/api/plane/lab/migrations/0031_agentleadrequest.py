# Project lead change requests, reviewed by a project admin.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0030_agentproposal"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentLeadRequest",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("reason", models.TextField(blank=True)),
                ("status", models.CharField(default="pending", max_length=20)),
                ("reviewed_at", models.DateTimeField(null=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_lead_requests", to="db.project")),
                ("requested_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_lead_requests", to=settings.AUTH_USER_MODEL)),
                ("reviewed_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_lead_reviews", to=settings.AUTH_USER_MODEL)),
                ("target_user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_lead_targets", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_lead_requests", to="db.workspace")),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [models.Index(fields=["project", "status"], name="lab_agent_lead_scope")],
            },
        ),
    ]
