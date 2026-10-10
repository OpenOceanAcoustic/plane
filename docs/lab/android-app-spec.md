# Android application specification

Approved by the user on 2026-10-10. Comparison baseline: `98c234c4227e5265cb3f2a97ab3ae4469c67af1c`. Implementation branch: `feat/android-app`; isolated checkout: `/mnt/repo/ly/plane-android`.

## Delivery

Add `apps/mobile` to this repository: an independent React mobile frontend, Capacitor 8.0.0, Java 21, compile/target SDK 36 and minimum SDK 24. Application name `OpenOceanAcoustic`, package `org.openoceanacoustic.mobile`, version `1.0.0`. Deliver one signed release APK after all eight tickets pass, its SHA-256, installation and reproducible build instructions. Keep the persistent signing key outside Git. Do not replace the current deployed web/admin assets or use production data for tests.

Use the approved V4 design: neutral surfaces, clear type hierarchy, large touch targets, Home/Inbox/Search capsule navigation, task property chips and bottom sheets. Use actual Android system bars. Wide business tables become vertical records; month calendars retain seven columns at 360 and 412 CSS pixels. Light/dark themes, keyboard insets, Android back, file selection and foreground refresh are included.

## Functional scope

The first release covers main application, independently authenticated God Mode, Space shared pages and My Projects & VC. Include workspace/project/task operations, comments, attachments, links, relations, cycles, modules, views, personal/team planning, folders, activity categories, referenced tasks, custom fields, timeline preview/commit, collaborative documents, material bindings, bounty application/division/delivery/acceptance/review/contributions, funding/pools/grants/payments/reversals/approvals/statistics and user/workspace/project/instance settings. Every exposed action has a real endpoint-backed behavior. Enforce backend roles, allowed actions and restricted bounty materials.

Online writes and existing in-app notifications are included. Offline write queues, additional OS push, iOS and app-store submission are excluded.

## Integration contracts

First launch accepts an HTTP intranet or HTTPS deployment root. Verify `/api/instances/` advertises `mobile_api_version: 1`. Changing server clears both sessions, business caches and navigation. Native HTTP owns cookies, CSRF and attachment transfer; encrypt persisted cookie material with Android Keystore. Cookie values are never returned to JavaScript. Username/dynamic-code login, invitation binding, rebinding, rate limits and session revocation remain server authoritative.

New endpoints: `/auth/lab/mobile/sign-in/`, `/auth/lab/mobile/admin/sign-in/`, `/api/lab/session/` (including `?admin=true`) and workspace `/lab/live-ticket/`. Sessions are tagged Android server side. Live tickets bind session, workspace, project and document, expire after 60 seconds, are consumed once, and are reissued on reconnect. Yjs/Hocuspocus synchronization and revocation checks remain intact.

Mobile business export is forbidden in both UI and server. Block dedicated CSV/JSON/XLSX/PDF/image/document/config export actions for Android sessions, including Live PDF. Preserve ordinary JSON queries, authorized existing attachment downloads and internal document binary synchronization. Desktop sessions retain their capabilities.

Schedule revisions and stale Gantt preview checks remain authoritative. Financial writes use a stable UUID request key across retries of the same payload and decimal strings rather than floating point arithmetic. Attachments use signed upload, confirmation and authorized download; signed external uploads never receive deployment cookies.

## Approved test boundaries

TDD at public API contracts, transport/server-switch boundaries, pure monetary/planning rules and browser/native behaviors. Isolated backend tests cover real roles, mobile/desktop sync, dynamic-code replay, expiry, permission denial, conflicts, duplicate funding, interrupted transfers, expired/consumed/revoked Live tickets and direct mobile export requests. Browser tests cover 360/412, themes, forms, offline/error recovery and navigation. Install and run the APK on an Android emulator and record its exact API/device; never imply unperformed physical-device validation.

## Tickets and review

Local dependency tickets are `.scratch/android-app/issues/01.md` through `08.md`. Their outcomes and verification are recorded in `android-app-progress.md`. Run Standards and Spec reviews against the pinned baseline and this specification, resolve findings, then commit the final implementation. No deployment or production account changes are implied by local build and test authorization.
