# V6 implementation reviews

The independent Standards and Spec reviews compare this worktree with `bac34abd3bfd8e0884c087a89a9b09c3ed58401b`. Neither review substitutes for installed APK evidence. No unit or business test suite was added or run.

| Review           | Finding                                                                           | Resolution                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standards        | Cascade layers drop base styles in supported WebView 95–98.                       | Keep WebView 95 minimum. The Vite build emits one complete stylesheet and transforms its cascade layers with the pinned CSSTools PostCSS plugin. The build rejects remaining layer blocks. Source development styles retain their original cascade. |
| Standards        | Sheets apply Android safe areas twice and Lab sheets retain a horizontal gutter.  | The shared inset overlay owns the safe area. Sheet margins and ordinary Lab overlay padding are zero. Confirmation dialogs retain their own content padding. The shared close scrim is transparent so the reference backdrop is applied once.       |
| Standards / Spec | Disabling the sticky widget hides access to notes, quick links and recent visits. | The always available homepage creation menu opens all notes, enabled quick links/recent visits and widget management. The baseline firstscreen and the nine expanded workbench rows stay intact.                                                    |
| Spec             | Personal, projects and finance back buttons use the wrong arrowhead path.         | Use the original `arrow` path rotated 180 degrees at 21/22px for these headers. Project pages retain `back` at 20px; business pages retain `back` at 24px.                                                                                          |
| Spec             | Projects and finance header titles incorrectly use weight 500.                    | These two titles use weight 400, matching the reference span. Other page title roles retain their reference weights.                                                                                                                                |

Additional source geometry corrections: scope the homepage note heading and finance budget heading to reference line height 1.5, align VC legend values to the left, and allow finance budget segments to shrink around the reference 3px gap.

The real backend automatically treats a bounty with a 50VC budget as major (threshold 40VC), while the reference card omits its major tag. The card now follows the reference composition; major classification remains visible in the real bounty detail. The backend fact is preserved rather than falsifying a fixture.

Browser diagnostics use real isolated backend data and UI navigation. They are explicitly labelled source diagnostics. Final acceptance depends on the same signed APK's raw device captures, individual geometry/type/colour/icon findings, navigation/sheet/keyboard observations and declared device versions.

## External build dependency

The pinned [CSSTools cascade-layer plugin](https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-cascade-layers) requires a complete CSS bundle for correct specificity calculation. The transformation runs after Vite has bundled every stylesheet, rather than independently processing source files.

## R4 source follow-up and installed evidence

The frozen R4 implementation is `58bfb5c023fec90d1be7d95f5989fdc8c264724f`. The installed signed APK has SHA-256 `8157824bcfb3221e4e08fd8a75915c501be0a4c93809487db667ea396989979c`. The Standards and Spec follow-up reviews found no new source blockers in the R4 fixes:

- Latin Regular has separate 400 and 500 declarations, matching the corresponding CJK descriptors so older WebViews can combine the Unicode slices. The font files and reference glyph outlines remain unchanged. The actual built stylesheet loaded custom assets in all 18 Latin/CJK weight probes under Chromium 110; this static diagnostic does not establish the selected face inside the installed release WebView.
- The finance selector uses `svg:last-of-type`, retaining the reference 8px arrow margin when its functional `select` follows the SVG. Fixed light/dark RGBA divider declarations replace the older WebView's invalid computed `color-mix` value.
- Project creation and workspace administration, including project-overview description editing, use the existing authenticated `workspace-members/me/` role. The role thresholds and archived-project guard remain intact. No new backend endpoint, demonstration-data renderer, mobile administration entry or export action was introduced.

The final native evidence contains all 52 firstscreens and 12 correctly expanded long scenes, covering 13 pages at 360/412px in light/dark. Every effective capture and review binds to the same R4 APK. The obsolete 360px light VC scene with its date menu closed is archived as a diagnostic; its replacement shows both the date menu and budget details open. Native raw PNGs and original design PNGs remain unchanged. The canonical native displays use density160/fontScale1, an 828px application region and a separate 48px Android bottom inset; their absent top system bar is recorded separately from the real main-screen observations below.

Long-page offsets come only from integer overlap between adjacent native raw captures, with source hashes, original overlap coordinates and repeated terminal captures. They are not represented as device-measured scroll values or aligned to the reference. Original long content heights are 2001px for finance actions, 1003px for VC and 1489px for the workbench, plus 76px navigation. The preview wrapper's fractional screenshot boundary adds one PNG row; only labelled derived reference comparisons exclude that proven boundary row. Original reference files and fingerprints are preserved.

The complete evidence validator returned zero structural/provenance errors, zero missing rows and 64 complete native rows. This verifies provenance and coverage only. Source font face/weight/size declarations and canonical icon paths are recorded as matched contracts; the selected native release WebView face cannot be directly confirmed through CDP. **Strict visual acceptance is not met: all 64 entries have `native_raster_alignment=failed`, and none is accepted.** Local text/SVG ink coverage and boundaries differ from the reference, without an overall similarity score or a blanket antialiasing exception.

The additional visible failures remain explicit:

- All four finance firstscreens fail layout: the budget card ends one pixel earlier and the action button is one pixel higher.
- Both dark finance firstscreens fail color: the complete cash divider is reference RGB `(38, 88, 169)` and native `(39, 89, 169)`, with native red and green each one level higher.

The untouched MuMu main screen was also observed at 1440×2560, density640 and fontScale1, corresponding to logical360×640. The isolated profile10 task was moved to display0 without changing system resolution or scaling; native screenshots include the real Android status bar. Scrolling with the footer fixed, a single system back closing a modal first, and a single system back returning from projects to home were observed. These short-screen observations are separate from the 828px matrix.

Keyboard occlusion remains **unverified**. MuMu's Sogou IME reported visible with zero height and rendered no soft keyboard, so no keyboard-avoidance pass is claimed. No unit or business suite was added or run, and these source reviews, provenance checks and limited native interactions do not establish business acceptance.
