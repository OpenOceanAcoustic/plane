#!/usr/bin/env python3
"""Publish the worker-first finance and quality workbench.

Run on the deployment host as root:

    sudo python3 /tmp/deploy-finance-quality.py

The script downloads a signed workbench bundle from the review gist, checks the
deployment is based on the expected commit, installs the source files, builds
the web client with the repository toolchain, commits the source change, and
publishes the static bundle. Hashed assets are additive; index.html is replaced
last after a production smoke test.
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

GIST_OWNER = "Perry44001"
GIST_ID = "7bd653c46cbc51c6b8ea4b822739a1b8"
BUNDLE_NAME = "finance-quality.tar.gz.b64"
BUNDLE_SHA256 = "5af39eb55090447fa5d4f10dac3f29c7531f267cb06f19c6799de3e1bdb06b81"
EXPECTED_HEAD = "7cdc5282ae82baae5845feef579feb2a5bbc255a"
MARKER = "资料完成度"
COMMIT_MESSAGE = "feat: add worker-first finance and quality workbenches"

FILES = (
    "apps/web/core/components/lab/finance.tsx",
    "apps/web/core/components/lab/finance-workbench.tsx",
    "apps/web/core/components/lab/project-quality.tsx",
    "apps/web/core/components/lab/workbench.css",
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


def download_bundle() -> bytes:
    url = f"https://gist.githubusercontent.com/{GIST_OWNER}/{GIST_ID}/raw/{BUNDLE_NAME}?{int(time.time())}"
    print(f"下载改版包：{url}")
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            encoded = response.read()
        data = base64.b64decode(b"".join(encoded.split()), validate=True)
    except Exception as problem:  # noqa: BLE001 - report network/format failures together
        fail(f"下载或解码改版包失败：{problem}")
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
        path for path in (BUILD / "assets").glob("lab-panel-*.js") if MARKER in path.read_text(errors="ignore")
    ]
    if not lab_bundles:
        fail("构建产物中没有新的质量工作台代码，停止发布。")

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

    data = download_bundle()
    root = extract_bundle(data)
    try:
        head = git("rev-parse", "HEAD")
        if head != EXPECTED_HEAD and not same_as_bundle(root):
            fail(
                f"当前提交 {head} 与改版基线 {EXPECTED_HEAD} 不一致，"
                "为避免覆盖后续改动已停止。请让维护者基于当前提交重放改版。"
            )
        if head == EXPECTED_HEAD:
            apply_files(root)
        else:
            print("当前提交不是基线，但目标文件已是改版版本；只重新构建与发布。")
    finally:
        shutil.rmtree(root, ignore_errors=True)

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


if __name__ == "__main__":
    main()
