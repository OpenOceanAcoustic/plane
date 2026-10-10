#!/usr/bin/env python3
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Prepare ignored local configuration without printing or overwriting secrets."""

import argparse
import base64
import os
from pathlib import Path
import secrets
import ipaddress
import re
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


def listen_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise ValueError("监听端口须为 1 至 65535 的整数") from None
    if not 1 <= port <= 65535:
        raise ValueError("监听端口须为 1 至 65535 的整数")
    return str(port)


def bind_address(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        raise ValueError("监听地址须为有效 IP 地址，例如 0.0.0.0 或 127.0.0.1") from None
    return f"[{address.compressed}]" if address.version == 6 else address.compressed


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


def configure_public(value):
    """Create a separate production profile without changing the lab's credentials."""
    origin = public_url(value)
    parsed = urlsplit(origin)
    host = parsed.hostname.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("公网访问地址必须使用正式 HTTPS 域名")
    if parsed.scheme != "https" or parsed.port is not None or not re.fullmatch(
        r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", host
    ) or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("公网访问地址必须是无端口、路径的正式 HTTPS 域名")
    origin = "https://" + host
    root = read_env(ROOT / ".env")
    root.update(read_env(ROOT / ".env.public"))
    defaults = {
        "POSTGRES_USER": "plane", "POSTGRES_DB": "plane",
        "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
        "RABBITMQ_USER": "plane", "RABBITMQ_VHOST": "plane",
        "RABBITMQ_PASSWORD": secrets.token_urlsafe(32),
        "AWS_ACCESS_KEY_ID": "ooa-local", "AWS_SECRET_ACCESS_KEY": secrets.token_urlsafe(32),
        "AWS_S3_BUCKET_NAME": "uploads", "LIVE_SERVER_SECRET_KEY": secrets.token_urlsafe(32),
        "PUBLIC_DATA_PROJECT": "ooa-plane-lab", "PUBLIC_IMAGE_TAG": "security",
        "PUBLIC_BACKEND_SUBNET": "172.29.240.0/24", "PUBLIC_PROXY_IP": "172.29.240.2",
        "PUBLIC_API_UID": str(os.getuid() or 10001),
        "SECURE_HSTS_SECONDS": "300",
    }
    for name, default in defaults.items():
        root.setdefault(name, default)
    if not root["PUBLIC_API_UID"].isdigit() or int(root["PUBLIC_API_UID"]) == 0:
        raise ValueError("PUBLIC_API_UID 必须是非 root 的数字 UID")
    root.update(PUBLIC_ORIGIN=origin, PUBLIC_HOST=host, PUBLIC_DEPLOYMENT="1")
    api = read_env(ROOT / "apps/api/.env")
    api.update(read_env(ROOT / "apps/api/.env.public"))
    api.setdefault("SECRET_KEY", secrets.token_urlsafe(50))
    api.update({name: root[name] for name in defaults if name in (
        "POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PASSWORD", "RABBITMQ_USER", "RABBITMQ_PASSWORD",
        "RABBITMQ_VHOST", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET_NAME", "LIVE_SERVER_SECRET_KEY",
    )})
    api.update({
        "PUBLIC_DEPLOYMENT": "1", "PUBLIC_ORIGIN": origin, "PUBLIC_HOST": host, "DEBUG": "0",
        "DJANGO_SETTINGS_MODULE": "plane.settings.production", "ALLOWED_HOSTS": host,
        "CORS_ALLOWED_ORIGINS": origin, "CSRF_TRUSTED_ORIGINS": origin,
        "SESSION_COOKIE_SECURE": "1", "CSRF_COOKIE_SECURE": "1", "SECURE_SSL_REDIRECT": "1",
        "SECURE_HSTS_SECONDS": root["SECURE_HSTS_SECONDS"],
        "TRUSTED_PROXY_CIDRS": root["PUBLIC_PROXY_IP"] + "/32",
        "POSTGRES_HOST": "plane-db", "POSTGRES_PORT": "5432",
        "DATABASE_URL": f"postgresql://{root['POSTGRES_USER']}:{root['POSTGRES_PASSWORD']}@plane-db:5432/{root['POSTGRES_DB']}",
        "REDIS_HOST": "plane-redis", "REDIS_URL": "redis://plane-redis:6379/",
        "RABBITMQ_HOST": "plane-mq", "RABBITMQ_PORT": "5672", "USE_MINIO": "1",
        "AWS_S3_ENDPOINT_URL": "http://plane-minio:9000", "MINIO_ENDPOINT_SSL": "1",
        "WEB_URL": origin, "APP_BASE_URL": origin, "ADMIN_BASE_URL": origin, "ADMIN_BASE_PATH": "/god-mode",
        "SPACE_BASE_URL": origin, "SPACE_BASE_PATH": "/spaces", "LIVE_BASE_URL": origin, "LIVE_BASE_PATH": "/live",
        "LAB_AUTH_ENABLED": "1", "LAB_TOTP_KEY_FILE": "/run/secrets/lab_totp_key",
        "ENABLE_SIGNUP": "0", "ENABLE_EMAIL_PASSWORD": "0", "ENABLE_MAGIC_LINK_LOGIN": "0",
        "FILE_SIZE_LIMIT": "5242880", "TZ": "Asia/Shanghai",
    })
    api.pop("LAB_TOTP_KEY", None)
    key_file = ROOT / ".secrets/lab-totp.key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    if not key_file.exists():
        key_file.write_text(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n")
    key_file.chmod(0o600)
    public_key = ROOT / ".secrets/public-totp.key"
    if not public_key.exists():
        public_key.write_bytes(key_file.read_bytes())
    if public_key.read_bytes() != key_file.read_bytes():
        raise ValueError("公网密钥副本与现有认证密钥不一致，请先核对迁移密钥")
    public_key.chmod(0o600)
    if os.getuid() == 0:
        os.chown(public_key, int(root["PUBLIC_API_UID"]), int(root["PUBLIC_API_UID"]))
    write_env(ROOT / ".env.public", root)
    write_env(ROOT / "apps/api/.env.public", api)
    write_env(ROOT / "apps/live/.env.public", {
        "PORT": "3000", "PUBLIC_DEPLOYMENT": "1", "PUBLIC_ORIGIN": origin,
        "API_BASE_URL": origin, "CORS_ALLOWED_ORIGINS": origin,
        "LIVE_BASE_PATH": "/live", "LIVE_SERVER_SECRET_KEY": root["LIVE_SERVER_SECRET_KEY"],
        "REDIS_URL": "redis://plane-redis:6379/", "TRUSTED_PROXY_CIDRS": root["PUBLIC_PROXY_IP"] + "/32",
    })
    print(f"公网配置已保存：{origin}；本地配置与认证密钥保留。")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="配置本机或内网访问地址，保留现有数据和认证密钥"
    )
    parser.add_argument("--public-url", help="例如 http://192.168.137.90:8080")
    parser.add_argument("--profile", choices=("lab", "public"), default="lab")
    parser.add_argument("--listen-port", help="宿主机 HTTP 监听端口，默认保留现值或 8080")
    parser.add_argument(
        "--bind-address", help="宿主机监听 IP，例如 0.0.0.0；与客户端地址分别配置"
    )
    options = parser.parse_args(argv)
    os.umask(0o077)
    if options.profile == "public":
        if options.listen_port is not None or options.bind_address is not None:
            parser.error("监听端口参数仅用于 lab profile；public profile 使用正式 HTTPS 入口")
        value = options.public_url or read_env(ROOT / ".env.public").get("PUBLIC_ORIGIN")
        if not value:
            parser.error("公网配置必须提供 --public-url https://正式域名")
        try:
            configure_public(value)
        except ValueError as error:
            parser.error(str(error))
        return
    root = read_env(ROOT / ".env")
    try:
        base_url = public_url(
            options.public_url
            if options.public_url is not None
            else root.get("LAB_PUBLIC_URL", "http://localhost:8080")
        )
    except ValueError as error:
        parser.error(str(error))
    try:
        port = listen_port(
            options.listen_port
            if options.listen_port is not None
            else root.get("LAB_HTTP_PORT", "8080")
        )
        explicit_bind = (
            bind_address(options.bind_address)
            if options.bind_address is not None
            else None
        )
    except ValueError as error:
        parser.error(str(error))
    root["LAB_HTTP_PORT"] = port
    root["LAB_PUBLIC_URL"] = base_url
    if options.public_url is not None:
        root["LAB_BIND_ADDRESS"] = (
            "127.0.0.1"
            if urlsplit(base_url).hostname in ("localhost", "127.0.0.1", "::1")
            else "0.0.0.0"
        )
    root.setdefault("LAB_BIND_ADDRESS", "127.0.0.1")
    if explicit_bind is not None:
        root["LAB_BIND_ADDRESS"] = explicit_bind
    allowed_origins = ",".join(
        dict.fromkeys(
            (
                base_url,
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:8080",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:8080",
                f"http://localhost:{port}",
                f"http://127.0.0.1:{port}",
            )
        )
    )
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
            "CORS_ALLOWED_ORIGINS": allowed_origins,
            "CSRF_TRUSTED_ORIGINS": allowed_origins,
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
            "CORS_ALLOWED_ORIGINS": base_url,
            "LIVE_BASE_URL": base_url,
            "LIVE_BASE_PATH": "/live",
            "LIVE_SERVER_SECRET_KEY": root["LIVE_SERVER_SECRET_KEY"],
            "REDIS_URL": "redis://plane-redis:6379/",
        },
    )
    print(
        f"访问地址已配置：{base_url}；监听 {root['LAB_BIND_ADDRESS']}:{port}；"
        "认证密钥保留在 .secrets/lab-totp.key。"
    )


if __name__ == "__main__":
    main()
