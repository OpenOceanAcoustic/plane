# Material selection surfaces and typography follow-up

Spec: docs/lab/android-material-refinement.md

Review baseline: `8d4206d08de6c341ae07d1bef8939982e848abed`.

User requirement (2026-10-11): the reference follows Google Material 3 / Reply; replace the unstyled native option windows and improve typography, especially planner folder/board labels. This updates the earlier fixed Liberation Sans choice; retain the V6 routes, palette and real business operations.

Acceptance: all existing mobile select callsites use one themed picker; controlled, default, multiple, disabled, required and named FormData behavior remain intact. Replace the three remaining browser confirmation windows, retaining cancellation and the unsynced-document navigation guard. Bundle full Roboto 400/500/700 and existing full Noto Sans CJK SC with licenses and fingerprints. Planner labels use 14/20/500 with 48px touch targets; the user's four folder labels fit the actual logical360 short screen.

Delivery: 1.0.5/code6, same package and release certificate. Check the installed signed APK and preserve raw native evidence bound to its SHA. Source/static diagnostics and historical R4 52+12 captures must not be presented as native acceptance for this release. Keep the PR draft until the wider exact V6 acceptance is satisfied. No new or executed unit/business suites; build, signature and focused native UI checks only. Protect user0 session, system scaling, live50010 and business data.

Status: implementation completed and focused native observation completed on source `70ebb0557f98c69c463bfaa24547772f9d9b0c27`, signed APK SHA `8a6adabeec5bea9fc3820252328d70b1934d99a2e0bebcab27d46fd548ebe52d`. Device base.apk is identical; 20 raw screenshots have matching provenance. Finance selection/back, four planner labels/filter/board and nested picker/form back were observed without business writes. Confirmation cases, search/multiple/required/disabled, dark/412/long/keyboard/system bars remain source-only or unverified as explicitly listed in the delivery record; no full V6 pixel acceptance is claimed. Standards/Spec source reviews and required build/signature checks pass; no suites. PR12 stays draft. Process APKs/screens are excluded from final evidence.
