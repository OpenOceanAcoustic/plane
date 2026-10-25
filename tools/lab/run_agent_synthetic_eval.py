"""Launch a read-only, DB-disabled synthetic eval with optional provider env.

Example (prepare first, inspect inputs, then run exactly once):
  python3 tools/lab/run_agent_synthetic_eval.py prepare --output .artifacts/synthetic-eval
  python3 tools/lab/run_agent_synthetic_eval.py run --output .artifacts/synthetic-eval --api-container CONTAINER

Provider credentials are captured in memory and passed with Docker --env NAME.
No credential value is put in command arguments, files, or output.
"""

import argparse
import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
IMAGE = "ooa-plane-finance-tests:20261011"
PROVIDER_KEYS = (
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "run"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--api-container")
    parser.add_argument("--network", default="codex-ai-synthetic-eval-20261023")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    baseline = output / "baseline_agent_views.py"
    if args.mode == "prepare":
        baseline.write_bytes(
            subprocess.check_output(["git", "show", "a378d0e70:apps/api/plane/lab/agent_views.py"], cwd=ROOT)
        )
    elif not args.api_container:
        parser.error("run requires --api-container")
    child_env = dict(os.environ)
    provider_args = []
    if args.mode == "run":
        inspected = json.loads(
            subprocess.check_output(
                ["docker", "inspect", "--format", "{{json .Config.Env}}", args.api_container], stderr=subprocess.DEVNULL
            )
        )
        values = dict(item.split("=", 1) for item in inspected if "=" in item)
        base = values.get("DEEPSEEK_BASE_URL") or values.get("LLM_BASE_URL") or "https://api.deepseek.com"
        if base.rstrip("/") not in ("https://api.deepseek.com", "https://api.deepseek.com/v1"):
            raise RuntimeError("Configured provider is not the official DeepSeek endpoint")
        if not (values.get("DEEPSEEK_API_KEY") or values.get("LLM_API_KEY")):
            raise RuntimeError("Provider credentials are unavailable")
        for name in PROVIDER_KEYS:
            if name in values:
                child_env[name] = values[name]
                provider_args.extend(("--env", name))
    settings = {
        "DJANGO_SETTINGS_MODULE": "plane.settings.test",
        "DATABASE_URL": "postgresql://forbidden@127.0.0.1:1/disabled",
        "DATABASE_READ_REPLICA_URL": "",
        "REDIS_URL": "redis://127.0.0.1:1/0",
        "AMQP_URL": "memory://",
        "SECRET_KEY": "synthetic-only-evaluation-no-production-data-or-session-access",
        "LAB_AUTH_ENABLED": "0",
        "LAB_TOTP_KEY_FILE": "",
        "LAB_TOTP_KEY": "",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": "/code",
        "TZ": "Asia/Shanghai",
    }
    command = [
        "docker",
        "run",
        "--rm",
        "--read-only",
        "--memory",
        "1g",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp",
        "--network",
        "none" if args.mode == "prepare" else args.network,
        "--entrypoint",
        "python",
        "-w",
        "/code",
        "-v",
        f"{ROOT / 'apps/api'}:/code:ro",
        "-v",
        f"{ROOT / 'tools/lab/eval_agent_synthetic.py'}:/eval.py:ro",
        "-v",
        f"{output}:/artifacts",
    ]
    for name, value in settings.items():
        command.extend(("--env", f"{name}={value}"))
    command.extend(provider_args)
    command.extend(
        (IMAGE, "/eval.py", args.mode, "--baseline", "/artifacts/baseline_agent_views.py", "--output", "/artifacts")
    )
    created_network = False
    try:
        if args.mode == "run":
            subprocess.run(
                [
                    "docker",
                    "network",
                    "create",
                    "--driver",
                    "bridge",
                    "--label",
                    "codex.task=synthetic-agent-eval",
                    args.network,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            created_network = True
        completed = subprocess.run(command, env=child_env, check=False)
        raise SystemExit(completed.returncode)
    finally:
        if created_network:
            subprocess.run(
                ["docker", "network", "rm", args.network],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )


if __name__ == "__main__":
    main()
