# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Opt-in startup check for a built production API image, without application data."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

import setup


@unittest.skipUnless(os.environ.get("RUN_DOCKER_PUBLIC_IMAGE_TEST") == "1", "explicit production image check required")
class PublicImageStartupTests(unittest.TestCase):
    def test_non_root_readonly_image_starts_and_validates_host_and_proxy_scheme(self):
        image = os.environ.get("PUBLIC_TEST_API_IMAGE", "ooa-plane-api:security-cached-test")
        name = "ooa-public-image-test-" + uuid.uuid4().hex[:10]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(setup, "ROOT", root), contextlib.redirect_stdout(io.StringIO()):
                setup.main(["--profile", "public", "--public-url", "https://dashboard.example.org"])
            raw = root / "docker.env"
            raw.write_text("".join(f"{key}={value}\n" for key, value in setup.read_env(root / "apps/api/.env.public").items()))
            raw.chmod(0o600)
            uid = str(os.getuid() or 10001)
            subprocess.run(["docker", "run", "-d", "--name", name, "--network", "none", "--user", f"{uid}:{uid}", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--tmpfs", f"/code/plane/logs:rw,noexec,nosuid,mode=0750,size=16m,uid={uid},gid={uid}", "--env-file", str(raw), "-v", f"{root / '.secrets/public-totp.key'}:/run/secrets/lab_totp_key:ro", image], check=True, capture_output=True)
            try:
                probe = (
                    "import http.client,json; "
                    "c=http.client.HTTPConnection('127.0.0.1',8000,timeout=2); "
                    "c.request('GET','/',headers={'Host':'dashboard.example.org','X-Forwarded-Proto':'https'}); "
                    "r=c.getresponse(); first=[r.status,r.getheader('Location')]; c.close(); "
                    "c=http.client.HTTPConnection('127.0.0.1',8000,timeout=2); "
                    "c.request('GET','/',headers={'Host':'attacker.example.org'}); r=c.getresponse(); "
                    "print(json.dumps({'expected_host':first,'unrelated_host':r.status}))"
                )
                for _ in range(30):
                    response = subprocess.run(["docker", "exec", name, "python", "-c", probe], capture_output=True, text=True)
                    if response.returncode == 0:
                        break
                    time.sleep(0.5)
                else:
                    self.fail("production API image failed to start or respond")
                data = json.loads(response.stdout)
                self.assertEqual(data["expected_host"], [301, "https://dashboard.example.org/"])
                self.assertEqual(data["unrelated_host"], 400)
            finally:
                subprocess.run(["docker", "rm", "-fv", name], capture_output=True)


if __name__ == "__main__":
    unittest.main()
