# Prepared, human-confirmed AI actions (approval/annotation).

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0031_agentleadrequest"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentAction",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("kind", models.CharField(max_length=30)),
                ("target_type", models.CharField(max_length=20)),
                ("target_id", models.CharField(max_length=64)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(default="prepared", max_length=20)),
                ("token", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("expires_at", models.DateTimeField()),
                ("executed_at", models.DateTimeField(null=True)),
                ("result", models.JSONField(blank=True, default=dict)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_actions", to="db.project")),
                ("thread", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_actions", to="lab.agentthread")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_actions", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_actions", to="db.workspace")),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [models.Index(fields=["project", "status"], name="lab_agent_action_scope")],
            },
        ),
    ]
