# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("lab", "0002_wip_and_ledger_guards")]
    operations = [
        migrations.RunSQL(
            "CREATE UNIQUE INDEX lab_username_case_insensitive ON users (LOWER(username));",
            "DROP INDEX lab_username_case_insensitive;",
        )
    ]
