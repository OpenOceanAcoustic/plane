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
from setup import read_env

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = [
    "docker",
    "compose",
    "-p",
    os.environ.get("LAB_COMPOSE_PROJECT", "ooa-plane-lab"),
    "-f",
    str(ROOT / "compose.lab.yml"),
]
WRITERS = ["api", "worker", "beat-worker", "live"]


def compose_command(profile="lab"):
    if profile == "lab":
        return COMPOSE
    return ["docker", "compose", "--env-file", str(ROOT / ".env.public"), "-p",
            os.environ.get("PUBLIC_COMPOSE_PROJECT", "ooa-plane-public"), "-f", str(ROOT / "compose.public.yml")]


def run(args, **options):
    return subprocess.run(args, check=True, cwd=ROOT, **options)


def config(profile="lab"):
    return json.loads(
        run(
            compose_command(profile) + ["config", "--format", "json"], capture_output=True, text=True
        ).stdout
    )


def checksum(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def restore_environment(saved, password):
    """Route maintenance processes to the restored DB and local-only dependencies."""
    return {
        **saved,
        "DATABASE_URL": f"postgresql://restore:{password}@database:5432/restore",
        "POSTGRES_HOST": "database",
        "POSTGRES_USER": "restore",
        "POSTGRES_PASSWORD": password,
        "POSTGRES_DB": "restore",
        "REDIS_URL": "redis://127.0.0.1:6379/0",
        "REDIS_HOST": "127.0.0.1",
        "AMQP_URL": "memory://",
        "RABBITMQ_HOST": "127.0.0.1",
        "AWS_S3_ENDPOINT_URL": "http://127.0.0.1:9000",
        "MINIO_ENDPOINT_URL": "",
        "LAB_TOTP_KEY_FILE": "/run/secrets/lab_totp_key",
        "POSTHOG_API_KEY": "",
        "POSTHOG_HOST": "",
        "ANALYTICS_BASE_API": "",
        "ANALYTICS_SECRET_KEY": "",
        "WEB_URL": "http://127.0.0.1",
        "APP_BASE_URL": "http://127.0.0.1",
        "ADMIN_BASE_URL": "http://127.0.0.1",
        "SPACE_BASE_URL": "http://127.0.0.1",
        "LIVE_BASE_URL": "http://127.0.0.1",
        "PUBLIC_DEPLOYMENT": "0",
        "PUBLIC_ORIGIN": "",
        "ALLOWED_HOSTS": "localhost,127.0.0.1,database",
        "CORS_ALLOWED_ORIGINS": "http://localhost",
        "CSRF_TRUSTED_ORIGINS": "http://localhost",
        "SESSION_COOKIE_SECURE": "0",
        "CSRF_COOKIE_SECURE": "0",
        "SECURE_SSL_REDIRECT": "0",
        "SECURE_HSTS_SECONDS": "0",
        "LAB_SECURITY_LIMITS_ENABLED": "0",
        "MINIO_ENDPOINT_SSL": "0",
    }


def restore_api_command(project, docker_env, key_path, *, image="ooa-plane-api:lab"):
    return [
        "docker", "run", "--rm", "--user", "0:0", "--network", project + "_default",
        "--env-file", str(docker_env),
        "-v", f"{key_path}:/run/secrets/lab_totp_key:ro",
        image, "python", "manage.py",
    ]


def backup(directory, key_directory, *, resume=True, profile="lab"):
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    key_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    compose = compose_command(profile)
    configuration = config(profile)
    project = configuration["name"]
    volume = configuration["volumes"]["uploads"]["name"]
    key_path = key_directory / (directory.name + ".totp.key")
    if key_path.exists():
        raise SystemExit("拒绝覆盖已有密钥备份")
    images = {}
    for service in configuration["services"]:
        container = run(compose + ["ps", "-a", "-q", service], capture_output=True, text=True).stdout.strip()
        if not container:
            if service in ("api", "plane-db"):
                raise SystemExit(f"备份需要已部署的 {service} 服务以记录实际镜像版本")
            continue
        images[service] = run(["docker", "inspect", "--format", "{{.Image}}", container], capture_output=True, text=True).stdout.strip()
    image = subprocess.run(
        ["docker", "image", "inspect", "alpine:3.20"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if image.returncode:
        run(["docker", "pull", "alpine:3.20"])
    running = set(
        run(
            compose + ["ps", "--status", "running", "--services"],
            capture_output=True,
            text=True,
        ).stdout.split()
    )
    paused = [service for service in (*WRITERS, "plane-minio") if service in running]
    try:
        if paused:
            run(compose + ["stop", *paused])
        with (directory / "database.dump").open("wb") as output:
            run(
                compose
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
        # Root must read MinIO's private volume, while the host caller owns the
        # resulting archive and can secure it without sudo or a chown step.
        with (directory / "attachments.tar.gz").open("wb") as output:
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "-v",
                    f"{volume}:/source:ro",
                    "alpine:3.20",
                    "tar",
                    "-czf",
                    "-",
                    "-C",
                    "/source",
                    ".",
                ],
                stdout=output,
            )
        env_name = ".env.public" if profile == "public" else ".env"
        shutil.copy2(ROOT / env_name, directory / "root.env")
        shutil.copy2(ROOT / "apps/api" / env_name, directory / "api.env")
        shutil.copy2(ROOT / "apps/live" / env_name, directory / "live.env")
        shutil.copy2(Path(configuration["secrets"]["lab_totp_key"]["file"]), key_path)
        counts = run(
            compose
            + [
                "exec",
                "-T",
                "plane-db",
                "sh",
                "-c",
                'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT json_build_object('
                "'users',(SELECT count(*) FROM users),'issues',(SELECT count(*) FROM issues),"
                "'credentials',(SELECT count(*) FROM lab_credential),'ledger',(SELECT count(*) FROM lab_ledger));\"",
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
                    "profile": profile,
                    "images": images,
                    "volumes": {name: details["name"] for name, details in configuration["volumes"].items()},
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
        if paused and resume:
            run(compose + ["start", *paused])


def restore_verify(directory, key_path, *, upgrade_image=None):
    manifest = json.loads((directory / "manifest.json").read_text())
    images = manifest.get("images")
    if not images or not all(images.get(name, "").startswith("sha256:") for name in ("api", "plane-db")):
        raise SystemExit("备份缺少实际镜像 manifest；请使用本版本工具重新备份，不能猜测恢复镜像")
    for image in [*images.values(), *([upgrade_image] if upgrade_image else [])]:
        run(["docker", "image", "inspect", "--format", "{{.Id}}", image], capture_output=True, text=True)
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
                        "image": images["plane-db"],
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
                "networks": {"default": {"internal": True}},
            }
        )
    )
    compose_path.chmod(0o600)
    restore = ["docker", "compose", "-p", project, "-f", str(compose_path)]
    docker_env = directory / "restore.docker.env"
    # Compose removes quotes; docker run --env-file does not.
    docker_env.write_text(
        "".join(
            f"{name}={value}\n"
            for name, value in restore_environment(read_env(directory / "api.env"), password).items()
        )
    )
    docker_env.chmod(0o600)
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
                "SELECT json_build_object('users',(SELECT count(*) FROM users),"
                "'issues',(SELECT count(*) FROM issues),'credentials',(SELECT count(*) FROM lab_credential),"
                "'ledger',(SELECT count(*) FROM lab_ledger));",
            ],
            capture_output=True,
            text=True,
        ).stdout.strip()
        if json.loads(raw) != manifest["counts"]:
            raise SystemExit("数据库记录数与备份不一致")
        maintenance = restore_api_command(project, docker_env, key_path, image=images["api"])
        run(maintenance + ["check"])
        run(
            [
                "docker",
                "run",
                "--rm",
                "--network", "none",
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
                "--network", "none",
                "-v",
                f"{project}_attachments:/restored:ro",
                "-v",
                f"{directory}:/backup:ro",
                "-v",
                f"{ROOT / 'tools/lab/verify_attachments.py'}:/verify.py:ro",
                images["api"],
                "python",
                "/verify.py",
            ]
        )
        verify_code = (
            "from cryptography.fernet import Fernet; from plane.lab.models import Credential; "
            "from django.conf import settings; key=Fernet(settings.LAB_TOTP_KEY.encode()); "
            "rows=list(Credential.objects.all()); assert all(row.encrypted_secret or not row.enabled for row in rows); "
            "[key.decrypt(row.encrypted_secret.encode()) for row in rows if row.encrypted_secret]; "
            "print('Restored encrypted credentials verified:', len(rows))"
        )
        run(maintenance + ["shell", "-c", verify_code])
        if upgrade_image:
            upgraded = restore_api_command(project, docker_env, key_path, image=upgrade_image)
            run(upgraded + ["migrate", "--noinput"])
            run(upgraded + ["check"])
            run(upgraded + ["shell", "-c", verify_code])
        print("隔离恢复验证通过：数据库、增量迁移、附件归档、加密凭据；未覆盖运行中的数据。")
    finally:
        try:
            run(restore + ["down", "-v"])
        finally:
            docker_env.unlink(missing_ok=True)
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
    parser.add_argument("--profile", choices=["lab", "public"], default="lab")
    parser.add_argument("--upgrade-image", help="原镜像恢复验证通过后，在隔离副本上测试这个新 API 镜像的迁移")
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "key_location",
        type=Path,
        help="Separate key-backup directory, or the matching key file for verification",
    )
    parser.add_argument("--keep-stopped", action="store_true", help="备份后保持写入服务停止，用于紧接着执行升级")
    args = parser.parse_args()
    directory = args.directory.resolve()
    key = args.key_location.resolve()
    if args.action == "backup":
        backup(directory, key, resume=not args.keep_stopped, profile=args.profile)
    else:
        restore_verify(directory, key, upgrade_image=args.upgrade_image)


if __name__ == "__main__":
    main()
