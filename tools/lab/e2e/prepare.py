#!/usr/bin/env python3
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Copy built artifacts and generate private test configuration, never touching live files."""

import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("lab_setup", ROOT / "tools/lab/setup.py")
_setup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_setup)
PUBLIC_URL = "http://localhost:8081"
ARTIFACTS = {
    "web-client": "apps/web/build/client",
    "admin-client": "apps/admin/build/client",
    "space-build": "apps/space/build",
    "live-dist": "apps/live/dist",
}
TEXT_EXTENSIONS = {".js", ".mjs", ".cjs", ".html", ".json", ".css", ".map", ".svg", ".txt"}


def public_origins(root):
    origins = {"http://localhost:8080", "http://127.0.0.1:8080", "http://192.168.137.90:8080"}
    names = {"LAB_PUBLIC_URL", "WEB_URL", "APP_BASE_URL", "ADMIN_BASE_URL", "SPACE_BASE_URL", "LIVE_BASE_URL",
             "VITE_API_BASE_URL", "VITE_WEB_BASE_URL", "VITE_ADMIN_BASE_URL", "VITE_SPACE_BASE_URL", "VITE_LIVE_BASE_URL"}
    for relative in (".env", "apps/api/.env", "apps/web/.env", "apps/admin/.env", "apps/space/.env"):
        values = _setup.read_env(root / relative)
        origins.update(value.rstrip("/") for name, value in values.items()
                       if name in names and value.startswith(("http://", "https://")) and value.rstrip("/") != PUBLIC_URL)
    return sorted(origins, key=len, reverse=True)


def copy_artifact(source, target, origins):
    shutil.copytree(source, target)
    for path in target.rglob("*"):
        if path.is_file() and path.suffix in TEXT_EXTENSIONS:
            data = path.read_bytes()
            original = data
            for origin in origins:
                data = data.replace(origin.encode(), PUBLIC_URL.encode())
                data = data.replace(origin.replace("/", "\\/").encode(), PUBLIC_URL.replace("/", "\\/").encode())
            if data != original:
                path.write_bytes(data)
            if any(origin.encode() in data or origin.replace("/", "\\/").encode() in data for origin in origins):
                raise RuntimeError("Test artifact retained a configured production origin")


def prepare(directory, root=ROOT):
    directory = directory.resolve()
    if directory == root or root in directory.parents:
        raise ValueError("E2E artifacts and secrets must be outside the repository")
    for relative in ARTIFACTS.values():
        if not (root / relative).is_dir():
            raise ValueError("Build all four applications before preparing isolated E2E artifacts")
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    origins = public_origins(root)
    for name, relative in ARTIFACTS.items():
        copy_artifact(root / relative, directory / name, origins)
    values = {
        "POSTGRES_USER": "plane", "POSTGRES_DB": "plane", "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
        "RABBITMQ_USER": "plane", "RABBITMQ_PASSWORD": secrets.token_urlsafe(32), "RABBITMQ_VHOST": "plane",
        "AWS_ACCESS_KEY_ID": "ooa-e2e", "AWS_SECRET_ACCESS_KEY": secrets.token_urlsafe(32), "AWS_S3_BUCKET_NAME": "uploads",
        "LIVE_SERVER_SECRET_KEY": secrets.token_urlsafe(32), "LAB_BIND_ADDRESS": "127.0.0.1",
        "LAB_PUBLIC_URL": PUBLIC_URL, "LAB_E2E_DIRECTORY": str(directory),
    }
    _setup.write_env(directory / "root.env", values)
    api = {
        **values,
        "SECRET_KEY": secrets.token_urlsafe(50), "DEBUG": "0", "DJANGO_SETTINGS_MODULE": "plane.settings.production",
        "DATABASE_URL": f"postgresql://plane:{values['POSTGRES_PASSWORD']}@plane-db:5432/plane",
        "POSTGRES_HOST": "plane-db", "POSTGRES_PORT": "5432", "REDIS_HOST": "plane-redis", "REDIS_URL": "redis://plane-redis:6379/",
        "RABBITMQ_HOST": "plane-mq", "RABBITMQ_PORT": "5672", "AWS_S3_ENDPOINT_URL": "http://plane-minio:9000", "USE_MINIO": "1",
        "WEB_URL": PUBLIC_URL, "APP_BASE_URL": PUBLIC_URL, "ADMIN_BASE_URL": PUBLIC_URL, "ADMIN_BASE_PATH": "/god-mode",
        "SPACE_BASE_URL": PUBLIC_URL, "SPACE_BASE_PATH": "/spaces", "LIVE_BASE_URL": PUBLIC_URL, "LIVE_BASE_PATH": "/live",
        "CORS_ALLOWED_ORIGINS": PUBLIC_URL, "LAB_AUTH_ENABLED": "1", "LAB_TOTP_KEY_FILE": "/run/secrets/lab_totp_key",
        "POSTHOG_API_KEY": "", "POSTHOG_HOST": "", "ANALYTICS_BASE_API": "", "ANALYTICS_SECRET_KEY": "",
        "ENABLE_SIGNUP": "0", "ENABLE_EMAIL_PASSWORD": "0", "ENABLE_MAGIC_LINK_LOGIN": "0",
        "GUNICORN_WORKERS": "1", "FILE_SIZE_LIMIT": "5242880", "TZ": "Asia/Shanghai",
    }
    _setup.write_env(directory / "api.env", api)
    _setup.write_env(directory / "live.env", {
        "PORT": "3000", "API_BASE_URL": "http://api:8000", "WEB_BASE_URL": PUBLIC_URL,
        "LIVE_BASE_URL": PUBLIC_URL, "LIVE_BASE_PATH": "/live", "LIVE_SERVER_SECRET_KEY": values["LIVE_SERVER_SECRET_KEY"],
        "REDIS_URL": "redis://plane-redis:6379/",
    })
    key = directory / "lab-totp.key"
    key.write_text(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n")
    key.chmod(0o600)
    (directory / "manifest.json").write_text(json.dumps({"project": "ooa-plane-e2e", "public_url": PUBLIC_URL,
        "source_origins": origins, "artifacts": ARTIFACTS}, indent=2) + "\n")
    return directory


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Prepare isolated browser tests from completed application builds")
    parser.add_argument("--directory", type=Path)
    args = parser.parse_args()
    directory = args.directory or (Path(tempfile.gettempdir()) / ("ooa-plane-e2e-" + secrets.token_hex(6)))
    print(prepare(directory))


if __name__ == "__main__":
    main()
