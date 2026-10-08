# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import tempfile
from pathlib import Path
import unittest

import prepare


class TestPreparation(unittest.TestCase):
    def test_copies_are_rebased_and_credentials_are_separate_from_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            root.mkdir()
            (root / ".env").write_text('LAB_PUBLIC_URL="http://192.168.137.90:8080"\nPOSTGRES_PASSWORD="source-password"\n')
            for relative in prepare.ARTIFACTS.values():
                path = root / relative
                path.mkdir(parents=True)
                (path / "entry.js").write_text('const url="http://192.168.137.90:8080/live"; const old="http://localhost:8080";')
            target = Path(temporary) / "isolated"
            prepare.prepare(target, root=root)
            self.assertIn("source-password", (root / ".env").read_text())
            self.assertNotIn("source-password", (target / "api.env").read_text())
            for name, relative in prepare.ARTIFACTS.items():
                self.assertIn("http://localhost:8081/live", (target / name / "entry.js").read_text())
                self.assertNotIn("192.168.137.90", (target / name / "entry.js").read_text())
                self.assertIn("192.168.137.90", (root / relative / "entry.js").read_text())
            self.assertEqual((target / "api.env").stat().st_mode & 0o777, 0o600)
            self.assertEqual((target / "lab-totp.key").stat().st_mode & 0o777, 0o600)

    def test_preparation_rejects_repository_targets_and_incomplete_builds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            root.mkdir()
            with self.assertRaises(ValueError):
                prepare.prepare(root / ".temp/e2e", root=root)
            with self.assertRaises(ValueError):
                prepare.prepare(Path(temporary) / "target", root=root)


if __name__ == "__main__":
    unittest.main()
