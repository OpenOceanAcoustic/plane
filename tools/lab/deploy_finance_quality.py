#!/usr/bin/env python3
"""Publish the worker-first finance and quality workbench.

Run on the deployment host as root:

    sudo python3 /tmp/deploy-finance-quality.py

The reviewed workbench bundle is embedded in this script, so deployment needs
only this one file. It checks the deployment is based on a known workbench
revision, installs the source files, builds the web client with the repository
toolchain, commits the source change, and publishes the static bundle. Hashed
assets are additive; index.html is replaced last after a production smoke test.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(os.environ.get("PLANE_REPO", "/mnt/repo/kanban/plane")).resolve()
RUNTIME = REPO / ".temp/lab-runtime/web"
BUILD = REPO / "apps/web/build/client"
LOCAL_URL = os.environ.get("PLANE_LOCAL_URL", "http://127.0.0.1:50020")
PUBLIC_URL = os.environ.get("PLANE_PUBLIC_URL", "https://plane.oceanacoustic.top")

BUNDLE_SHA256 = "821c0973a85f53a9de7265605d12485150f0af291a80f1b65f7ef3b5c7a5f8fc"
# The reviewed workbench bundle is embedded so deployment never needs a second
# network request. Run this file once; it is a complete snapshot.
BUNDLE_B64 = """
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
"""
EXPECTED_HEAD = "7cdc5282ae82baae5845feef579feb2a5bbc255a"
MARKER = "资料完成度"
COMMIT_MESSAGE = "fix: harden time agent errors"
V18_SUBJECT = "feat: add DeepSeek time entry assistant"
V17_SUBJECT = "fix: make receipt button actionable"
V16_SUBJECT = "feat: let workers propose cash bounties"
V15_SUBJECT = "feat: add simple cash bounties"
V14_SUBJECT = "fix: unblock finance dialogs during background refresh"
V13_SUBJECT = "fix: clarify empty cost time inputs"
V12_SUBJECT = "fix: explain disabled bounty and finance actions"
V11_SUBJECT = "feat: add task detail hours and empty states"
V10_SUBJECT = "feat: finish responsive lab tables"
V9_SUBJECT = "feat: polish lab workbench mobile and terminology"
V8_SUBJECT = "feat: refresh lab workbench with participation and task hours"
V7_SUBJECT = "feat: add participatory management and bounty shortcuts"
V6_SUBJECT = "feat: add participatory management and lazy workbench"
V5_SUBJECT = "feat: simplify stage budget setup"
V4_SUBJECT = "feat: guide external receipts and internal pool funding"
V3_SUBJECT = "feat: add dedicated incoming money workbench"
V2_SUBJECT = "feat: extend workbench styling and project switching"
V1_SUBJECT = "feat: add worker-first finance and quality workbenches"
V1_MARKER = "FinanceWorkbench"

FILES = (
    "apps/api/plane/lab/agent_views.py",
    "apps/api/plane/lab/urls.py",
    "docs/lab/finance-quality-workbench.md",
)
SELF_DEST = REPO / "tools/lab/deploy_finance_quality.py"
COMMIT_PATHS = (*FILES, "tools/lab/deploy_finance_quality.py")


def fail(message: str) -> None:
    raise SystemExit(message)


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", "-c", f"safe.directory={REPO}", *args],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        fail(f"git {' '.join(args)} 失败：\n{result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def find_node() -> Path:
    candidates = [os.environ.get("NODE_BIN"), shutil.which("node"), "/usr/bin/node"]
    candidates.extend(str(path) for path in sorted(Path("/home/qp/.nvm/versions/node").glob("*/bin/node"), reverse=True))
    for candidate in candidates:
        if candidate:
            path = Path(candidate)
            if path.is_file() and os.access(path, os.X_OK):
                return path
    fail("找不到 node。请设置 NODE_BIN=/path/to/node 后重试。")


def local_bin(*parts: str) -> Path:
    path = REPO.joinpath(*parts)
    if not path.is_file():
        fail(f"缺少构建命令：{path}")
    return path


def run(command: list[str], env: dict[str, str], cwd: Path = REPO) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def load_bundle() -> bytes:
    try:
        data = base64.b64decode("".join(BUNDLE_B64.split()), validate=True)
    except Exception as problem:  # noqa: BLE001 - report malformed embedded data
        fail(f"内嵌改版包解码失败：{problem}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != BUNDLE_SHA256:
        fail(f"改版包校验失败：期望 {BUNDLE_SHA256}，实际 {digest}")
    print(f"改版包校验通过：{digest}")
    return data

def extract_bundle(data: bytes) -> Path:
    root = Path(tempfile.mkdtemp(prefix="plane-finance-quality-"))
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive.getmembers():
                target = Path(member.name)
                if target.is_absolute() or ".." in target.parts:
                    fail(f"改版包包含不安全路径：{member.name}")
            try:
                archive.extractall(root, filter="data")
            except TypeError:
                archive.extractall(root)
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return root


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def same_as_bundle(root: Path) -> bool:
    return all((REPO / relative).is_file() and file_digest(REPO / relative) == file_digest(root / relative) for relative in FILES)


def apply_files(root: Path) -> None:
    for relative in FILES:
        source = root / relative
        if not source.is_file():
            fail(f"改版包缺少文件：{relative}")
        target = REPO / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        owner = target.stat() if target.exists() else target.parent.stat()
        shutil.copy2(source, target)
        try:
            os.chown(target, owner.st_uid, owner.st_gid)
        except OSError:
            pass
    SELF_DEST.parent.mkdir(parents=True, exist_ok=True)
    source_script = Path(__file__).resolve()
    if source_script != SELF_DEST:
        owner = SELF_DEST.stat() if SELF_DEST.exists() else SELF_DEST.parent.stat()
        shutil.copy2(source_script, SELF_DEST)
        os.chmod(SELF_DEST, 0o755)
        try:
            os.chown(SELF_DEST, owner.st_uid, owner.st_gid)
        except OSError:
            pass


def commit_changes() -> None:
    subprocess.run(["git", "-c", f"safe.directory={REPO}", "add", "--", *COMMIT_PATHS], cwd=REPO, check=True)
    staged = subprocess.run(
        ["git", "-c", f"safe.directory={REPO}", "diff", "--cached", "--quiet", "--", *COMMIT_PATHS], cwd=REPO
    )
    if staged.returncode == 0:
        print("源文件没有变化，跳过提交。")
        return
    print("+ git commit")
    subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={REPO}",
            "-c",
            "user.name=OpenOceanAcoustic Deployment",
            "-c",
            "user.email=deploy@openoceanacoustic.local",
            "commit",
            "--no-verify",
            "-m",
            COMMIT_MESSAGE,
            "--",
            *COMMIT_PATHS,
        ],
        cwd=REPO,
        check=True,
    )


def migrate_backend() -> None:
    """Apply the additive cash-bounty table and reload API routes."""
    compose = [
        "docker",
        "compose",
        "-p",
        os.environ.get("LAB_COMPOSE_PROJECT", "ooa-plane-lab"),
        "-f",
        "compose.lab.yml",
    ]
    env = os.environ.copy()
    print("正在检查现金悬赏后端代码…")
    run([*compose, "exec", "-T", "api", "python", "manage.py", "check"], env)
    run([*compose, "exec", "-T", "api", "python", "manage.py", "makemigrations", "--check", "--dry-run", "lab"], env)
    print("正在执行现金悬赏数据库迁移…")
    run([*compose, "exec", "-T", "api", "python", "manage.py", "migrate", "lab"], env)
    run([*compose, "restart", "api"], env)


def build(env: dict[str, str]) -> None:
    for package, binary in (("types", "tsdown"), ("shared-state", "tsdown"), ("ui", "tsdown")):
        command = local_bin("packages", package, "node_modules", ".bin", binary)
        run([str(command)], env, cwd=REPO / "packages" / package)
    web_build = local_bin("apps", "web", "node_modules", ".bin", "react-router")
    run([str(web_build), "build"], env, cwd=REPO / "apps" / "web")


def publish() -> Path:
    if not (BUILD / "index.html").is_file():
        fail(f"构建产物不存在：{BUILD / 'index.html'}")
    lab_bundles = [
        path for path in (BUILD / "assets").glob("*.js") if MARKER in path.read_text(errors="ignore")
    ]
    if not lab_bundles:
        fail("构建产物中没有找到新的界面代码，停止发布。")

    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "assets").mkdir(parents=True, exist_ok=True)
    backup = Path("/tmp") / f"plane-index-before-finance-quality-{int(time.time())}.html"
    if (RUNTIME / "index.html").is_file():
        shutil.copy2(RUNTIME / "index.html", backup)

    # Hashed assets are additive. Keep previous hashes available for members
    # who still have the old entry page open.
    for item in (BUILD / "assets").iterdir():
        target = RUNTIME / "assets" / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    for item in BUILD.iterdir():
        if item.name == "index.html":
            continue
        target = RUNTIME / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    staged = RUNTIME / ".index.html.new"
    shutil.copy2(BUILD / "index.html", staged)
    os.chmod(staged, 0o644)
    os.replace(staged, RUNTIME / "index.html")
    return lab_bundles[0]


def read_url(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=15) as response:
        return response.status, response.read()


def smoke(lab_bundle: Path, backup: Path | None) -> None:
    try:
        status, html = read_url(f"{LOCAL_URL}/")
        if status != 200:
            fail(f"首页返回 {status}")
        entry = re.search(rb'assets/[^"\']+\.js', html)
        if not entry:
            fail("首页没有引用前端资源")
        asset_url = f"{LOCAL_URL}/{entry.group(0).decode()}"
        status, _ = read_url(asset_url)
        if status != 200:
            fail(f"入口资源返回 {status}：{asset_url}")
        status, body = read_url(f"{LOCAL_URL}/assets/{lab_bundle.name}")
        if status != 200 or MARKER.encode() not in body:
            fail("线上 lab-panel 资源尚未包含新的资金与质量界面")
        try:
            public_status, _ = read_url(f"{PUBLIC_URL}/")
            print(f"公网入口 HTTP {public_status}")
        except Exception as problem:  # noqa: BLE001 - public probe is informational
            print(f"公网入口探测跳过：{problem}")
    except Exception:
        if backup is not None and backup.is_file():
            shutil.copy2(backup, RUNTIME / "index.html")
            print(f"发布校验失败，已恢复原入口页：{backup}", file=sys.stderr)
        raise


def backup_before_deploy() -> tuple[str, Path, Path]:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    previous = git("rev-parse", "HEAD")
    tag = f"backup/pre-v6-{stamp}"
    try:
        git("tag", tag, previous)
        print(f"已创建回退标签：{tag} -> {previous}")
    except SystemExit as problem:
        print(f"回退标签创建失败，继续执行：{problem}", file=sys.stderr)
    source = Path("/tmp") / f"plane-source-before-v6-{stamp}.tar.gz"
    with tarfile.open(source, "w:gz") as archive:
        for relative in FILES:
            path = REPO / relative
            if path.exists():
                archive.add(path, arcname=relative)
    print(f"源文件备份：{source}")
    runtime = Path("/tmp") / f"plane-web-before-v6-{stamp}.tar.gz"
    with tarfile.open(runtime, "w:gz") as archive:
        archive.add(RUNTIME, arcname="web")
    print(f"运行目录备份：{runtime}")
    return previous, source, runtime


def main() -> None:
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        fail("请使用 sudo python3 /tmp/deploy-finance-quality.py 运行。")
    if not (REPO / ".git").is_dir():
        fail(f"不是 Git 仓库：{REPO}")
    if not RUNTIME.is_dir():
        fail(f"没有找到运行目录：{RUNTIME}")

    dirty = git("status", "--porcelain", "--untracked-files=no")
    if dirty:
        fail("部署仓库有未提交的已跟踪修改，请先处理：\n" + dirty)

    data = load_bundle()
    root = extract_bundle(data)
    try:
        head = git("rev-parse", "HEAD")
        subject = git("log", "-1", "--format=%s")
        current_finance = (REPO / "apps/web/core/components/lab/finance.tsx").read_text(errors="ignore")
        known = head == EXPECTED_HEAD or subject in (V1_SUBJECT, V2_SUBJECT, V3_SUBJECT, V4_SUBJECT, V5_SUBJECT, V6_SUBJECT, V7_SUBJECT, V8_SUBJECT, V9_SUBJECT, V10_SUBJECT, V11_SUBJECT, V12_SUBJECT, V13_SUBJECT, V14_SUBJECT, V15_SUBJECT, V16_SUBJECT, V17_SUBJECT, V18_SUBJECT) or V1_MARKER in current_finance
        if not known and not same_as_bundle(root):
            fail(
                f"当前提交 {head} 不是可识别的改版基线，且目标文件与改版包不一致，"
                "为避免覆盖后续改动已停止。请让维护者基于当前提交重放改版。"
            )
        if same_as_bundle(root):
            print("目标文件已是当前改版版本，跳过文件安装。")
        else:
            backup = backup_before_deploy()
            print(f"部署前备份完成：{backup[1]} / {backup[2]}")
            apply_files(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    migrate_backend()
    node = find_node()
    env = os.environ.copy()
    env["PATH"] = f"{node.parent}:{env.get('PATH', '')}"
    env["NODE_ENV"] = "production"
    env["CI"] = "true"
    env["TURBO_TELEMETRY_DISABLED"] = "1"
    print(f"使用 Node：{node}")
    build(env)
    commit_changes()
    lab_bundle = publish()
    backup_candidates = sorted(Path("/tmp").glob("plane-index-before-finance-quality-*.html"))
    backup = backup_candidates[-1] if backup_candidates else None
    smoke(lab_bundle, backup)
    print("部署完成。")
    print(f"提交：{git('rev-parse', 'HEAD')}")
    print(f"本地：{LOCAL_URL}")
    print(f"正式：{PUBLIC_URL}")
    print("旧的哈希资源仍保留，入口页已最后原子替换。")
    print("如需回退：")
    print(f"  git -C {REPO} reset --hard backup/pre-v6-<时间戳>   # 或 git revert HEAD")
    print("  运行目录可解压 /tmp/plane-web-before-v6-<时间戳>.tar.gz 到 .temp/lab-runtime/")
    print("  源文件备份在 /tmp/plane-source-before-v6-<时间戳>.tar.gz")


if __name__ == "__main__":
    main()
