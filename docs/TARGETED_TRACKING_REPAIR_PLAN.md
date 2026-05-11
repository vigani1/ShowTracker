# Targeted Tracking Repair Plan

Last updated: 2026-05-11

## Problem

The project currently has broad repair functions that can rebuild tracking aggregates and projections, but they are too expensive for normal production use.

The old broad path was useful for data drift, but it caused major Convex database bandwidth usage when run from cron or normal metadata refresh. The replacement should let users or maintainers repair stale tracking state intentionally and narrowly.

## Goals

- Repair one user's one show from the show detail screen.
- Repair all shows for the current user from Profile.
- Keep broad repair manual, explicit, and bounded.
- Avoid reintroducing automatic full-library backfill behavior.

## User-Facing Entry Points

Show detail:
- Add a small refresh/repair action under the existing overflow/three-dots menu.
- Label idea: `Refresh tracking for this show`.
- Scope: current authenticated user and current show only.
- Expected result: recompute watched aggregates from `watchedEpisodes`, patch the matching `userShows` row, and refresh the feed projection.

Profile:
- Add a `Refresh my shows` action.
- Scope: current authenticated user only.
- Expected result: process the user's tracked shows in bounded batches.
- The UI should show progress or a clear "started/completed" state if the repair is split across batches.

## Backend Shape

Targeted user/show repair:
- Public action or mutation requires auth.
- Resolve the show from the show lookup args.
- Verify the current user has a `userShows` row for that show.
- Recompute aggregates by reading only `watchedEpisodes` for that user/show.
- Patch only that `userShows` row.
- Upsert only that feed projection.
- Return a small summary: `patched`, `watchedEpisodesCount`, `watchedTotalCount`, `watchedRuntimeMinutes`, `status`, and `projectionUpdated`.

User-level repair:
- Public action requires auth.
- Paginate the current user's `userShows` using `by_user`.
- Call a bounded internal mutation for each page.
- Use a conservative batch size and return cursor/progress.
- Prefer an explicit user-triggered loop from the client or an action that stops after a safe maximum number of batches.

Admin/internal broad repair:
- Keep broad functions internal.
- Add dry-run/count mode before patching.
- Add clear return summaries.
- Do not wire broad repair to cron or normal page loads.

## Guardrails

- Never repair all users from a public client action.
- Never call broad repair from `refreshTrackedShowMetadata`.
- Keep repair page sizes small enough to avoid large read spikes.
- Return counts so the UI can report what changed.
- Log summary information, not full user data or secrets.

## UI Considerations

Show detail overflow menu:
- Add action near other maintenance actions, not as a primary CTA.
- Disable while running.
- Show success copy such as `Tracking refreshed`.
- Show a recoverable error if the show is not tracked or the repair fails.

Profile repair button:
- Put under settings/tools rather than main stats.
- Explain that it fixes stale counts/statuses.
- If user-level repair is cursor based, show progress and allow retry.

## Success Criteria

- A stale single show can be repaired without scanning the user's whole library.
- A user's library can be repaired intentionally without touching other users.
- Normal app navigation never triggers broad aggregate backfill.
- Convex logs show targeted repair usage stays small compared with the historical backfill spikes.
