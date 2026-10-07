#!/usr/bin/env python3
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Quiesced backup and isolated restore verification. Never restores over a live volume."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.lab.yml")]
WRITERS = ["api", "worker", "beat-worker", "live"]


def run(args, **options):
    return subprocess.run(args, check=True, cwd=ROOT, **options)


def config():
    return json.loads(
        run(
            COMPOSE + ["config", "--format", "json"], capture_output=True, text=True
        ).stdout
    )


def checksum(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def backup(directory, key_directory):
    directory.mkdir(parents=True, exist_ok=False)
    key_directory.mkdir(parents=True, exist_ok=True)
    configuration = config()
    project = configuration["name"]
    volume = configuration["volumes"]["uploads"]["name"]
    key_path = key_directory / (directory.name + ".totp.key")
    if key_path.exists():
        raise SystemExit("拒绝覆盖已有密钥备份")
    run(["docker", "pull", "alpine:3.20"])
    running = set(
        run(
            COMPOSE + ["ps", "--status", "running", "--services"],
            capture_output=True,
            text=True,
        ).stdout.split()
    )
    paused = [service for service in (*WRITERS, "plane-minio") if service in running]
    if paused:
        run(COMPOSE + ["stop", *paused])
    try:
        with (directory / "database.dump").open("wb") as output:
            run(
                COMPOSE
                + [
                    "exec",
                    "-T",
                    "plane-db",
                    "sh",
                    "-c",
                    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
                ],
                stdout=output,
            )
        run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{volume}:/source:ro",
                "-v",
                f"{directory}:/backup",
                "alpine:3.20",
                "tar",
                "-czf",
                "/backup/attachments.tar.gz",
                "-C",
                "/source",
                ".",
            ]
        )
        shutil.copy2(ROOT / ".env", directory / "root.env")
        shutil.copy2(ROOT / "apps/api/.env", directory / "api.env")
        shutil.copy2(ROOT / "apps/live/.env", directory / "live.env")
        shutil.copy2(ROOT / ".secrets/lab-totp.key", key_path)
        counts = run(
            COMPOSE
            + [
                "exec",
                "-T",
                "plane-db",
                "sh",
                "-c",
                "psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -Atc \"SELECT json_build_object('users',(SELECT count(*) FROM users),'issues',(SELECT count(*) FROM issues),'credentials',(SELECT count(*) FROM lab_credential),'ledger',(SELECT count(*) FROM lab_ledger));\"",
            ],
            capture_output=True,
            text=True,
        ).stdout.strip()
        files = {
            name: checksum(directory / name)
            for name in (
                "database.dump",
                "attachments.tar.gz",
                "root.env",
                "api.env",
                "live.env",
            )
        }
        (directory / "manifest.json").write_text(
            json.dumps(
                {
                    "project": project,
                    "counts": json.loads(counts),
                    "files": files,
                    "key_sha256": checksum(key_path),
                },
                indent=2,
            )
            + "\n"
        )
        for path in directory.iterdir():
            path.chmod(0o600)
        directory.chmod(0o700)
        key_path.chmod(0o600)
        print(f"备份已保存：{directory}；认证密钥单独保存：{key_path}")
    finally:
        if paused:
            run(COMPOSE + ["start", *paused])


def restore_verify(directory, key_path):
    manifest = json.loads((directory / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        if checksum(directory / name) != expected:
            raise SystemExit("备份校验失败：" + name)
    if checksum(key_path) != manifest["key_sha256"]:
        raise SystemExit("认证密钥与备份不匹配")
    project = "ooa-restore-" + uuid.uuid4().hex[:12]
    password = uuid.uuid4().hex
    compose_path = directory / "restore.compose.json"
    compose_path.write_text(
        json.dumps(
            {
                "name": project,
                "services": {
                    "database": {
                        "image": "postgres:15.7-alpine",
                        "environment": {
                            "POSTGRES_USER": "restore",
                            "POSTGRES_DB": "restore",
                            "POSTGRES_PASSWORD": password,
                        },
                        "volumes": ["db:/var/lib/postgresql/data"],
                        "healthcheck": {
                            "test": [
                                "CMD",
                                "pg_isready",
                                "-U",
                                "restore",
                                "-d",
                                "restore",
                            ],
                            "interval": "2s",
                            "timeout": "2s",
                            "retries": 30,
                        },
                    }
                },
                "volumes": {"db": {}, "attachments": {}},
            }
        )
    )
    compose_path.chmod(0o600)
    restore = ["docker", "compose", "-f", str(compose_path)]
    try:
        run(restore + ["up", "-d", "--wait", "database"])
        with (directory / "database.dump").open("rb") as input_file:
            run(
                restore
                + [
                    "exec",
                    "-T",
                    "database",
                    "pg_restore",
                    "-U",
                    "restore",
                    "-d",
                    "restore",
                    "--no-owner",
                    "--no-acl",
                ],
                stdin=input_file,
            )
        raw = run(
            restore
            + [
                "exec",
                "-T",
                "database",
                "psql",
                "-U",
                "restore",
                "-d",
                "restore",
                "-Atc",
                "SELECT json_build_object('users',(SELECT count(*) FROM users),'issues',(SELECT count(*) FROM issues),'credentials',(SELECT count(*) FROM lab_credential),'ledger',(SELECT count(*) FROM lab_ledger));",
            ],
            capture_output=True,
            text=True,
        ).stdout.strip()
        if json.loads(raw) != manifest["counts"]:
            raise SystemExit("数据库记录数与备份不一致")
        run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{project}_attachments:/restore",
                "-v",
                f"{directory}:/backup:ro",
                "alpine:3.20",
                "tar",
                "-xzf",
                "/backup/attachments.tar.gz",
                "-C",
                "/restore",
            ]
        )
        run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{project}_attachments:/restored:ro",
                "-v",
                f"{directory}:/backup:ro",
                "-v",
                f"{ROOT / 'tools/lab/verify_attachments.py'}:/verify.py:ro",
                "ooa-plane-api:lab",
                "python",
                "/verify.py",
            ]
        )
        verify_code = "from cryptography.fernet import Fernet; from plane.lab.models import Credential; from django.conf import settings; key=Fernet(settings.LAB_TOTP_KEY.encode()); rows=list(Credential.objects.all()); [key.decrypt(row.encrypted_secret.encode()) for row in rows]; print('Restored encrypted credentials verified:', len(rows))"
        run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                project + "_default",
                "--env-file",
                str(directory / "api.env"),
                "-e",
                f"DATABASE_URL=postgresql://restore:{password}@database:5432/restore",
                "-e",
                "LAB_TOTP_KEY_FILE=/run/secrets/lab_totp_key",
                "-v",
                f"{key_path}:/run/secrets/lab_totp_key:ro",
                "ooa-plane-api:lab",
                "python",
                "manage.py",
                "shell",
                "-c",
                verify_code,
            ]
        )
        print("隔离恢复验证通过：数据库、附件归档、加密凭据；未覆盖运行中的数据。")
    finally:
        run(restore + ["down", "-v"])
        # Attachments volume is created by docker run rather than compose up.
        subprocess.run(
            ["docker", "volume", "rm", f"{project}_attachments"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        compose_path.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["backup", "restore-verify"])
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "key_location",
        type=Path,
        help="Separate key-backup directory, or the matching key file for verification",
    )
    args = parser.parse_args()
    directory = args.directory.resolve()
    key = args.key_location.resolve()
    if args.action == "backup":
        backup(directory, key)
    else:
        restore_verify(directory, key)


if __name__ == "__main__":
    main()
