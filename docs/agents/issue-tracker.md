# Task tracking

This fork uses [the approved laboratory specification](../lab/spec.md) and [the seven-stage implementation record](../lab/progress.md) as its task tracker. Review the implementation against `v1.4.2` / `ooa/main`; no external issue references are required. The user approved the specification and authorized the organization fork, local implementation and pull request.

The next release follows the approved [enhancement specification](../lab/enhancement-spec.md) and [nine-stage record](../lab/enhancement-progress.md). Review this release against `61cab62fc3a0ce9bd513a0cc49bae5bd253e5444`. Local vertical tickets live under `.scratch/lab-enhancements/issues/` and are marked `completed` after local acceptance. Test and deployment evidence is recorded in the nine-stage record; the organization PR is #1.

PR #1 is merged into `ooa/main` as `d44157d6bce2e28db6742d42f102c74f744a6d76`. The personal planning workbench and calendar fix follow [the confirmed specification](../lab/personal-planning-spec.md), with implementation comparison pinned to `46036ac092306ed258a38b506f94c5faadf891e5`. Use [the workbench guide](../lab/personal-planning-guide.md) and [delivery record](../lab/personal-planning-progress.md) for operation and validation. GitHub webhook work remains deferred.

Calendar sizing, persistent category/manual colors, and the retained item timeline follow the same confirmed specification. This increment is reviewed against `c5878bd41336cd3b0c9c28fa5b8e73b965c4a61b`; implementation commit `ea77454`. PR #2 remains the delivery branch.

The personal/team resource timeline follows [the resource timeline specification](../lab/resource-timeline-spec.md). It starts from `c5878bd41336cd3b0c9c28fa5b8e73b965c4a61b` and integrates the existing calendar release `0e9eb5ff8f619b61d894eb696f13b7eb53a09ee8` as its final review baseline. The user confirmed folder colors, item rows, selectable folders and native collapse, and then chose adjustable height with internal scrolling. Its isolated branch is `feat/planning-resource-timeline`; baseline backend/manual-event-color behavior is preserved.
