# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Check startup command routing without touching running Docker services."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class RuntimeMountTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        scripts = self.root / "tools/lab"
        scripts.mkdir(parents=True)
        original = Path(__file__).resolve().parent / "lab.sh"
        shutil.copy2(original, scripts / "lab.sh")
        binary = self.root / "bin"
        binary.mkdir()
        docker = binary / "docker"
        docker.write_text("#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n")
        docker.chmod(0o755)
        self.environment = {
            **os.environ,
            "PATH": f"{binary}:{os.environ['PATH']}",
            "LAB_COMPOSE_PROJECT": "ooa-plane-lab",
        }

    def run_command(self, command):
        result = subprocess.run(
            ["bash", str(self.root / "tools/lab/lab.sh"), command],
            env=self.environment,
            capture_output=True,
            text=True,
            check=True,
        )
        return [json.loads(line) for line in result.stdout.splitlines()]

    def install_runtime_override(self):
        directory = self.root / ".temp/lab-runtime"
        directory.mkdir(parents=True)
        (directory / "compose.proxy.yml").write_text("services: {}\n")

    def test_default_stack_keeps_its_existing_compose_file(self):
        self.assertEqual(
            self.run_command("status"),
            [["compose", "-p", "ooa-plane-lab", "-f", "compose.lab.yml", "ps"]],
        )

    def test_status_uses_the_saved_runtime_mounts(self):
        self.install_runtime_override()
        command = self.run_command("status")[0]
        self.assertEqual(
            command,
            [
                "compose",
                "-p",
                "ooa-plane-lab",
                "-f",
                "compose.lab.yml",
                "-f",
                ".temp/lab-runtime/compose.proxy.yml",
                "ps",
            ],
        )

    def test_both_start_calls_preserve_runtime_mounts(self):
        self.install_runtime_override()
        commands = self.run_command("start")
        self.assertEqual(len(commands), 2)
        for command in commands:
            self.assertIn(".temp/lab-runtime/compose.proxy.yml", command)
        self.assertIn("--force-recreate", commands[1])

    def test_isolated_test_stack_does_not_use_production_assets(self):
        self.install_runtime_override()
        self.environment["LAB_COMPOSE_PROJECT"] = "ooa-plane-e2e"
        self.assertNotIn(".temp/lab-runtime/compose.proxy.yml", self.run_command("status")[0])
        for command in self.run_command("start"):
            self.assertNotIn(".temp/lab-runtime/compose.proxy.yml", command)


if __name__ == "__main__":
    unittest.main()
