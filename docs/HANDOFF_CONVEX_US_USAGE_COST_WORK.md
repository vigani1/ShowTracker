# Handoff: Convex US Usage Cost Work

## Current State

The active repo is `/Users/ebrardushullovci/Projects/Personal/ShowTracker`.

Branch `fix/convex-refresh-cost-gate` was created from `main`, committed, and pushed to origin.

- Commit: `2b58155` (`Fix Convex tracked metadata refresh cost`)
- Remote branch: `origin/fix/convex-refresh-cost-gate`
- PR creation URL: https://github.com/ebrardushullovcii/ShowTracker/pull/new/fix/convex-refresh-cost-gate

## What Was Done

The Convex US deployment usage audit found the main abnormal spike was `shows.backfillUserShowTrackingAggregatesBatch`, caused by tracked show detail navigation triggering `refreshTrackedShowMetadata`, which then ran broad user-library aggregate repair.

The applied code fix is in `convex/shows.ts`:

- `refreshTrackedShowMetadata` now verifies the current user tracks the show.
- It returns `not_tracked` if the global show exists but is not tracked by the user.
- It calls `refreshShowMetadataAndRepairTracking` with `skipBroadAggregateRepair: true`.
- It no longer passes `repairUserId`, so detail-page metadata refresh should not trigger full-library aggregate rebuilds.

Docs/artifacts added in this branch:

- `docs/TRACKED_METADATA_REFRESH_BACKFILL_FIX_PLAN.md`
- `docs/tracked-metadata-refresh-backfill-explainer.html`
- `docs/ADR-0003-tracked-metadata-refresh-cost-gate.md`
- `docs/US_CONVEX_READ_IO_REDUCTION_PLAN.md`
- `docs/README.md` indexes ADR 0003.

Do not duplicate those docs in future work; reference them directly.

## Verification Already Run

For the code fix:

- `npx expo lint`
- `npx tsc --noEmit --pretty false`

Before the first branch commit:

- `git diff --cached --check`

No local app/backend servers were started, per `AGENTS.md`.

## Important Rules For Next Agent

Read `AGENTS.md` before implementation. The watchlist/schedule section is critical:

- Any code/data/query/reconciler change affecting watchlist, Home attention, schedule, provider matching, counts, projections, route IDs, or episode availability requires an ADR before or in the same PR.
- Do not start/restart the user's frontend/backend servers unless explicitly asked.
- Never commit directly to `main`.
- Never commit unless explicitly asked.

## Remaining Work / Likely Next Focus

The next likely work is reducing the recurring normal-app I/O paths:

- `schedule.getFutureUpcomingCountsForWatchlist`
- `schedule.getUpcomingSchedule`
- `shows.getTrackedIds`
- `shows.getLibrary`

Use `docs/US_CONVEX_READ_IO_REDUCTION_PLAN.md` as the source plan. The key point is that the schedule functions are already backend Convex queries; moving the same scan to an action does not save I/O. The planned savings come from compact per-user schedule/count projections and cheaper reactive reads.

Suggested order:

1. `shows.getTrackedIds`: low-risk N+1 removal by using `feedProjections`.
2. `shows.getLibrary`: audit UI field needs, then use `feedProjections` or compact list plus detail hydration.
3. Schedule projection work: requires a new ADR before or in the implementation PR.

## Suggested Skills

- `convex-best-practices`
- `convex-functions`
- `convex-schema-validator` if adding projection tables/indexes
- `javascript-testing-patterns` if adding focused TypeScript tests
- `chrome-devtools` or `agent-browser` only if the next session verifies UI/browser behavior
