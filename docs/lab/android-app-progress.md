# Android delivery record

Baseline: `98c234c4227e5265cb3f2a97ab3ae4469c67af1c`. Specification: [android-app-spec.md](android-app-spec.md).

| Ticket | Outcome                                                                                                | State       |
| ------ | ------------------------------------------------------------------------------------------------------ | ----------- |
| 1      | Native bootstrap, server configuration, real authentication, encrypted session and export restrictions | in progress |
| 2      | Workspaces, projects, tasks and attachments                                                            | in progress |
| 3      | Personal/team planning                                                                                 | in progress |
| 4      | Collaborative documents and Space                                                                      | in progress |
| 5      | Bounties and acceptance                                                                                | in progress |
| 6      | Finance, analytics and My Projects & VC                                                                | in progress |
| 7      | Settings and God Mode                                                                                  | in progress |
| 8      | Coverage, integration, reviews and signed APK                                                          | pending     |

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

Modern Android release UI acceptance is still pending: software-only emulators encountered system watchdog/ANR delays. APK signing alone does not complete ticket 8.
