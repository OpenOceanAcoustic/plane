#!/usr/bin/env python3
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Prepare ignored local configuration without printing or overwriting secrets."""

import argparse
import base64
import os
from pathlib import Path
import secrets
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def read_env(path):
    result = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                result[key.strip()] = value.strip().strip('"')
    return result


def write_env(path, values):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(f'{key}="{value}"' for key, value in values.items()) + "\n"
    )
    path.chmod(0o600)


def public_url(value):
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        raise ValueError("访问地址格式无效") from None
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.hostname in ("0.0.0.0", "::")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "访问地址须为不含凭据、路径或 token 的 HTTP/HTTPS 内网 IP 或域名，不能使用 0.0.0.0"
        )
    return value.rstrip("/")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="配置本机或内网访问地址，保留现有数据和认证密钥"
    )
    parser.add_argument("--public-url", help="例如 http://192.168.137.90:8080")
    options = parser.parse_args(argv)
    os.umask(0o077)
    root = read_env(ROOT / ".env")
    try:
        base_url = public_url(
            options.public_url
            if options.public_url is not None
            else root.get("LAB_PUBLIC_URL", "http://localhost:8080")
        )
    except ValueError as error:
        parser.error(str(error))
    root["LAB_PUBLIC_URL"] = base_url
    if options.public_url is not None:
        root["LAB_BIND_ADDRESS"] = (
            "127.0.0.1"
            if urlsplit(base_url).hostname in ("localhost", "127.0.0.1", "::1")
            else "0.0.0.0"
        )
    root.setdefault("LAB_BIND_ADDRESS", "127.0.0.1")
    defaults = {
        "POSTGRES_USER": "plane",
        "POSTGRES_DB": "plane",
        "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
        "RABBITMQ_USER": "plane",
        "RABBITMQ_PASSWORD": secrets.token_urlsafe(32),
        "RABBITMQ_VHOST": "plane",
        "AWS_ACCESS_KEY_ID": "ooa-local",
        "AWS_SECRET_ACCESS_KEY": secrets.token_urlsafe(32),
        "AWS_S3_BUCKET_NAME": "uploads",
        "LIVE_SERVER_SECRET_KEY": secrets.token_urlsafe(32),
    }
    for key, value in defaults.items():
        root.setdefault(key, value)
    write_env(ROOT / ".env", root)
    key_file = ROOT / ".secrets/lab-totp.key"
    key_file.parent.mkdir(exist_ok=True)
    if not key_file.exists():
        key_file.write_text(
            base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n"
        )
    key_file.chmod(0o600)
    backend = read_env(ROOT / "apps/api/.env")
    for key in defaults:
        backend[key] = root[key]
    backend.setdefault("SECRET_KEY", secrets.token_urlsafe(50))
    backend.update(
        {
            "DEBUG": "0",
            "DJANGO_SETTINGS_MODULE": "plane.settings.production",
            "POSTGRES_HOST": "plane-db",
            "POSTGRES_PORT": "5432",
            "DATABASE_URL": f"postgresql://{root['POSTGRES_USER']}:{root['POSTGRES_PASSWORD']}@plane-db:5432/{root['POSTGRES_DB']}",
            "REDIS_HOST": "plane-redis",
            "REDIS_URL": "redis://plane-redis:6379/",
            "RABBITMQ_HOST": "plane-mq",
            "RABBITMQ_PORT": "5672",
            "AWS_S3_ENDPOINT_URL": "http://plane-minio:9000",
            "USE_MINIO": "1",
            "WEB_URL": base_url,
            "APP_BASE_URL": base_url,
            "ADMIN_BASE_URL": base_url,
            "ADMIN_BASE_PATH": "/god-mode",
            "SPACE_BASE_URL": base_url,
            "SPACE_BASE_PATH": "/spaces",
            "LIVE_BASE_URL": base_url,
            "LIVE_BASE_PATH": "/live",
            "CORS_ALLOWED_ORIGINS": (
                base_url
                + ",http://localhost:3000,http://localhost:3001,http://localhost:8080"
                + ",http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:8080"
            ),
            "LAB_AUTH_ENABLED": "1",
            "LAB_TOTP_KEY_FILE": "/run/secrets/lab_totp_key",
            "POSTHOG_API_KEY": "",
            "POSTHOG_HOST": "",
            "ANALYTICS_SECRET_KEY": "",
            "ANALYTICS_BASE_API": "",
            "ENABLE_SIGNUP": "0",
            "ENABLE_EMAIL_PASSWORD": "0",
            "ENABLE_MAGIC_LINK_LOGIN": "0",
            "GUNICORN_WORKERS": "1",
            "FILE_SIZE_LIMIT": "5242880",
            "TZ": "Asia/Shanghai",
        }
    )
    backend.pop("LAB_TOTP_KEY", None)
    write_env(ROOT / "apps/api/.env", backend)
    for app in ("web", "admin", "space"):
        values = {
            "VITE_API_BASE_URL": "",
            "VITE_WEB_BASE_URL": base_url,
            "VITE_ADMIN_BASE_URL": base_url,
            "VITE_ADMIN_BASE_PATH": "/god-mode",
            "VITE_SPACE_BASE_URL": base_url,
            "VITE_SPACE_BASE_PATH": "/spaces",
            "VITE_LIVE_BASE_URL": base_url,
            "VITE_LIVE_BASE_PATH": "/live",
            "VITE_ENABLE_SESSION_RECORDER": "0",
        }
        write_env(ROOT / f"apps/{app}/.env", values)
    write_env(
        ROOT / "apps/live/.env",
        {
            "PORT": "3000",
            "API_BASE_URL": "http://api:8000",
            "WEB_BASE_URL": base_url,
            "LIVE_BASE_URL": base_url,
            "LIVE_BASE_PATH": "/live",
            "LIVE_SERVER_SECRET_KEY": root["LIVE_SERVER_SECRET_KEY"],
            "REDIS_URL": "redis://plane-redis:6379/",
        },
    )
    print(f"访问地址已配置：{base_url}；认证密钥保留在 .secrets/lab-totp.key。")


if __name__ == "__main__":
    main()
