# Android build and native bridge

The app packages `apps/mobile/dist` locally. It never loads a remote deployment as its UI.
Requirements: Node 22+, pnpm 11, JDK 21, Android SDK platform/build-tools 36 and the Gradle wrapper.
Capacitor Android 8 supports Android 7/API 24 and later. This app requires System WebView 95+
for its bundled React frontend; older providers show a native update prompt instead of a blank screen.
Android 7 can use Chromium 119; [Chromium's support notice](https://groups.google.com/a/chromium.org/g/chromium-dev/c/B9AYI3WAvRo)
identifies 119 as its final release for that OS.

```sh
pnpm install --frozen-lockfile
export JAVA_HOME=/absolute/path/to/jdk-21
export ANDROID_HOME=/absolute/path/to/android-sdk
# Create this once. Keep the directory and its backup for all future updates.
tools/mobile/create-release-key.sh /private/path/to/ooa-release
export OOA_ANDROID_SIGNING_FILE=/private/path/to/ooa-release/signing.properties
tools/mobile/build-apk.sh /absolute/path/to/output --skip-tests
```

Signing properties and the keystore are private files, excluded from Git. A new key cannot update an
installed APK signed by the old key. Back up the private directory separately from the source.
The build script installs pinned dependencies, builds workspace dependencies and the mobile frontend,
syncs local assets, verifies APK signatures and writes a SHA-256 checksum. It does not publish assets,
install the APK, or change any running server. Use `adb install -r <output>/OpenOceanAcoustic-1.0.4.apk`
to install/update; deployment URLs must be reachable from the Android device.

## JavaScript interface

Register `MobileTransport` using `registerPlugin` from `@capacitor/core`.

- `request({server,path,method?,data?,headers?,responseType?,bodyEncoding?})` returns `{status,data,headers}`.
  The selected server must be a root HTTP/HTTPS origin. Ordinary requests stay within that origin.
  `responseType` is `json` (default), `text` or `base64`; `bodyEncoding:'base64'` accepts small binary bodies.
  Pass the backend CSRF token as `X-CSRFToken`. Cookies are entirely native and are never returned.
- `clearSession({server?})` removes native credentials and attachment caches. Omit the server to clear all origins.
- `pickFile({mimeType?})` invokes Android's document picker and returns `{fileId,name,mimeType,size}`.
- `uploadFile({server,path,fileId,method?,headers?,fields?,fileField?,signed?})` streams a chosen file.
  `signed` defaults to true and strips credentials/CSRF headers. With `fields`, upload uses multipart POST;
  without fields, it sends raw bytes using PUT. After upload, call the backend's confirmation endpoint.
- `download({server,path,name?,headers?})` downloads into private cache and opens a granted content URI.
  It returns `{status,name,uri,mimeType,opened}`. An error HTTP status returns the normal response shape.
  `opened:false` means no installed viewer supports that type; display that result to the user.
- `insets()` returns `{top,bottom,left,right,keyboard}` in CSS pixels. Native also sets `--native-inset-*`
  CSS variables and emits the `mobileInsets` window event.
- `setAppearance({dark})` matches real status/navigation bars to the current theme.

Sessions are scoped by origin and persisted with an AES-GCM key in Android Keystore. Authenticated
GET redirects may fetch external attachments after removing cookies and CSRF/authorization headers;
cross-origin write redirects are refused. Attachment content is streamed, not stored in JavaScript.
The FileProvider exposes only the private downloads directory for granted viewer intents.
Native failure diagnostics contain only a fixed operation name, error category and exception class;
request values, exception messages, credentials and stack traces are omitted. Session storage failures
return `MOBILE_SESSION_STORAGE` separately from network or file failures.

## Tests

```sh
cd apps/mobile/android
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
# On an attached device/emulator, verify the real Android Keystore as well:
./gradlew :app:connectedDebugAndroidTest
# Or run both device tests against a private isolated-backend fixture (never commit it):
cd ../../..
ANDROID_HOME=/absolute/path/to/sdk tools/mobile/run-device-checks.py --fixture /private/fixture.json
# To test the exact signed delivery APK, build a test APK with the same private signing properties:
cd apps/mobile/android
./gradlew -PmobileTestBuildType=release :app:assembleReleaseAndroidTest
cd ../../..
ANDROID_HOME=/absolute/path/to/sdk tools/mobile/run-device-checks.py --variant release \
  --apk /absolute/output/OpenOceanAcoustic-1.0.2.apk --fixture /private/fixture.json
# After the exact delivery APK and the matching test APK are installed:
ANDROID_HOME=/absolute/path/to/sdk tools/mobile/run-device-checks.py --variant release \
  --skip-install --ui --fixture /private/fixture.json
```

Native transport tests use real local HTTP servers at the public HTTP seam. They cover cookie restart,
origin isolation, redirects, signed upload credential isolation and cookie expiry/path behavior.
Release fixture checks require an isolated rooted emulator because release apps disable `run-as`.
The helper writes the fixture only into the target app's private directory and removes it afterward.
The default instrumentation build type remains debug; `mobileTestBuildType` changes test packaging only.

UI acceptance runs MainActivity and controls its bundled React DOM through WebView, including real
server selection, login, task navigation, native back, a profile write verified with native HTTP,
light/dark themes and Activity/Bridge recreation with the persisted session. It does not enable
WebView debugging or add a product test mode. Fixtures are required and skipped UI tests fail the
helper. Authenticated home screenshots are saved under the app external files directory in
`native-ui-evidence`; login forms and credentials are not captured.

## Android 1.0.1 delivery

Version 1.0.1 uses Android versionCode 2 and the retained release signing key, so it can update
version 1.0.0 while preserving app data. God Mode writes that require renewed authentication open
a six-digit code sheet. Concurrent writes share the same renewal, cancellation keeps the original
form, and success replays each original request once without changing its body or idempotency key.
An incorrect renewal code stays in the sheet; an invalid session returns to administrator login.

The 1.0.1 delivery uses compilation, packaging and signature verification only. Previously recorded
business, browser and emulator checks apply to 1.0.0; they are not acceptance results for 1.0.1.
The user performs APK testing. `--skip-tests` excludes the Gradle unit test task. The default build
still includes it. `--skip-dependencies` is only for an integration workspace whose shared package
outputs are already built; omit it when rebuilding a clean checkout. APK filenames follow
`apps/mobile/package.json` version rather than a hard-coded prior release.
