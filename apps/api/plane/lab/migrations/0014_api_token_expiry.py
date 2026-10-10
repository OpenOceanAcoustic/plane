# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta
from django.db import migrations
from django.utils import timezone


def expire_permanent_tokens(apps, schema_editor):
    # Include existing human, bot and service credentials. This runs once even
    # when public mode is enabled later; reverting cannot safely identify which
    # expiration dates predated the migration.
    apps.get_model("db", "APIToken").objects.using(schema_editor.connection.alias).filter(
        is_active=True,
        expired_at__isnull=True,
    ).update(expired_at=timezone.now() + timedelta(days=30))


class Migration(migrations.Migration):
    dependencies = [("lab", "0013_trusted_browsers")]
    operations = [migrations.RunPython(expire_permanent_tokens, migrations.RunPython.noop)]
