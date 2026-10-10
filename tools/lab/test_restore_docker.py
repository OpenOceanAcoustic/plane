# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Opt-in recovery rehearsal using new containers and volumes, never the lab stack."""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get("RUN_DOCKER_RESTORE_TEST") == "1", "explicit Docker recovery rehearsal required")
class RecoveryRehearsalTests(unittest.TestCase):
    def test_original_images_restore_an_encrypted_credential_and_real_minio_object(self):
        def run(args, **kwargs):
            return subprocess.run(args, check=True, capture_output=True, **kwargs)

        image = os.environ.get("RESTORE_TEST_API_IMAGE", "ooa-plane-api:lab")
        api_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True).stdout.strip()
        db_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", "postgres:15.7-alpine"], text=True).stdout.strip()
        project = "ooa-restore-fixture-" + uuid.uuid4().hex[:10]
        names = [project + "-db", project + "-minio"]
        volume = project + "-uploads"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / "fixture.totp.key"
            key.write_bytes(base64.urlsafe_b64encode(secrets.token_bytes(32)) + b"\n")
            key.chmod(0o600)
            env = root / "fixture.env"
            password = secrets.token_urlsafe(24)
            settings = {
                "POSTGRES_USER": "restore", "POSTGRES_DB": "restore", "POSTGRES_PASSWORD": password,
                "DATABASE_URL": f"postgresql://restore:{password}@database:5432/restore",
                "DJANGO_SETTINGS_MODULE": "plane.settings.production", "LAB_AUTH_ENABLED": "1",
                "LAB_TOTP_KEY_FILE": "/run/secrets/lab_totp_key", "SECRET_KEY": secrets.token_urlsafe(50),
                "PUBLIC_DEPLOYMENT": "0", "REDIS_URL": "redis://127.0.0.1:6379/", "AMQP_URL": "memory://",
                "AWS_S3_ENDPOINT_URL": "http://plane-minio:9000", "AWS_ACCESS_KEY_ID": "restore-fixture",
                "AWS_SECRET_ACCESS_KEY": secrets.token_urlsafe(24), "AWS_S3_BUCKET_NAME": "uploads",
                "MINIO_ROOT_USER": "restore-fixture", "WEB_URL": "http://localhost", "USE_MINIO": "1",
            }
            settings["MINIO_ROOT_PASSWORD"] = settings["AWS_SECRET_ACCESS_KEY"]
            env.write_text("".join(f"{name}={value}\n" for name, value in settings.items()))
            env.chmod(0o600)
            run(["docker", "network", "create", "--internal", project])
            run(["docker", "volume", "create", volume])
            try:
                run(["docker", "run", "-d", "--name", names[0], "--network", project, "--network-alias", "database", "--env-file", str(env), db_id])
                run(["docker", "run", "-d", "--name", names[1], "--network", project, "--network-alias", "plane-minio", "--env-file", str(env), "-v", volume + ":/export", "ooa-plane-minio:source", "server", "/export"])
                for _ in range(60):
                    ready = subprocess.run(["docker", "exec", names[0], "pg_isready", "-U", "restore", "-d", "restore"], capture_output=True)
                    if ready.returncode == 0:
                        break
                    time.sleep(0.5)
                else:
                    self.fail("isolated database did not become ready")
                api = ["docker", "run", "--rm", "--user", "0:0", "--network", project, "--env-file", str(env), "-v", f"{key}:/run/secrets/lab_totp_key:ro", api_id, "python", "manage.py"]
                run(api + ["migrate", "--noinput"])
                seed = (
                    "from plane.db.models import User; from plane.lab.models import Credential; "
                    "from cryptography.fernet import Fernet; from django.conf import settings; "
                    "user=User.objects.create(username='isolated-restore',email='restore@example.invalid'); "
                    "Credential.objects.create(user=user,encrypted_secret=Fernet(settings.LAB_TOTP_KEY.encode()).encrypt(b'JBSWY3DPEHPK3PXP').decode()); "
                    "import boto3,os; client=boto3.client('s3',endpoint_url=os.environ['AWS_S3_ENDPOINT_URL'],"
                    "aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY']); "
                    "client.create_bucket(Bucket='uploads'); client.put_object(Bucket='uploads',Key='restore-fixture.txt',Body=b'recovery rehearsal')"
                )
                run(api + ["shell", "-c", seed])
                run(["docker", "stop", names[1]])
                backup_dir = root / "backup"
                backup_dir.mkdir(mode=0o700)
                dump = run(["docker", "exec", names[0], "pg_dump", "-U", "restore", "-d", "restore", "-Fc"]).stdout
                (backup_dir / "database.dump").write_bytes(dump)
                archive = run(["docker", "run", "--rm", "--network", "none", "-v", volume + ":/source:ro", "alpine:3.20", "tar", "-czf", "-", "-C", "/source", "."]).stdout
                (backup_dir / "attachments.tar.gz").write_bytes(archive)
                (backup_dir / "api.env").write_bytes(env.read_bytes())
                manifest = {
                    "images": {"api": api_id, "plane-db": db_id},
                    "counts": {"users": 1, "issues": 0, "credentials": 1, "ledger": 0},
                    "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in backup_dir.iterdir()},
                    "key_sha256": hashlib.sha256(key.read_bytes()).hexdigest(),
                }
                (backup_dir / "manifest.json").write_text(json.dumps(manifest))
                verify = ["python3", str(ROOT / "tools/lab/backup.py"), "restore-verify", str(backup_dir), str(key)]
                upgrade = os.environ.get("RESTORE_TEST_UPGRADE_IMAGE")
                if upgrade:
                    verify.extend(["--upgrade-image", upgrade])
                verified = run(verify, text=True)
                self.assertIn("隔离恢复验证通过", verified.stdout)
                self.assertIn("Restored encrypted credentials verified: 1", verified.stdout)
            finally:
                subprocess.run(["docker", "rm", "-fv", *names], capture_output=True)
                subprocess.run(["docker", "volume", "rm", volume], capture_output=True)
                subprocess.run(["docker", "network", "rm", project], capture_output=True)


if __name__ == "__main__":
    unittest.main()
