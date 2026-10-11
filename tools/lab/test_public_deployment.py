# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Check the rendered deployment interface without starting containers."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PublicDeploymentTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("RUN_DOCKER_CADDY_TEST") == "1", "explicit cached Caddy configuration check required")
    def test_adapted_access_logs_omit_bearer_urls_and_all_credential_headers(self):
        result = subprocess.run([
            "docker", "run", "--rm", "--pull", "never", "--network", "none",
            "-e", "PUBLIC_HOST=dashboard.example.org", "-e", "PUBLIC_HSTS_SECONDS=300",
            "-v", f"{ROOT / 'tools/lab/Caddyfile.public'}:/etc/caddy/Caddyfile:ro",
            "caddy:2.10.2-alpine", "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile",
        ], text=True, capture_output=True, check=True)
        logs = json.loads(result.stdout)["logging"]["logs"]
        encoders = [log["encoder"] for log in logs.values() if "encoder" in log]
        self.assertEqual(len(encoders), 2)
        for encoder in encoders:
            self.assertEqual(encoder["fields"], {
            "request>uri": {"filter": "delete"},
            "request>headers": {"filter": "delete"},
            "resp_headers": {"filter": "delete"},
        })

    def test_only_https_entrypoint_publishes_ports_and_apps_have_no_host_source_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copy(ROOT / "compose.public.yml", root)
            for app in ("api", "live"):
                target = root / f"apps/{app}/.env.public"
                target.parent.mkdir(parents=True)
                target.write_text("PUBLIC_DEPLOYMENT=1\nPUBLIC_ORIGIN=https://dashboard.example.org\n")
            (root / ".secrets").mkdir()
            (root / ".secrets/public-totp.key").write_text("test-only\n")
            fixture = root / ".env.public"
            fixture.write_text("PUBLIC_ORIGIN=https://dashboard.example.org\nPUBLIC_HOST=dashboard.example.org\nPOSTGRES_USER=plane\nPOSTGRES_DB=plane\nPOSTGRES_PASSWORD=test-only\nRABBITMQ_USER=plane\nRABBITMQ_PASSWORD=test-only\nRABBITMQ_VHOST=plane\nAWS_ACCESS_KEY_ID=test-only\nAWS_SECRET_ACCESS_KEY=test-only\n")
            result = subprocess.run(["docker", "compose", "--env-file", str(fixture), "-f", "compose.public.yml", "config", "--format", "json"], cwd=root, text=True, capture_output=True, check=True)
            config = json.loads(result.stdout)
            for name, service in config["services"].items():
                if name == "proxy":
                    self.assertEqual({port["published"] for port in service["ports"]}, {"80", "443"})
                else:
                    self.assertFalse(service.get("ports"), name)
                self.assertFalse(any(mount["type"] == "bind" for mount in service.get("volumes", [])), name)
            self.assertTrue(config["networks"]["backend"]["internal"])
            self.assertEqual(config["services"]["proxy"]["networks"]["backend"]["aliases"], ["dashboard.example.org"])
            self.assertNotIn("live", config["services"]["proxy"].get("depends_on", {}))


if __name__ == "__main__":
    unittest.main()
