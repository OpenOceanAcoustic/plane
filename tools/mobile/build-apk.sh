#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="${1:-$task_root/.temp/android-release}"
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
pnpm --filter '@ooa/mobile^...' --if-present run build
pnpm --filter @ooa/mobile build
cd apps/mobile
pnpm exec cap sync android
cd android
./gradlew --no-daemon :app:testDebugUnitTest :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk "$output_dir/OpenOceanAcoustic-1.0.0.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$output_dir/OpenOceanAcoustic-1.0.0.apk" >"$output_dir/signature-verification.txt"
cd "$output_dir"
sha256sum OpenOceanAcoustic-1.0.0.apk >OpenOceanAcoustic-1.0.0.apk.sha256
echo "Signed APK: $output_dir/OpenOceanAcoustic-1.0.0.apk"
