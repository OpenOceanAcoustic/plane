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
