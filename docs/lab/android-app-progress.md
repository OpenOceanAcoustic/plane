# Latest status: Android 1.0.2 V4 alignment

The earlier sections below are historical evidence for 1.0.0 and 1.0.1. They do not verify the current APK. Following the user instruction to self-test, no business, unit, device-installation or emulator tests are run for 1.0.2. Current checks cover types, lint, formatting, builds, signed APK metadata, and read-only browser visual rendering with fixture data. God Mode is removed from mobile; computer Web administration and one-time SSH registration links remain. See [V4 alignment](android-v4-alignment.md) and [current delivery](android-delivery.md).

# Android delivery record

Baseline: `98c234c4227e5265cb3f2a97ab3ae4469c67af1c`. Specification: [android-app-spec.md](android-app-spec.md).

| Ticket | Outcome                                                                                                | State                               |
| ------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1      | Native bootstrap, server configuration, real authentication, encrypted session and export restrictions | implemented                         |
| 2      | Workspaces, projects, tasks and attachments                                                            | implemented                         |
| 3      | Personal/team planning                                                                                 | implemented                         |
| 4      | Collaborative documents and Space                                                                      | implemented                         |
| 5      | Bounties and acceptance                                                                                | implemented                         |
| 6      | Finance, analytics and My Projects & VC                                                                | implemented                         |
| 7      | Settings and God Mode                                                                                  | implemented                         |
| 8      | Coverage, integration, reviews and signed APK                                                          | delivered; UI acceptance handed off |

Verification results must be appended with exact commands and actual environments. A state is completed only after its acceptance criteria pass.

## Verified before release

- `pnpm --filter @ooa/mobile test`: 24/24 public-boundary unit tests passed (transport 8, core 5, Lab/Workspace 5, settings 6).
- `pnpm --filter @ooa/mobile check:types` and `check:lint`: passed, 0 lint warnings/errors. Formatting is checked again after the final review fixes.
- `pnpm --filter @ooa/mobile build`: passed; all internal workspace dependencies were separately rebuilt by the native build agent.
- `MOBILE_PREVIEW_URL=http://127.0.0.1:4323 node apps/mobile/tests/e2e-contract.mjs`: 9 actual app/actual backend flows passed, with no page errors. This is desktop Chromium at 412×915 and 360×800, not an Android device. It includes first connection, real dynamic-code sign-in, project/task navigation, workspace/planner/finance/VC, persisted dark/light theme, two live Yjs clients synchronizing body and title, session restart, Space vote/comment and independent God Mode login/logout.
- Business verification: 26 mocked HTTP browser contracts, 24 isolated real HTTP role/workflow checks and 5 React + real HTTP flows. See `android-business-validation.md` for exact boundaries.
- API/mobile contracts: 42 tests passed in isolated Docker backend; Live 43 passed including an actual Hocuspocus ticket→authentication→document-load regression. Core actual backend contract: 78 HTTP requests passed; detailed commands in `android-core-coverage.md`.
- Android 7/API24 x86_64 software emulator: APK installed, actual Keystore encryption/restore/isolation/clear and real backend native HTTP sign-in/session/profile roundtrip/replay/export checks passed (2 instrumentation tests). Its stock WebView is unsupported; React UI is being verified on a modern system image. No physical-device testing is claimed.

Final emulator UI, dual-axis review, final release signature and artifact SHA-256 are recorded below only after they complete.

## Final review fixes and regression checks

- Mobile unit tests: **26/26 in 7 files** passed after all review corrections; complete TypeScript, lint (zero warnings) and source formatting checks passed.
- API contracts: **44** passed, including canonical/legacy intake feature compatibility; actual core backend contract now exercises **83** HTTP requests. Live remains **43** passing tests; its production code was unchanged by the final frontend review.
- Real backend browser regressions for project description retention, canonical feature on/off and public Space state/member/label resolution passed. Rapid consecutive project edits were independently reproduced RED, then verified GREEN with a delayed background detail request.
- `MOBILE_PREVIEW_URL=http://127.0.0.1:4325 node apps/mobile/tests/review/contract.mjs`: **4** regressions passed (foreground refresh, nested sheets, mixed Sheet/LabDialog stack, in-flight form dismissal guard). Initial runs reproduced stale foreground data and multiple-sheet dismissal.
- Full app browser acceptance covers **13 unique flows in separate successful runs**: 12 real-backend flows plus the remaining no-workspace flow using a reused independent-account session. It is **not one uninterrupted 13-flow run**. The empty-workspace test mocks only the membership response as `[]`, checks personal settings/God Mode login/real Space details, and verifies actual memberships remain intact afterwards. God Mode real login/configuration/logout passed in the 12-flow run; subsequent repeated-login attempts hit the real 429 limiter, which was not reset or bypassed.
- Native JVM tests: **7/7**; native lint has zero errors (two non-security dependency/resource advisories). Safe diagnostics tests verify that credentials and exception messages never appear in logs.
- [Independent Standards/Spec findings and resolutions](android-review.md). The Spec follow-up confirmed the other corrections and found the rapid-edit cache case, which was then fixed and tested. The original intake-alias concern was retracted after reading the actual endpoint mapping.

## Exact release Android verification

- Delivered product source: `aa8a20b106e3d1dc16f4f4fb4011e470b162e588`; subsequent device-test support does not change the application bundle.
- The signed release APK is **4,287,739 bytes**; SHA-256: `fd684efe685e663d2a6a40d8a801c6c2b92ce310a851c8a6da121f7bd7324441`. `apksigner verify --verbose --print-certs` passed with v2 signing, RSA 3072 and certificate SHA-256 `6fab1f84864c680f21c34e5551005faba32ba8074a7ca9ed236e22faf9f3bed5`. Independent checksum and manifest checks passed.
- **Android 13/API33 AOSP default x86_64 emulator**, AVD `ooa_api33`, software-only TCG/SwiftShader, 480×800 pixels at density 213, bundled **WebView 101.0.4951.61**. Exact delivered release APK and a separately signed test APK installed successfully; the installed `base.apk` was independently read back and its hash matches the delivery file.
- **2/2 native instrumentation tests passed on that signed release**: actual Keystore encryption/restore/origin isolation/clear, real mobile dynamic-code sign-in, Android session and export capability, project query, profile write/read/restore, dynamic-code replay rejection and session-clear rejection. The isolated backend was reached through `adb reverse tcp:18100 tcp:18100` and a private localhost fixture because this software emulator did not acquire a network route. This is actual native HTTP, not a mocked response.
- Public evidence: delivery `evidence/api33-release-native-tests.log` and `evidence/device-installed-apk.json`. The signing key and private backend fixtures are outside Git and the delivery folder.

## Delivery and user acceptance handoff

On **2026-10-10**, the user explicitly instructed: “不用测试了，我自己测试”. Further tests and emulator diagnosis were stopped; isolated emulator test fixtures were removed and the emulator was shut down. Implementation and the signed APK are delivered. Remaining Android React UI acceptance is **handed off to the user**, rather than marked as passed.

The API33 UI instrumentation did not complete: its stock WebView 101 renderer crashed during initialization. No passing UI business loop or authenticated screenshot is claimed. API36/Google APIs software emulation also encountered system watchdog/ANR delays; its diagnostic screenshot is explicitly named `api36-initial-launch-not-accepted.png`. The unsuccessful API33 attempt is recorded in delivery `evidence/api33-release-ui-not-accepted.log`. No physical-device tests were performed.

The implemented UI test class, including Activity/Bridge session restoration, was compiled before the failed attempt. The final additional stage logging and streamed helper output were not recompiled or rerun after the user's stop instruction; they do not change the delivered APK. Earlier native, API, Live and browser results above remain valid within their stated boundaries.

Delivery folder: `/mnt/repo/ly/android-delivery/OpenOceanAcoustic-1.0.0/`, containing the APK, SHA-256 file, verified signature, install guide, build metadata and public evidence. Persistent signing materials are outside Git at `/mnt/repo/ly/.android-release/`. Production services and deployed Web/Admin files were not replaced; install the updated API and Live source before connecting a phone.
