#!/usr/bin/env python3
"""Run device tests, optionally against a signed release on an isolated emulator."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import re

parser = argparse.ArgumentParser()
parser.add_argument("--fixture", type=Path)
parser.add_argument("--ui", action="store_true", help="Run the real React UI acceptance class")
parser.add_argument("--skip-install", action="store_true", help="Reuse APKs already installed on this isolated emulator")
parser.add_argument("--serial", default="emulator-5558")
parser.add_argument("--variant", choices=("debug", "release"), default="debug")
parser.add_argument("--apk", type=Path, help="Use this exact target APK, for example the delivery artifact")
args = parser.parse_args()
if args.ui and args.fixture is None:
    parser.error("UI acceptance requires --fixture from an isolated backend")
if args.fixture is not None and not args.fixture.is_file():
    parser.error("Fixture must be an existing private file")
sdk = Path(os.environ["ANDROID_HOME"])
adb = [str(sdk / "platform-tools/adb"), "-s", args.serial]
root = Path(__file__).resolve().parents[2]
package = "org.openoceanacoustic.mobile"
if args.variant == "release":
    if not args.serial.startswith("emulator-"):
        parser.error("Release fixture checks require an isolated rooted emulator")
    subprocess.run(adb + ["root"], check=True)
    subprocess.run(adb + ["wait-for-device"], check=True)
target = args.apk or root / f"apps/mobile/android/app/build/outputs/apk/{args.variant}/app-{args.variant}.apk"
if not args.skip_install:
    subprocess.run(adb + ["install", "-r", str(target)], check=True)
    subprocess.run(adb + ["install", "-r", str(root / f"apps/mobile/android/app/build/outputs/apk/androidTest/{args.variant}/app-{args.variant}-androidTest.apk")], check=True)
fixture_name = "native-ui-fixture.json" if args.ui else "native-test-fixture.json"
fixture_path = f"/data/user/0/{package}/files/{fixture_name}"
try:
    if args.fixture:
        if args.variant == "release":
            owner = subprocess.check_output(adb + ["shell", "stat", "-c", "%u:%g", f"/data/user/0/{package}"], text=True).strip()
            if not re.fullmatch(r"\d+:\d+", owner):
                raise RuntimeError("Cannot determine isolated app data owner")
            subprocess.run(adb + ["shell", "mkdir", "-p", f"/data/user/0/{package}/files"], check=True)
            subprocess.run(adb + ["shell", "chown", owner, f"/data/user/0/{package}/files"], check=True)
            subprocess.run(adb + ["shell", "chmod", "700", f"/data/user/0/{package}/files"], check=True)
            subprocess.run(adb + ["shell", "sh", "-c", f"'cat > {fixture_path}'"], input=args.fixture.read_bytes(), check=True)
            subprocess.run(adb + ["shell", "chown", owner, fixture_path], check=True)
            subprocess.run(adb + ["shell", "chmod", "600", fixture_path], check=True)
        else:
            subprocess.run(adb + ["shell", "run-as", package, "mkdir", "-p", "files"], check=True)
            subprocess.run(adb + ["shell", "run-as", package, "sh", "-c", f"'cat > files/{fixture_name}'"], input=args.fixture.read_bytes(), check=True)
    selection = ["-e", "class", f"{package}.NativeUiInstrumentedTest", "-e", "timeoutSeconds", "600"] if args.ui else ["-e", "class", f"{package}.NativeBackendInstrumentedTest,{package}.SessionVaultInstrumentedTest"]
    with subprocess.Popen(adb + ["shell", "am", "instrument", "-w", "-r"] + selection + [f"{package}.test/androidx.test.runner.AndroidJUnitRunner"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        chunks = []
        for line in process.stdout:
            print(line, end="", flush=True)
            chunks.append(line)
        returncode = process.wait()
    output = "".join(chunks)
    if returncode != 0 or "FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output or "OK (" not in output or (args.fixture and "INSTRUMENTATION_STATUS_CODE: -3" in output):
        sys.exit(1)
finally:
    cleanup = ["shell", "rm", "-f", fixture_path] if args.variant == "release" else ["shell", "run-as", package, "rm", "-f", f"files/{fixture_name}"]
    subprocess.run(adb + cleanup, check=False)
