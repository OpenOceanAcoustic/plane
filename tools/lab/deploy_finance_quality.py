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

BUNDLE_SHA256 = "d67dc7296fe2a00adb45fb1a763227c9050df892f0af13de5ac52c54a2995b72"
# The reviewed workbench bundle is embedded so deployment never needs a second
# network request. Run this file once; it is a complete snapshot.
BUNDLE_B64 = """
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
"""
EXPECTED_HEAD = "7cdc5282ae82baae5845feef579feb2a5bbc255a"
MARKER = "资料完成度"
COMMIT_MESSAGE = "fix: pass slug to time agent views"
V19_SUBJECT = "fix: harden time agent errors"
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
        known = head == EXPECTED_HEAD or subject in (V1_SUBJECT, V2_SUBJECT, V3_SUBJECT, V4_SUBJECT, V5_SUBJECT, V6_SUBJECT, V7_SUBJECT, V8_SUBJECT, V9_SUBJECT, V10_SUBJECT, V11_SUBJECT, V12_SUBJECT, V13_SUBJECT, V14_SUBJECT, V15_SUBJECT, V16_SUBJECT, V17_SUBJECT, V18_SUBJECT, V19_SUBJECT) or V1_MARKER in current_finance
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
