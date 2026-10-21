# Persist AI assistant threads, messages and draft audit.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0027_cashbounty_proposal"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentThread",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("title", models.CharField(max_length=160)),
                ("last_message_at", models.DateTimeField(null=True)),
                ("project", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_threads", to="db.project")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_threads", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_threads", to="db.workspace")),
            ],
            options={
                "ordering": ("-last_message_at", "-created_at"),
                "indexes": [models.Index(fields=["workspace", "user", "last_message_at"], name="lab_agent_thread_scope")],
            },
        ),
        migrations.CreateModel(
            name="AgentMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("role", models.CharField(max_length=12)),
                ("content", models.TextField()),
                ("intent", models.CharField(blank=True, max_length=24)),
                ("draft", models.JSONField(blank=True, default=dict)),
                ("thread", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="lab.agentthread")),
            ],
            options={
                "ordering": ("created_at", "id"),
                "indexes": [models.Index(fields=["thread", "created_at"], name="lab_agent_message_thread")],
            },
        ),
    ]
