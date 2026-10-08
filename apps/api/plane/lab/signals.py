# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db.models.signals import post_migrate, post_save


def workspace_policy_on_create(sender, instance, created, raw, using, **kwargs):
    if created and not raw and settings.LAB_AUTH_ENABLED:
        from .models import WorkspacePolicy

        WorkspacePolicy.objects.using(using).get_or_create(workspace_id=instance.pk)


def backfill_workspace_policies(sender, using, apps=None, **kwargs):
    """Also runs when migrate has no pending migrations, including mode changes."""
    if not settings.LAB_AUTH_ENABLED:
        return
    if apps is None:
        # flush emits the same signal without migrate's historical app registry.
        from django.apps import apps

    try:
        workspace = apps.get_model("db", "Workspace")
        policy = apps.get_model("lab", "WorkspacePolicy")
    except LookupError:
        return  # A targeted upstream migration may not have installed lab yet.
    missing = (
        workspace.objects.using(using)
        .filter(deleted_at__isnull=True)
        .exclude(id__in=policy.objects.using(using).values("workspace_id"))
        .values_list("id", flat=True)
    )
    policy.objects.using(using).bulk_create(
        [policy(workspace_id=identifier) for identifier in missing.iterator()],
        batch_size=1000,
        ignore_conflicts=True,
    )


def register_signals(app_config):
    post_save.connect(workspace_policy_on_create, sender="db.Workspace", dispatch_uid="lab.workspace_policy.create")
    post_migrate.connect(backfill_workspace_policies, sender=app_config, dispatch_uid="lab.workspace_policy.backfill")
