# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from pathlib import Path
import unittest

import backup


class IsolatedRestoreTests(unittest.TestCase):
    def test_maintenance_does_not_use_saved_production_endpoints(self):
        saved = {
            "DATABASE_URL": "postgresql://formal.example/formal",
            "REDIS_URL": "redis://formal.example:6379",
            "RABBITMQ_HOST": "formal.example",
            "AMQP_URL": "amqp://formal.example",
            "AWS_S3_ENDPOINT_URL": "https://formal.example",
            "WEB_URL": "https://formal.example",
            "LAB_AUTH_ENABLED": "1",
            "SECRET_KEY": "saved-key",
        }
        result = backup.restore_environment(saved, "restore-password")
        self.assertEqual(result["DATABASE_URL"], "postgresql://restore:restore-password@database:5432/restore")
        self.assertEqual(result["REDIS_URL"], "redis://127.0.0.1:6379/0")
        self.assertEqual(result["AMQP_URL"], "memory://")
        self.assertEqual(result["RABBITMQ_HOST"], "127.0.0.1")
        self.assertEqual(result["AWS_S3_ENDPOINT_URL"], "http://127.0.0.1:9000")
        self.assertEqual(result["SECRET_KEY"], "saved-key")
        self.assertEqual(result["LAB_AUTH_ENABLED"], "1")
        self.assertEqual(saved["WEB_URL"], "https://formal.example")

    def test_migration_and_credential_check_share_only_the_isolated_network_and_key(self):
        base = backup.restore_api_command("ooa-restore-test", Path("/private/env"), Path("/offline/key"))
        migration = base + ["migrate", "--noinput"]
        verification = base + ["shell", "-c", "verify"]
        self.assertIn("ooa-restore-test_default", migration)
        self.assertIn("/offline/key:/run/secrets/lab_totp_key:ro", migration)
        self.assertEqual(migration[:-2], verification[:-3])
        self.assertNotIn("ooa-plane-lab_default", migration)
        self.assertNotIn("-p", migration)
        self.assertNotIn("-e", migration)


if __name__ == "__main__":
    unittest.main()
