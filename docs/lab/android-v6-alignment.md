# Android V6 visual implementation

Baseline: `all-interface-images.zip` from the user-provided V6 directory, SHA-256 `a22370a06f7ed0474040eaba8fb46e58a8886f9c1361424938a56ada54071889`.

The 13 V6 screen IDs define 52 first-screen references (360/412 logical pixels, light/dark) and 12 expanded-page references. Historical V4/V5/comparison images are not additional V6 targets. Final effective CSS and actual reference fonts are authoritative. The reference app region is 828px high; the 829th exported PNG row is capture rounding / preview outline, not app content.

Implement all existing mobile features with the V6 components, retaining existing routes, real APIs, role permissions, native session transport, document collaboration, attachments, decimal finance and idempotent requests. No mobile God Mode or data exports. No demonstration data or browser-only rendering branch may enter the APK.

Reference font roles: Liberation Sans 2.1.5 for Latin/digits (400/500 use Regular), Noto Sans CJK SC 2.004 for Chinese (400 Regular, 500 Medium, 600 Bold); no synthetic faces. Ship the fonts and OFL notices. Reference SVG paths and effective 1.8 stroke width are used directly.

Short screens retain reference type/control sizes and scroll, with fixed app navigation and real Android system bars. Do not change the user's MuMu density or font scaling. Native insets and IME must be accounted for once.

Visual evidence uses the identical signed delivery APK with a separate real backend containing reference-matched data scenarios. Preserve raw screenshots, reference fingerprints, device/DPR/inset metadata and explicitly labelled derived comparisons/stitches. No runtime CSS injection, frontend mock response replacement or modification of original references. Differences in system bars/preview frame/text antialiasing are recorded separately; they do not excuse geometry, colour, type or icon discrepancies. Browser previews and builds are not installed-APK acceptance.

User requested no additional business/unit suites. Run required type/lint/format/build/signature checks, native visual inspection, navigation/sheet/keyboard checks; report completed and uncompleted verification honestly. Work in an isolated checkout/output, preserve the running 50010 service and published assets, and do not modify production business data.

Delivery: OpenOceanAcoustic 1.0.4, versionCode 5, existing package/signing identity, reviewable PR, signed APK, SHA-256, installation/rebuild instructions and per-screen visual status. Do not report complete visual acceptance until the recorded native evidence supports it.
