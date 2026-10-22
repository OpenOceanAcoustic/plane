# AI-created annotations on finance records.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0032_agentaction"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentAnnotation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("target_type", models.CharField(default="cost", max_length=20)),
                ("target_id", models.CharField(max_length=64)),
                ("content", models.TextField()),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_annotations", to="db.project")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_annotations", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_annotations", to="db.workspace")),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [models.Index(fields=["project", "target_id"], name="lab_agent_annotation_scope")],
            },
        ),
    ]
