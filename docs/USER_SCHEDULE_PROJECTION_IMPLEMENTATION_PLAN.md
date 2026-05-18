# User Schedule Projection Implementation Plan

## Goal

Move the recurring Home/Schedule schedule-matching work out of reactive Convex queries and into the private schedule-confidence backend. Convex should keep only compact, user-specific projection rows that are cheap to read.

## Scope

- Add user-specific schedule event projections for the Schedule tab and same-day Home schedule bridge.
- Add compact future-count projections for Home watchlist filtering.
- Generate and apply those projections from `scripts/schedule-confidence.mjs` after the existing release-delta apply step.
- Keep the current schedule-cache scan as a guarded fallback when projection coverage is missing.
- Use projected event rows, not static count rows, when a read needs current same-day airtime classification.

## Safety Rules

- Do not remove the existing schedule-cache matching path in this PR.
- Treat the new projection path as authoritative only when a coverage row says the requested window was generated.
- Fall back to the existing live path when the user's relevant `feedProjections.updatedAt` is newer than the generated projection window.
- Do not apply projection rows by themselves while local release deltas are still unapplied. Projection apply must run after the release-delta apply step, or with an explicit rollback/test override.
- When projections are applied as part of `apply-convex`, stamp the projection window after release deltas finish. Release-delta mutations patch `feedProjections.updatedAt`, and an older projection timestamp would intentionally make the new rows stale.
- Verify projected rows still point at current feed projections before Schedule/future-count reads return them, so untracked shows cannot stay visible from stale backend rows.
- Keep exact watched-episode filtering for today's Home scheduled rows inside Convex, using only projected candidate events.
- Keep provider matching conservative: provider IDs first, title fallback only as the existing schedule behavior allows.
- Do not change watch status, progress, completed-show reactivation, or schedule-cache mutation semantics as part of this projection read optimization.

## Implementation Steps

1. Add projection tables:
   - `userScheduleEvents`
   - `watchlistFutureCountProjections`
   - `userScheduleProjectionWindows`
2. Add a token-protected Convex mutation that replaces one user's projection set atomically.
3. Change the public `schedule.getUpcomingSchedule`, `schedule.getFutureUpcomingCountsForWatchlist`, and `schedule.getTodayScheduledWatchlistFeed` read paths to use projections only when coverage exists and is fresh, otherwise fall back to current behavior.
4. Extend the schedule-confidence backend to build per-user projected schedule events and future-count rows from imported `feedProjections` plus the Convex `scheduleCache` window after release deltas are applied.
5. Apply those projections during `schedule-confidence apply-convex`.
6. Validate with fixture reconciliation, projection parity comparison, TypeScript, lint, and Convex typecheck/deploy checks.

## Rollout Notes

The first deploy is safe before the backend has generated rows because all reads fall back to the current schedule-cache path. Once the nightly backend run applies release deltas and then projections, the high-volume reads should scale with each user's projected events instead of global schedule-cache rows.

Production US validation on May 18, 2026 found two safety constraints:

- Projection rows generated from fresh backend provider facts did not match the current Convex `scheduleCache` while 540 release deltas were still unapplied in the isolated SQLite run, so projection-only apply was blocked.
- Even after release deltas were applied, provider-event projections produced richer/fresher rows than the old live `scheduleCache` path for some titles. To preserve day-to-day behavior, production projection generation now fetches the same Convex `scheduleCache` window after release deltas and projects from that source.

After that change, the production old-flow vs new-flow comparison for `2026-05-04` through `2026-09-15` returned 205 old events and 205 projected events with zero missing/extra keys. Future-count comparison for `2026-05-18` through `2026-08-16` also returned zero missing/extra count rows.
