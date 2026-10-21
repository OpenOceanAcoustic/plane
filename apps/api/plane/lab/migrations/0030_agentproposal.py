# Add three-way review proposals: lead, member and technical/finance.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0029_agentreminder"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentProposal",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("category", models.CharField(default="process", max_length=20)),
                ("status", models.CharField(default="review", max_length=20)),
                ("lead_approved_at", models.DateTimeField(null=True)),
                ("member_approved_at", models.DateTimeField(null=True)),
                ("technical_approved_at", models.DateTimeField(null=True)),
                ("lead_approved_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_proposals_lead", to=settings.AUTH_USER_MODEL)),
                ("member_approved_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_proposals_member", to=settings.AUTH_USER_MODEL)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_proposals", to="db.project")),
                ("technical_approved_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lab_agent_proposals_technical", to=settings.AUTH_USER_MODEL)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_proposals", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lab_agent_proposals", to="db.workspace")),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [models.Index(fields=["project", "status"], name="lab_agent_proposal_scope")],
            },
        ),
    ]
