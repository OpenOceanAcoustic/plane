"""Reproduce the Android test stack, bound only to localhost:18100.

Only containers named ooa-android-contract-* are managed. Environment files and
synthetic TOTP credentials stay in a private directory outside Git.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[5]
SUPPORT = Path(__file__).resolve().parent
NETWORK = "ooa-android-contract"
NAMES = [f"{NETWORK}-{name}" for name in ("db", "redis", "minio", "api", "http", "live", "proxy")]


def run(*args, capture=False, check=True, cwd=None, input_text=None):
    return subprocess.run(args, check=check, capture_output=capture, text=True, cwd=cwd, input=input_text)


def write_private(path, values):
    if not path.exists():
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
    path.chmod(0o600)


def environment(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line and not line.startswith("#"))


def exists(kind, name):
    return run("docker", kind, "inspect", name, capture=True, check=False).returncode == 0


def container(name, image, options, *command):
    if exists("container", name):
        run("docker", "start", name, capture=True)
    else:
        run("docker", "run", "-d", "--name", name, "--network", NETWORK, *options, image, *command, capture=True)


def prepare(private):
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)
    database_password = secrets.token_urlsafe(24)
    live_secret = secrets.token_urlsafe(48)
    access = secrets.token_hex(12)
    asset_secret = secrets.token_urlsafe(36)
    write_private(private / "test-api.env", {
        "DATABASE_URL": f"postgres://plane:{database_password}@{NETWORK}-db:5432/plane",
        "REDIS_URL": f"redis://{NETWORK}-redis:6379/0",
        "SECRET_KEY": secrets.token_urlsafe(48),
        "LAB_AUTH_ENABLED": "1", "LAB_TOTP_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        "LIVE_SERVER_SECRET_KEY": live_secret,
        "WEB_URL": "http://127.0.0.1:18100", "APP_BASE_URL": "http://127.0.0.1:18100",
        "ALLOWED_HOSTS": "*", "CORS_ALLOWED_ORIGINS": "http://localhost:5173,http://localhost:63245,http://localhost:63246",
        "AWS_REGION": "us-east-1", "USE_MINIO": "1", "AWS_S3_BUCKET_NAME": "uploads",
        "AWS_S3_ENDPOINT_URL": f"http://{NETWORK}-minio:9000",
        "AWS_ACCESS_KEY_ID": access, "AWS_SECRET_ACCESS_KEY": asset_secret,
        "DJANGO_SETTINGS_MODULE": "android_test_settings", "PYTHONPATH": "/android_test:/code",
        "INSTANCE_CHANGELOG_URL": "http://127.0.0.1:1", "EMAIL_HOST": "127.0.0.1",
    })
    api = environment(private / "test-api.env")
    database = urlparse(api["DATABASE_URL"])
    if database.hostname != f"{NETWORK}-db" or api["REDIS_URL"] != f"redis://{NETWORK}-redis:6379/0":
        raise SystemExit("Test environment must target the isolated Docker database and Redis")
    write_private(private / "test-db.env", {
        "POSTGRES_USER": database.username, "POSTGRES_PASSWORD": database.password, "POSTGRES_DB": "plane",
    })
    write_private(private / "test-minio.env", {
        "MINIO_ROOT_USER": api["AWS_ACCESS_KEY_ID"], "MINIO_ROOT_PASSWORD": api["AWS_SECRET_ACCESS_KEY"],
    })
    write_private(private / "test-live.env", {
        "API_BASE_URL": f"http://{NETWORK}-http:8000", "PORT": "3000", "LIVE_BASE_PATH": "/live",
        "LIVE_SERVER_SECRET_KEY": api["LIVE_SERVER_SECRET_KEY"], "REDIS_URL": api["REDIS_URL"],
        "CORS_ALLOWED_ORIGINS": api["CORS_ALLOWED_ORIGINS"],
    })


def up(private):
    prepare(private)
    api_image = os.environ.get("ANDROID_TEST_API_IMAGE", "ooa-plane-api:lab")
    minio_image = os.environ.get("ANDROID_TEST_MINIO_IMAGE", "ooa-plane-minio:source")
    for image in (api_image, minio_image):
        if not exists("image", image):
            raise SystemExit(f"Build the isolated image first: {image}")
    if not (ROOT / "apps/live/dist/start.mjs").exists():
        raise SystemExit("Build apps/live with its local tsc and tsdown binaries first")
    if not exists("network", NETWORK):
        run("docker", "network", "create", NETWORK, capture=True)
    container(NAMES[0], "postgres:15.7-alpine", ["--tmpfs", "/var/lib/postgresql/data", "--env-file", str(private / "test-db.env")])
    container(NAMES[1], "valkey/valkey:7.2.11-alpine", ["--tmpfs", "/data"], "valkey-server", "--save", "", "--appendonly", "no")
    container(NAMES[2], minio_image, ["--tmpfs", "/data", "--env-file", str(private / "test-minio.env")], "server", "/data")
    for _ in range(30):
        if run("docker", "exec", NAMES[0], "pg_isready", capture=True, check=False).returncode == 0:
            break
        time.sleep(1)
    api_options = ["--env-file", str(private / "test-api.env"), "-v", f"{ROOT}/apps/api:/code"]
    container(NAMES[3], api_image, [*api_options, "-e", "DJANGO_SETTINGS_MODULE=plane.settings.test", "--entrypoint", "sh"],
              "-c", "pip install -q pytest==9.0.3 pytest-django==4.12.0 pytest-mock==3.11.1 freezegun==1.2.2 factory-boy==3.3.0 httpx==0.24.1 && tail -f /dev/null")
    container(NAMES[4], api_image, [*api_options, "-v", f"{SUPPORT}:/android_test:ro", "-v", f"{private}:/test-secrets", "--entrypoint", "sh"],
              "-c", "python manage.py migrate --noinput && python manage.py runserver 0.0.0.0:8000 --noreload")
    container(NAMES[5], "node:22.22.1-bookworm-slim", ["--env-file", str(private / "test-live.env"), "-v", f"{ROOT}:/workspace:ro", "-w", "/workspace/apps/live"], "node", "dist/start.mjs")
    container(NAMES[6], "caddy:2.10.2-alpine", ["-p", "127.0.0.1:18100:80", "-v", f"{SUPPORT}/Caddyfile:/etc/caddy/Caddyfile:ro"])
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:18100/api/instances/", timeout=2):
                break
        except OSError:
            time.sleep(1)
    else:
        raise SystemExit("Isolated HTTP did not become ready; inspect its container log")
    fixture = private / "test-credentials.json"
    run("docker", "exec", "-i", NAMES[4], "python", "manage.py", "shell", input_text=(SUPPORT / "seed.py").read_text())
    run("docker", "exec", "-i", NAMES[4], "python", "manage.py", "shell", input_text=(SUPPORT / "shared-seed.py").read_text())
    run("docker", "exec", NAMES[4], "python", "manage.py", "shell", "-c",
        "import boto3; from django.conf import settings; c=boto3.client('s3',endpoint_url=settings.AWS_S3_ENDPOINT_URL,aws_access_key_id=settings.AWS_ACCESS_KEY_ID,aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,region_name='us-east-1'); existing={b['Name'] for b in c.list_buckets()['Buckets']}; c.create_bucket(Bucket='uploads') if 'uploads' not in existing else None")
    run("docker", "exec", NAMES[4], "chown", f"{os.getuid()}:{os.getgid()}", "/test-secrets/test-credentials.json")
    fixture.chmod(0o600)
    print(f"Isolated server ready at http://127.0.0.1:18100; private fixture: {fixture}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("up", "status", "test", "restart-http", "restart-live", "stop"))
    parser.add_argument("--private-dir", type=Path, default=ROOT.parent / ".android-release")
    args = parser.parse_args()
    if args.command == "up":
        up(args.private_dir.resolve())
    elif args.command == "status":
        for name in NAMES:
            run("docker", "inspect", name, "--format", "{{.Name}} {{.State.Status}}", check=False)
    elif args.command == "test":
        run("docker", "exec", NAMES[3], "python", "-m", "pytest", "-q",
            "plane/tests/contract/api/lab/test_auth.py", "plane/tests/contract/api/lab/test_mobile.py",
            "plane/tests/contract/api/lab/test_documents.py", "plane/tests/contract/api/lab/test_mobile_native_core.py")
    elif args.command.startswith("restart-"):
        run("docker", "restart", f"{NETWORK}-{args.command.removeprefix('restart-')}")
    else:
        run("docker", "stop", *reversed(NAMES))


if __name__ == "__main__":
    main()
