# Enhancement standards review

Reviewed staged and unstaged source changes against `HEAD` / baseline `61cab62fc3a0ce9bd513a0cc49bae5bd253e5444`. Sources: `AGENTS.md`, `CONTRIBUTING.md`, and `docs/agents/issue-tracker.md`. This report covers Standards; requirements correctness is reviewed separately.

## Original findings

- **P2 resolved — store placement.** `packages/shared-state/src/lab-fields.store.ts:7` owns the MobX store; `packages/types/src/lab-fields.ts:2` owns domain types. Consumers use package exports (`apps/web/core/components/lab/task-table.tsx:22`).
- **P2 resolved — stale requests.** Store serials (`lab-fields.store.ts:19–37`) and table generations (`task-table.tsx:47–69`) reject obsolete rows/configuration and invalidate pending loads. Refresh preserves filters without remounting (`panel.tsx:133`).
- **P2 resolved — chart disposal.** The pnpm patch (`pnpm-workspace.yaml:7–8`) updates source and both vendor distributions. Adapter cleanup destroys its retained instance (`frappe-gantt.tsx:135–138`). MIT attribution remains; Docker-oriented turbo pruning retains the patch.

## Incremental interaction review

No new violations found in these follow-up changes:

- `packages/ui/src/lab-form.tsx:19–32` supplies precise native control names while preserving explicit ARIA names and custom components. The reusable fix remains in `@plane/ui`.
- `field-manager.tsx:185–205` updates toggles immediately, rolls back current failures, and guards state/errors/callbacks against project switches and unmounts. Pending controls prevent overlapping submissions.
- `planner.tsx:195–209` closes only the activated native details menu before opening rename/delete dialogs, preserving React ownership of dialog state.
- Final build configuration: `pnpm-workspace.yaml:197` pins Vite `7.3.7`; `apps/web/vite.config.ts:25` retains esbuild minification and existing React Router/plugins/server configuration. `apps/web/package.json:95` declares esbuild through `catalog:` (`0.28.1`). Vite 7 uses Rollup; esbuild minification alone did not resolve the earlier Vite 8/Rolldown crashes. Root subsequently validated the final lockfile and four application builds; runtime evidence is recorded in `enhancement-progress.md`.
- Final lint cleanup preserves behavior: `base-gantt-root.tsx:72` depends on the stable inherited `initGantt` action (`base-timeline.store.ts:100`); adding `t` refreshes translated callbacks, while explicit conditional awaiting and the `sidebarProps` rename are equivalent to the prior expressions.

## Remaining findings

No documented-standard violations remain. Shared state/types, `@plane/ui` primitives and Storybook examples, `catalog:` dependencies, native integration seams and isolated backend contracts follow repository conventions.

**P3, judgment call — possible Duplicated Code.** `calendar.tsx:55` and `fields-types.ts:19–28` duplicate CSV formula neutralization/quoting. A shared serializer would prevent divergence; current behavior matches. Optional follow-up, not a blocker.

## Evidence and limits

Previously verified: 19 field/Gantt PostgreSQL contracts, five frontend feature tests, 24 vendor lifecycle cycles, five delayed-toggle browser scenarios, and real Gantt labels/dependency creation-removal/date preview cancellation-confirmation. Root reports 593 backend tests; after the final toolchain change, all four Vite 7/Rollup + esbuild builds, 26 frontend checks, 12 component tests and 4/4 service E2E tests passed. Formal deployment auth entries and upload were also verified. This source reviewer ran no tests and made no implementation edits; runtime results belong to the root validation recorded in `enhancement-progress.md`.
