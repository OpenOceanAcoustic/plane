# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import contextlib
import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import setup


class AccessConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        patcher = patch.object(setup, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(os.umask, os.umask(0o077))

    def configure(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            setup.main(list(args))

    def snapshot(self):
        return {
            str(path.relative_to(self.root)): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in self.root.rglob("*")
            if path.is_file()
        }

    def test_lan_origin_changes_links_and_cors_without_rotating_credentials(self):
        self.configure()
        before = setup.read_env(self.root / ".env")
        key = self.snapshot()[".secrets/lab-totp.key"]
        django_key = setup.read_env(self.root / "apps/api/.env")["SECRET_KEY"]
        origin = "http://192.168.137.90:8080"
        self.configure("--public-url", origin + "/")
        root = setup.read_env(self.root / ".env")
        api = setup.read_env(self.root / "apps/api/.env")
        self.assertEqual(root["LAB_BIND_ADDRESS"], "0.0.0.0")
        self.assertEqual(root["LAB_PUBLIC_URL"], origin)
        self.assertEqual(api["WEB_URL"], origin)
        self.assertIn(origin, api["CORS_ALLOWED_ORIGINS"].split(","))
        self.assertTrue(
            all(
                root[name] == value
                for name, value in before.items()
                if not name.startswith("LAB_")
            )
        )
        self.assertTrue(api["SECRET_KEY"] == django_key)
        self.assertEqual(self.snapshot()[".secrets/lab-totp.key"], key)
        for app in ("web", "admin", "space"):
            frontend = setup.read_env(self.root / f"apps/{app}/.env")
            self.assertEqual(frontend["VITE_WEB_BASE_URL"], origin)
            self.assertEqual(frontend["VITE_API_BASE_URL"], "")
        self.assertEqual(
            setup.read_env(self.root / "apps/live/.env")["WEB_BASE_URL"], origin
        )
        configured = self.snapshot()
        self.configure()
        self.assertEqual(self.snapshot(), configured)

    def test_invalid_origins_do_not_mutate_existing_configuration(self):
        self.configure()
        before = self.snapshot()
        for value in (
            "http://0.0.0.0:8080",
            "http://[::]:8080",
            "http://user:password@192.168.137.90:8080",
            "http://192.168.137.90:8080/lab/register",
            "http://192.168.137.90:8080/#token",
            "http://192.168.137.90:99999",
        ):
            with self.subTest(value=value):
                with (
                    contextlib.redirect_stderr(io.StringIO()),
                    self.assertRaises(SystemExit),
                ):
                    self.configure("--public-url", value)
                self.assertEqual(self.snapshot(), before)

    def test_explicit_local_origin_restores_loopback_binding(self):
        self.configure("--public-url", "http://192.168.137.90:8080")
        self.configure("--public-url", "http://localhost:8080")
        root = setup.read_env(self.root / ".env")
        self.assertEqual(root["LAB_BIND_ADDRESS"], "127.0.0.1")
        self.assertEqual(root["LAB_PUBLIC_URL"], "http://localhost:8080")


if __name__ == "__main__":
    unittest.main()
