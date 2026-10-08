# Enhancement specification review

Reviewed the working tree and new enhancement modules against baseline `61cab62fc3a0ce9bd513a0cc49bae5bd253e5444`, the accepted plan, and `docs/lab/enhancement-spec.md`. This report covers requirements correctness; Standards has an independent review.

## Original findings and resolutions

- **P2 resolved — chart scope consistency.** `packages/shared-state/src/lab-analytics.store.ts` clears data while loading and retains the successful filter snapshot. `apps/web/core/components/lab/analytics.tsx` renders and exports only matching data, guards drilldown request ordering, and invalidates pending details after scope changes. This meets “导出范围与页面权限一致”.
- **P2 resolved — weekly planned hours.** `apps/api/plane/lab/analytics.py` clips blocks at Shanghai day boundaries, groups by member and Monday week, and keys drilldowns to the same week. The new Sunday-to-Monday regression asserts separate totals and matching detail sums, meeting “成员每周计划时数”.
- **P2 resolved — valid zero completion rates.** The completion chart uses task `total` to distinguish valid 0% from an empty project. The component browser regression contains 100 open tasks and checks that a real chart is rendered instead of an empty state, meeting “空数据为空状态”.
- **P2 resolved — reopening and historical outcomes.** `apps/api/plane/lab/workflow.py` now projects reopening to acceptance and marks approved historical result nodes as visited, excluding pending major reviews. Reopen and partial/rework-to-pass contract scenarios cover these projections, meeting “React Flow 是现有悬赏流程的投影”.

## Additional finding and resolution

- **P2 resolved — mandatory major reviews.** `apps/api/plane/lab/workflow.py` now filters direct publication-to-claim and acceptance-to-outcome edges only for major work, preserving ordinary routes. The parameterized public API regression checks both ordinary and major paths, meeting “重大任务完成独立复核”. The root agent reported that the regression reproduced the failure before the change and passed afterward; all seven workflow contracts passed.

## Remaining findings

No source-level P1/P2 remains across the nine stages: canonical tasks, server privacy, field history, locked Gantt previews, Page links/versions, twelve real-data charts, additive migrations, and isolated backup/restore/deployment. Existing authentication and budget/WIP code is unchanged; new workflow actions reuse its guards.

Native-control labels, folder-menu closure, and optimistic field toggles retain naming, failure rollback, and project/unmount guards.

## Evidence and limits

Final review inspected the full enhancement diff and changed only this record, without running tests, builds, browsers, or services. Root-reported validation: 593 backend tests, 26 type/lint tasks, 12 component cases, four full-service E2E cases, and restoration of 26 attachment files plus one encrypted credential. Root subsequently confirmed all four final Vite 7 builds, reran the frontend/browser checks, and verified formal deployment authentication entries and upload. No production account or business record was touched by this reviewer.
