#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir=""
skip_tests=false
skip_dependencies=false
for argument in "$@"; do
  case "$argument" in
    --skip-tests) skip_tests=true ;;
    --skip-dependencies) skip_dependencies=true ;;
    --help)
      echo 'Usage: build-apk.sh [output-directory] [--skip-tests] [--skip-dependencies]'
      exit 0
      ;;
    --*) echo 'Unknown build option.' >&2; exit 1 ;;
    *)
      if [ -n "$output_dir" ]; then
        echo 'Only one output directory is allowed.' >&2
        exit 1
      fi
      output_dir="$argument"
      ;;
  esac
done
output_dir="${output_dir:-$task_root/.temp/android-release}"
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 21 installation}"
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK 36 installation}"
: "${OOA_ANDROID_SIGNING_FILE:?Set OOA_ANDROID_SIGNING_FILE to private signing properties}"
if [ ! -f "$OOA_ANDROID_SIGNING_FILE" ]; then
  echo 'Private signing properties do not exist.' >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
cd "$task_root"
pnpm install --frozen-lockfile
if [ "$skip_dependencies" = false ]; then
  pnpm --filter '@ooa/mobile^...' --if-present run build
fi
pnpm --filter @ooa/mobile build
mobile_version="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8")).version)')"
if [[ ! "$mobile_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Invalid mobile release version.' >&2
  exit 1
fi
apk_name="OpenOceanAcoustic-$mobile_version.apk"
cd apps/mobile
pnpm exec cap sync android
cd android
if [ "$skip_tests" = true ]; then
  ./gradlew --no-daemon :app:assembleRelease
else
  ./gradlew --no-daemon :app:testDebugUnitTest :app:assembleRelease
fi
cp app/build/outputs/apk/release/app-release.apk "$output_dir/$apk_name"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$output_dir/$apk_name" >"$output_dir/signature-verification.txt"
cd "$output_dir"
sha256sum "$apk_name" >"$apk_name.sha256"
echo "Signed APK: $output_dir/$apk_name"
