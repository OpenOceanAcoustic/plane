#!/usr/bin/env python3
"""Run debug device tests, optionally with an isolated backend's private fixture."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--fixture", type=Path)
parser.add_argument("--serial", default="emulator-5558")
args = parser.parse_args()
sdk = Path(os.environ["ANDROID_HOME"])
adb = [str(sdk / "platform-tools/adb"), "-s", args.serial]
root = Path(__file__).resolve().parents[2]
package = "org.openoceanacoustic.mobile"
subprocess.run(adb + ["install", "-r", str(root / "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk")], check=True)
subprocess.run(adb + ["install", "-r", str(root / "apps/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk")], check=True)
if args.fixture:
    subprocess.run(adb + ["shell", "run-as", package, "mkdir", "-p", "files"], check=True)
    subprocess.run(adb + ["shell", "run-as", package, "sh", "-c", "'cat > files/native-test-fixture.json'"], input=args.fixture.read_bytes(), check=True)
try:
    result = subprocess.run(adb + ["shell", "am", "instrument", "-w", "-r", f"{package}.test/androidx.test.runner.AndroidJUnitRunner"], check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout)
    if "FAILURES!!!" in result.stdout or "INSTRUMENTATION_FAILED" in result.stdout or "OK (" not in result.stdout:
        sys.exit(1)
finally:
    subprocess.run(adb + ["shell", "run-as", package, "rm", "-f", "files/native-test-fixture.json"], check=False)
