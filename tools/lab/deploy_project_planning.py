#!/usr/bin/env python3
"""Publish the multi-level project planning board.

Run on the deployment host as root:

    sudo python3 /tmp/deploy-project-planning.py

The installer applies the planning bundle, validates the Django app, builds the
web client, restarts only the API container (the API source is bind-mounted),
commits the source change, and publishes the static bundle. If the API does not
come back healthy, it restores the previous gantt.py and restarts the API before
stopping.
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
COMPOSE_PROJECT = os.environ.get("PLANE_COMPOSE_PROJECT", "ooa-plane-lab")

GIST_OWNER = "Perry44001"
GIST_ID = "b638831af92a3c8d5755b1400b7bd43d"
BUNDLE_NAME = "project-planning.tar.gz.b64"
BUNDLE_SHA256 = "22a855bdcd725fde7b387f1a81aae626086f146b4d5cfa49183cc2a213c948b6"
EXPECTED_BASE = "ec96346e773b101c263ba99d4eae6077f092b811"
MARKER = "lab-planning-table-row"
COMMIT_MESSAGE = "feat: add multi-level project planning board"

FILES = (
    "apps/web/core/components/home/home-workbench.tsx",
    "apps/web/core/components/home/home-workbench.css",
    "apps/web/core/components/lab/calendar.tsx",
    "apps/web/core/components/lab/sections.ts",
    "apps/web/core/components/lab/panel.tsx",
    "apps/web/core/components/lab/theme.css",
    "apps/web/core/components/lab/gantt-helpers.ts",
    "apps/web/core/components/lab/project-planning.tsx",
    "apps/web/core/components/lab/project-planning.css",
    "apps/web/core/components/navigation/use-navigation-items.ts",
    "apps/web/core/components/workspace/sidebar/project-navigation.tsx",
    "apps/api/plane/lab/gantt.py",
    "docs/lab/home-workbench.md",
    "docs/lab/project-planning.md",
)
SELF_DEST = REPO / "tools/lab/deploy_project_planning.py"
COMMIT_PATHS = (*FILES, "tools/lab/deploy_project_planning.py")
MANAGED_PATHS = set(COMMIT_PATHS)
BACKEND_FILE = REPO / "apps/api/plane/lab/gantt.py"


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


def run(command: list[str], env: dict[str, str], cwd: Path = REPO, check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(command), flush=True)
    return subprocess.run(command, cwd=cwd, env=env, check=check, text=True)


def compose_command() -> list[str]:
    command = ["docker", "compose", "-p", COMPOSE_PROJECT, "-f", "compose.lab.yml"]
    if (REPO / ".temp/lab-runtime/compose.proxy.yml").is_file():
        command += ["-f", ".temp/lab-runtime/compose.proxy.yml"]
    return command


def download_bundle() -> tuple[bytes, str]:
    url = f"https://gist.githubusercontent.com/{GIST_OWNER}/{GIST_ID}/raw/{BUNDLE_NAME}?{int(time.time())}"
    print(f"下载项目规划改版包：{url}")
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            encoded = response.read()
        data = base64.b64decode(b"".join(encoded.split()), validate=True)
    except Exception as problem:  # noqa: BLE001 - report network/format failures together
        fail(f"下载或解码项目规划改版包失败：{problem}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != BUNDLE_SHA256:
        fail(f"项目规划改版包校验失败：期望 {BUNDLE_SHA256}，实际 {digest}")
    print(f"项目规划改版包校验通过：{digest}")
    return data, digest


def extract_bundle(data: bytes) -> Path:
    root = Path(tempfile.mkdtemp(prefix="plane-project-planning-"))
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


def backup_sources() -> tuple[Path, set[str]]:
    archive = Path("/tmp") / f"plane-planning-source-{int(time.time())}.tar.gz"
    existing = [relative for relative in COMMIT_PATHS if (REPO / relative).is_file()]
    missing = set(COMMIT_PATHS) - set(existing)
    if existing:
        with tarfile.open(archive, mode="w:gz") as bundle:
            for relative in existing:
                bundle.add(REPO / relative, arcname=relative)
    return archive, missing


def restore_sources(archive: Path, missing: set[str]) -> None:
    for relative in missing:
        target = REPO / relative
        if target.is_file():
            target.unlink()
    if not archive.is_file():
        return
    print(f"恢复安装前的源文件：{archive}", file=sys.stderr)
    with tarfile.open(archive, mode="r:gz") as bundle:
        try:
            bundle.extractall(REPO, filter="data")
        except TypeError:
            bundle.extractall(REPO)


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


def build(env: dict[str, str]) -> None:
    for package, binary in (("types", "tsdown"), ("shared-state", "tsdown"), ("ui", "tsdown")):
        command = local_bin("packages", package, "node_modules", ".bin", binary)
        run([str(command)], env, cwd=REPO / "packages" / package)
    web_build = local_bin("apps", "web", "node_modules", ".bin", "react-router")
    run([str(web_build), "build"], env, cwd=REPO / "apps" / "web")


def wait_for_api(env: dict[str, str], attempts: int = 30) -> bool:
    health = f"{LOCAL_URL}/api/instances/"
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(health, timeout=5) as response:
                if response.status == 200:
                    print(f"API 健康检查通过（第 {attempt + 1} 次）")
                    return True
        except Exception:  # noqa: BLE001 - retry until the container is ready
            pass
        time.sleep(2)
    return False


def publish() -> Path:
    if not (BUILD / "index.html").is_file():
        fail(f"构建产物不存在：{BUILD / 'index.html'}")
    planning_bundles = [
        path
        for path in (BUILD / "assets").glob("lab-panel-*.js")
        if MARKER in path.read_text(errors="ignore")
    ]
    if not planning_bundles:
        fail("构建产物中没有项目规划页面，停止发布。")

    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "assets").mkdir(parents=True, exist_ok=True)
    backup = Path("/tmp") / f"plane-index-before-planning-{int(time.time())}.html"
    if (RUNTIME / "index.html").is_file():
        shutil.copy2(RUNTIME / "index.html", backup)

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
    return planning_bundles[0]


def read_url(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=15) as response:
        return response.status, response.read()


def smoke(planning_bundle: Path, backup: Path | None, env: dict[str, str]) -> None:
    try:
        if not wait_for_api(env, attempts=10):
            fail("API 健康检查未通过")
        status, html = read_url(f"{LOCAL_URL}/")
        if status != 200:
            fail(f"首页返回 {status}")
        entry = re.search(rb'assets/[^"\']+\.js', html)
        if not entry:
            fail("首页没有引用前端资源")
        status, _ = read_url(f"{LOCAL_URL}/{entry.group(0).decode()}")
        if status != 200:
            fail("入口资源无法访问")
        status, body = read_url(f"{LOCAL_URL}/assets/{planning_bundle.name}")
        if status != 200 or MARKER.encode() not in body:
            fail("线上资源尚未包含项目规划页面")
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


def main() -> None:
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        fail("请使用 sudo python3 /tmp/deploy-project-planning.py 运行。")
    if not (REPO / ".git").is_dir():
        fail(f"不是 Git 仓库：{REPO}")
    if not RUNTIME.is_dir():
        fail(f"没有找到运行目录：{RUNTIME}")
    if not (REPO / "apps/web/core/components/home/home-workbench.tsx").is_file():
        fail("当前仓库还没有首页工作台；请先部署首页改版。")
    if not BACKEND_FILE.is_file():
        fail(f"缺少后端文件：{BACKEND_FILE}")
    if shutil.which("docker") is None:
        fail("找不到 docker 命令；本安装器需要重启 API 容器。")

    dirty = git("status", "--porcelain", "--untracked-files=no")
    if dirty:
        fail("部署仓库有未提交的已跟踪修改，请先处理：\n" + dirty)

    data, _digest = download_bundle()
    root = extract_bundle(data)
    try:
        head = git("rev-parse", "HEAD")
        if head != EXPECTED_BASE:
            ancestor = subprocess.run(
                ["git", "-c", f"safe.directory={REPO}", "merge-base", "--is-ancestor", EXPECTED_BASE, head],
                cwd=REPO,
            )
            if ancestor.returncode != 0:
                fail(f"当前提交 {head} 不是项目规划基线的后代，已停止。")
            changed = [path for path in git("diff", "--name-only", EXPECTED_BASE, head).splitlines() if path]
            overlap = [path for path in changed if path in FILES]
            if overlap and not same_as_bundle(root):
                fail(
                    "基线与当前提交之间修改了本次要安装的文件，已停止：\n" + "\n".join(overlap)
                )
        backup_archive, missing = backup_sources()
        try:
            apply_files(root)
        except Exception:
            restore_sources(backup_archive, missing)
            raise
    finally:
        shutil.rmtree(root, ignore_errors=True)

    node = find_node()
    env = os.environ.copy()
    env["PATH"] = f"{node.parent}:{env.get('PATH', '')}"
    env["NODE_ENV"] = "production"
    env["CI"] = "true"
    env["TURBO_TELEMETRY_DISABLED"] = "1"
    compose = compose_command()
    print(f"使用 Node：{node}")

    check = run(compose + ["exec", "-T", "api", "python", "manage.py", "check"], env, check=False)
    if check.returncode != 0:
        restore_sources(backup_archive, missing)
        fail("Django 检查未通过，已恢复安装前的源文件，未重启服务。")
    build(env)

    restart = run(compose + ["restart", "api"], env, check=False)
    if restart.returncode != 0 or not wait_for_api(env):
        restore_sources(backup_archive, missing)
        run(compose + ["restart", "api"], env, check=False)
        wait_for_api(env, attempts=15)
        fail("API 重启后未通过健康检查，已恢复安装前的源文件并重启 API。")
    commit_changes()
    planning_bundle = publish()
    backup_candidates = sorted(Path("/tmp").glob("plane-index-before-planning-*.html"))
    index_backup = backup_candidates[-1] if backup_candidates else None
    smoke(planning_bundle, index_backup, env)
    print("项目规划部署完成。")
    print(f"提交：{git('rev-parse', 'HEAD')}")
    print(f"本地：{LOCAL_URL}")
    print(f"正式：{PUBLIC_URL}")
    print("API 已重启；旧的哈希资源仍保留，入口页已最后原子替换。")


if __name__ == "__main__":
    main()
