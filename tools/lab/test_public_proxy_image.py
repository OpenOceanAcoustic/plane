# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Opt-in production proxy checks with no external network, ports or ACME requests."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid


@unittest.skipUnless(
    os.environ.get("RUN_DOCKER_PUBLIC_PROXY_IMAGE_TEST") == "1",
    "explicit production proxy image check required",
)
class PublicProxyImageStartupTests(unittest.TestCase):
    def test_non_root_readonly_proxy_validates_config_and_serves_both_apps_on_port_80(
        self,
    ):
        image = os.environ.get("PUBLIC_TEST_PROXY_IMAGE", "ooa-plane-proxy:security")
        common = [
            "docker",
            "run",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--sysctl",
            "net.ipv4.ip_unprivileged_port_start=0",
            "--pids-limit",
            "128",
            "--memory",
            "256m",
            "--cpus",
            "1",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=32m",
            "--tmpfs",
            "/data:rw,noexec,nosuid,mode=0750,size=16m,uid=10001,gid=10001",
            "--tmpfs",
            "/config:rw,noexec,nosuid,mode=0750,size=16m,uid=10001,gid=10001",
            "-e",
            "PUBLIC_HOST=dashboard.example.org",
            "-e",
            "PUBLIC_HSTS_SECONDS=300",
        ]
        adapted = subprocess.run(
            common
            + [
                "--rm",
                image,
                "caddy",
                "adapt",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        logs = json.loads(adapted.stdout)["logging"]["logs"]
        encoders = [log["encoder"] for log in logs.values() if "encoder" in log]
        self.assertEqual(len(encoders), 1)
        self.assertEqual(
            encoders[0]["fields"],
            {
                "request>uri": {"filter": "delete"},
                "request>headers": {"filter": "delete"},
                "resp_headers": {"filter": "delete"},
            },
        )
        subprocess.run(
            common
            + [
                "--rm",
                image,
                "caddy",
                "validate",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ],
            check=True,
            capture_output=True,
        )
        name = "ooa-public-proxy-image-test-" + uuid.uuid4().hex[:10]
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "probe.Caddyfile"
            config.write_text("""{
 admin off
 auto_https off
}
:80 {
 handle_path /god-mode/* {
  root * /srv/admin
  try_files {path} /index.html
  file_server
 }
 handle {
  root * /srv/web
  try_files {path} /index.html
  file_server
 }
}
""")
            config.chmod(0o644)
            subprocess.run(
                common
                + [
                    "--rm",
                    "-d",
                    "--name",
                    name,
                    "-v",
                    f"{config}:/etc/caddy/probe.Caddyfile:ro",
                    image,
                    "caddy",
                    "run",
                    "--config",
                    "/etc/caddy/probe.Caddyfile",
                    "--adapter",
                    "caddyfile",
                ],
                check=True,
                capture_output=True,
            )
            try:
                for _ in range(40):
                    web = subprocess.run(
                        [
                            "docker",
                            "exec",
                            name,
                            "wget",
                            "-q",
                            "-S",
                            "-T",
                            "2",
                            "-O",
                            "-",
                            "http://127.0.0.1/",
                        ],
                        capture_output=True,
                    )
                    if web.returncode == 0:
                        break
                    time.sleep(0.5)
                else:
                    self.fail("production proxy image failed to serve the main page")
                admin = subprocess.run(
                    [
                        "docker",
                        "exec",
                        name,
                        "wget",
                        "-q",
                        "-S",
                        "-T",
                        "2",
                        "-O",
                        "-",
                        "http://127.0.0.1/god-mode/",
                    ],
                    check=True,
                    capture_output=True,
                )
                for result in (web, admin):
                    self.assertIn(b"200 OK", result.stderr)
                    self.assertIn(b"<html", result.stdout)
                    self.assertIn(b"<script", result.stdout)
                self.assertNotEqual(web.stdout, admin.stdout)
                uid = subprocess.run(
                    ["docker", "exec", name, "id", "-u"],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(uid.stdout.strip(), "10001")
                runtime = subprocess.run(
                    ["docker", "inspect", "--format", "{{json .HostConfig}}", name],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                host = json.loads(runtime.stdout)
                self.assertTrue(host["ReadonlyRootfs"])
                self.assertEqual(host["NetworkMode"], "none")
                self.assertFalse(host["PortBindings"])
                self.assertEqual(host["CapDrop"], ["ALL"])
                self.assertIn("no-new-privileges", host["SecurityOpt"])
            finally:
                subprocess.run(["docker", "rm", "-fv", name], capture_output=True)


if __name__ == "__main__":
    unittest.main()
