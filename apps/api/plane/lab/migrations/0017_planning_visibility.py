# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import migrations, models


def preserve_visibility_and_publish_bounties(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("lab", "PersonalItem").objects.using(alias).filter(public=True).update(visibility="leads")
    publication = apps.get_model("lab", "BountyPublication")
    for bounty in apps.get_model("lab", "Bounty").objects.using(alias).exclude(status="deleted").iterator():
        row, _ = publication.objects.using(alias).get_or_create(
            bounty=bounty,
            defaults={"summary": bounty.title, "deliverable": bounty.deliverable, "criteria": bounty.criteria},
        )
        row.enabled = True
        row.deliverable = row.deliverable or bounty.deliverable
        row.criteria = row.criteria or bounty.criteria
        row.save(using=alias, update_fields=["enabled", "deliverable", "criteria"])


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("lab", "0016_project_finance_permissions"),
    ]
    operations = [
        migrations.AddField(
            model_name="personalitem",
            name="visibility",
            field=models.CharField(
                choices=[
                    ("private", "private"),
                    ("organization", "organization"),
                    ("selected", "selected"),
                    ("leads", "leads"),
                ],
                default="private",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="personalitem",
            name="shared_users",
            field=models.ManyToManyField(blank=True, related_name="shared_planning_items", to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(preserve_visibility_and_publish_bounties, migrations.RunPython.noop),
    ]
