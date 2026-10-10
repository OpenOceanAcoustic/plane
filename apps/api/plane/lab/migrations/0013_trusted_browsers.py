# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def clear_legacy_login_identities(apps, schema_editor):
    # Existing users already use this identity digest. Keep their live quotas,
    # including inactive users; remove only arbitrary usernames and deleted users.
    alias = schema_editor.connection.alias
    user_app, user_model = settings.AUTH_USER_MODEL.split(".")
    users = apps.get_model(user_app, user_model).objects.using(alias)
    known = {
        hashlib.sha256(("user:" + str(user_id)).encode()).hexdigest()
        for user_id in users.values_list("id", flat=True).iterator(chunk_size=1000)
    }
    accounts = apps.get_model("lab", "LoginAccount").objects.using(alias)
    stale = []
    for account_id, identity_hash in accounts.values_list("id", "identity_hash").iterator(chunk_size=1000):
        if identity_hash not in known:
            stale.append(account_id)
            if len(stale) == 1000:
                accounts.filter(id__in=stale).delete()
                stale.clear()
    if stale:
        accounts.filter(id__in=stale).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("lab", "0012_started_bounty_upgrade_guard"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TrustedBrowser",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("purpose", models.CharField(choices=[("user", "user"), ("admin", "admin")], max_length=8)),
                ("generation", models.UUIDField()),
                ("name", models.CharField(default="浏览器", max_length=120)),
                ("expires_at", models.DateTimeField()),
                ("revoked_at", models.DateTimeField(null=True)),
                ("last_used_at", models.DateTimeField()),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [models.Index(fields=["user", "purpose", "expires_at"], name="lab_browser_user_expiry_idx")]
            },
        ),
        migrations.AddField(
            model_name="loginattempt",
            name="browser",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to="lab.trustedbrowser"),
        ),
        migrations.AddField(
            model_name="loginattempt",
            name="session_hash",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.RunPython(clear_legacy_login_identities, migrations.RunPython.noop),
    ]
