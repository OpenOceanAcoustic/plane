#!/usr/bin/env python3
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Run API contracts using exclusively owned, internal Docker test services."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
LABEL = "org.openoceanacoustic.isolated-lab-tests"
DEFAULT_PREFIX = "plane-lab-tests-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:10]


class HarnessError(Exception):
    pass


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], text=True, capture_output=True)
    if check and result.returncode:
        raise HarnessError(result.stderr.strip() or f"Docker command failed: {args[0]}")
    return result


def inspect(kind, name):
    result = docker(kind, "inspect", name, check=False)
    if result.returncode:
        # A missing name is harmless; daemon/permission failures must not be
        # mistaken for absence before deciding which resources to create.
        if "No such" in result.stderr or "not found" in result.stderr:
            return None
        raise HarnessError(result.stderr.strip())
    return json.loads(result.stdout)[0]


class Harness:
    def __init__(self, args):
        self.args = args
        self.prefix = args.prefix
        self.labels = {LABEL: "1", LABEL + ".prefix": self.prefix, LABEL + ".source": str(ROOT)}
        self.services = {role: f"{self.prefix}-{role}" for role in ("db", "redis", "minio")}

    def label_args(self):
        return [value for key, item in self.labels.items() for value in ("--label", f"{key}={item}")]

    def own(self, item, kind):
        labels = item.get("Labels", {}) if kind == "network" else item.get("Config", {}).get("Labels", {})
        if any((labels or {}).get(key) != value for key, value in self.labels.items()):
            raise HarnessError(
                f"Refusing {kind} {item.get('Name', item['Id'])}: ownership labels do not match this checkout"
            )

    def network(self):
        item = inspect("network", self.prefix)
        if item:
            self.own(item, "network")
            if not item.get("Internal") or item.get("Driver") != "bridge":
                raise HarnessError("Refusing a non-internal or non-bridge network")
        return item

    def service(self, role):
        item = inspect("container", self.services[role])
        if item:
            self.own(item, "container")
            if set(item["NetworkSettings"]["Networks"]) != {self.prefix}:
                raise HarnessError(f"Refusing {role}: unexpected Docker network")
            if item["HostConfig"].get("PortBindings") or any(
                mount["Type"] != "tmpfs" for mount in item.get("Mounts", [])
            ):
                raise HarnessError(f"Refusing {role}: published ports or persistent/host mounts")
        return item

    def up(self):
        # Preflight every existing name before creating anything. Never adopt a
        # similarly named production container/network or an unlabelled stack.
        network = self.network()
        existing = {role: self.service(role) for role in self.services}
        images = [self.args.test_image, self.args.postgres_image, self.args.redis_image, self.args.minio_image]
        for image in images:
            if inspect("image", image) is None:
                raise HarnessError(
                    f"Local image {image!r} is missing; prepare it explicitly or select a local image. "
                    "No automatic pull is performed."
                )
        if not network:
            docker("network", "create", "--driver", "bridge", "--internal", *self.label_args(), self.prefix)
        definitions = {
            "db": [
                "--tmpfs",
                "/var/lib/postgresql/data",
                "-e",
                "POSTGRES_USER=plane",
                "-e",
                "POSTGRES_DB=plane_tests",
                "-e",
                "POSTGRES_HOST_AUTH_METHOD=trust",
                self.args.postgres_image,
            ],
            "redis": ["--tmpfs", "/data", self.args.redis_image],
            "minio": [
                "--tmpfs",
                "/data",
                "-e",
                "MINIO_ROOT_USER=test-only",
                "-e",
                "MINIO_ROOT_PASSWORD=test-only",
                self.args.minio_image,
                "server",
                "/data",
                "--console-address",
                ":9090",
            ],
        }
        for role, name in self.services.items():
            if not existing[role]:
                docker(
                    "run",
                    "-d",
                    "--name",
                    name,
                    "--network",
                    self.prefix,
                    "--network-alias",
                    f"test-{role}",
                    *self.label_args(),
                    *definitions[role],
                )
            elif not existing[role]["State"]["Running"]:
                docker("start", existing[role]["Id"])
        self.wait("db", ["pg_isready", "-U", "plane", "-d", "plane_tests"])
        self.wait("redis", ["valkey-cli", "ping"])
        self.wait("minio", ["mc", "alias", "set", "isolated", "http://127.0.0.1:9000", "test-only", "test-only"])
        docker("exec", self.services["minio"], "mc", "mb", "--ignore-existing", "isolated/uploads")
        print(f"Ready: {self.prefix} (internal network, no published ports)", flush=True)

    def wait(self, role, command):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if docker("exec", self.services[role], *command, check=False).returncode == 0:
                return
            time.sleep(0.5)
        raise HarnessError(f"Timed out waiting for isolated {role}; use the down command to clean up")

    def down(self):
        network = self.network()
        items = {}
        # Check expected names too: a colliding unowned name must never be
        # ignored just because the label-filtered enumeration excludes it.
        for name in [*self.services.values(), self.prefix + "-runner"]:
            item = inspect("container", name)
            if item:
                self.own(item, "container")
                items[item["Id"]] = item
        filters = [value for key, item in self.labels.items() for value in ("--filter", f"label={key}={item}")]
        for container_id in docker("ps", "-aq", *filters).stdout.split():
            item = inspect("container", container_id)
            if item:
                self.own(item, "container")
                items[item["Id"]] = item
        if network:
            foreign = set(network.get("Containers", {})) - set(items)
            if foreign:
                raise HarnessError("Refusing cleanup: the test network has foreign containers attached")
        # Delete by inspected immutable IDs, never by unchecked name or prune.
        for container_id in items:
            docker("rm", "-f", container_id)
        if network:
            docker("network", "rm", network["Id"])
        print(f"Removed only labelled resources for {self.prefix}; artifacts retained", flush=True)

    def snapshot(self, target):
        # Git lists both tracked and current untracked source, excluding ignored
        # runtime/configuration files. Never mount a live checkout or its .env.
        result = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps/api"],
            check=True,
            capture_output=True,
        )
        for name in set(result.stdout.decode().split("\0")) - {""}:
            relative = Path(name).relative_to("apps/api")
            if any(
                part.startswith(".env") or part in {".git", "node_modules", "__pycache__", ".venv"}
                for part in relative.parts
            ):
                continue
            if relative.suffix.lower() in {".key", ".pem", ".p12", ".pfx"}:
                continue
            source = ROOT / name
            if source.is_symlink():
                raise HarnessError(f"Refusing source symlink in isolated snapshot: {name}")
            if source.is_file():
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        if not (target / "manage.py").is_file():
            raise HarnessError("API source was not found in this checkout")
        (target / "plane/static-assets/collected-static").mkdir(parents=True, exist_ok=True)

    def run(self, pytest_args):
        artifacts = self.args.artifacts.resolve()
        if "," in str(artifacts):
            raise HarnessError("Artifact paths containing commas are not supported by Docker --mount")
        marker = artifacts / ".isolated-lab-tests.json"
        if artifacts.exists() and any(artifacts.iterdir()):
            if not marker.is_file() or marker.is_symlink() or json.loads(marker.read_text()) != self.labels:
                raise HarnessError("Refusing to mount an artifact directory not owned by this harness prefix")
        else:
            artifacts.mkdir(parents=True, exist_ok=True)
            marker.write_text(json.dumps(self.labels, indent=2) + "\n")
        self.up()
        if inspect("container", self.prefix + "-runner"):
            raise HarnessError("A runner already exists for this prefix; use a different prefix for parallel tests")
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "DJANGO_SETTINGS_MODULE": "plane.settings.test",
            "DATABASE_URL": "postgresql://plane@test-db:5432/plane_tests",
            "DATABASE_READ_REPLICA_URL": "",
            "POSTGRES_HOST": "test-db",
            "REDIS_URL": "redis://test-redis:6379/0",
            "REDIS_HOST": "test-redis",
            "AMQP_URL": "memory://",
            "RABBITMQ_HOST": "test-mq.invalid",
            "SECRET_KEY": "isolated-test-only-not-production",
            "LAB_AUTH_ENABLED": "0",
            "LAB_TOTP_KEY_FILE": "",
            "LAB_TOTP_KEY": "",
            "ENABLE_SIGNUP": "1",
            "ENABLE_EMAIL_PASSWORD": "1",
            "ENABLE_MAGIC_LINK_LOGIN": "1",
            "LLM_PROVIDER": "",
            "LLM_API_KEY": "",
            "DEEPSEEK_API_KEY": "",
            "LLM_MODEL": "",
            "DEEPSEEK_BASE_URL": "http://llm.invalid",
            "LLM_BASE_URL": "http://llm.invalid",
            "EMAIL_HOST": "test-smtp.invalid",
            "AWS_ACCESS_KEY_ID": "test-only",
            "AWS_SECRET_ACCESS_KEY": "test-only",
            "AWS_S3_ENDPOINT_URL": "http://test-minio:9000",
            "AWS_S3_BUCKET_NAME": "uploads",
            "USE_MINIO": "1",
            "WEB_URL": "http://testserver",
            "TZ": "Asia/Shanghai",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        if pytest_args[:1] == ["--"]:
            pytest_args = pytest_args[1:]
        pytest_args = pytest_args or ["plane/tests/contract/api/lab"]
        with tempfile.TemporaryDirectory(prefix=self.prefix + "-source-") as temporary:
            source = Path(temporary)
            self.snapshot(source)
            # env -i prevents even image defaults from becoming provider keys,
            # external database connections, proxy URLs or other live settings.
            command = [
                "docker",
                "run",
                "--rm",
                "--name",
                self.prefix + "-runner",
                "--network",
                self.prefix,
                *self.label_args(),
                "--user",
                f"{os.getuid()}:{os.getgid()}",
                "--entrypoint",
                "/usr/bin/env",
                "-w",
                "/code",
                "--mount",
                f"type=bind,src={source},dst=/code,readonly",
                "--mount",
                f"type=bind,src={artifacts},dst=/artifacts",
                self.args.test_image,
                "-i",
                *[f"{key}={value}" for key, value in env.items()],
                "pytest",
                "--migrations",
                "-o",
                "addopts=",
                "-o",
                "cache_dir=/tmp/pytest-cache",
                "--reuse-db",
                "-q",
                *pytest_args,
            ]
            print(f"Artifacts: {artifacts}", flush=True)
            return subprocess.run(command).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prefix", default=DEFAULT_PREFIX, help="isolated resource prefix; use a distinct value for parallel runs"
    )
    parser.add_argument("--test-image", default="ooa-plane-finance-tests:20261011")
    parser.add_argument("--postgres-image", default="postgres:15.7-alpine")
    parser.add_argument("--redis-image", default="valkey/valkey:7.2.11-alpine")
    parser.add_argument("--minio-image", default="ooa-plane-minio:source")
    parser.add_argument("--artifacts", type=Path, help="host artifact directory, mounted at /artifacts")
    parser.add_argument("command", choices=("up", "run", "down"))
    parser.add_argument("pytest_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not re.fullmatch(r"plane-lab-tests-[a-z0-9][a-z0-9-]{0,45}", args.prefix):
        parser.error("prefix must start with plane-lab-tests- and contain only lowercase letters, digits or hyphens")
    if args.command != "run" and args.pytest_args:
        parser.error("pytest arguments are only accepted by run")
    args.artifacts = args.artifacts or ROOT / ".artifacts/isolated-backend" / args.prefix
    try:
        harness = Harness(args)
        if args.command == "run":
            return harness.run(args.pytest_args)
        getattr(harness, args.command)()
        return 0
    except (HarnessError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"isolated-tests: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(f"Interrupted; clean up with: {sys.argv[0]} --prefix {args.prefix} down", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
