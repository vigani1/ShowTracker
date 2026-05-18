# ADR-0011: Schedule Projection Fallback Diagnostics

## Context

After ADR-0010 moved Home and Schedule matching into user-specific projection rows, production inspection showed two fallback causes that were hard to see from the app:

- A normal `feedProjections.updatedAt` change after projection generation could make the projection window look stale even when the schedule-matching identity had not changed.
- The desktop month calendar can request leading days from the previous month. On May 18, 2026, the generated projection window started at `2026-05-04`, while the May month grid can request `2026-04-27`, forcing the old global `scheduleCache` scan.

The product risk is that Convex silently falls back to the expensive read path even though the private schedule-confidence backend has already generated projection rows.

## Current Behavior

Before this change, schedule projection freshness was based on the latest TV/anime `feedProjections.updatedAt` for the user. That timestamp changes for progress/status/home-feed reasons, not only for schedule matching identity. When it is newer than `userScheduleProjectionWindows.projectionUpdatedAt`, these reads fall back:

- Home future watchlist counts.
- Home same-day scheduled watchlist rows.
- Upcoming Schedule rows.

The fallback path preserves correctness but repeats the global `scheduleCache` scan, provider-id/title matching, parsing, and dedupe work inside reactive Convex reads.

## Decision

Add schedule-specific identity tracking to `feedProjections`:

- `scheduleProjectionKey` stores the schedule-relevant identity for a tracked row.
- `scheduleProjectionUpdatedAt` advances only when the schedule identity changes, such as show ID, user-show ID, title, media type, provider IDs, or first-aired date.

Projection freshness now compares the latest `scheduleProjectionUpdatedAt` against the coverage row. Ordinary watch progress, status, remaining episode, poster, home-sort, or attention-signal changes no longer invalidate projection reads by themselves.

Increase the backend-generated schedule projection past window from 14 days to 45 days and raise the token-protected apply limit to 180 days. This covers current-month desktop calendar leading weeks while keeping the generated window bounded.

Add diagnostics:

- `schedule.getScheduleProjectionDiagnostics` for authenticated app/runtime checks.
- `scheduleConfidence.getScheduleProjectionDiagnostics` for token-protected operations checks.
- `npm run schedule-confidence:diagnose-projections` as a CLI wrapper around the token-protected diagnostic query.

The diagnostic response reports whether the requested range uses projection rows or fallback, the reason, requested range, covered window, latest schedule-identity timestamp, latest general feed timestamp, and projected row counts.

## Reasoning

Progress updates must not force the expensive fallback path. The projected rows already point to current `feedProjections`, and read-time code still rehydrates current projection rows. Today's Home scheduled row also checks current watched episodes before surfacing an attention item, so progress remains current without globally invalidating schedule coverage.

Newly tracked shows, provider identity changes, title changes, media-type changes, and first-aired corrections can change matching results. Those still advance `scheduleProjectionUpdatedAt`, which keeps the fallback safety behavior until the backend regenerates projections.

The month-window change fixes a real coverage gap without changing provider matching rules. A 45-day lookback covers the current month grid's leading prior-month days even near the end of long months.

Diagnostics make fallback observable. Future investigations should not rely on reading raw tables and manually comparing timestamps.

## Provider/Data Assumptions

Provider IDs remain the trusted schedule match source. Anime still prefers AniList/MAL identity, TV still prefers TMDB/TVMaze/IMDb route identity, and title fallback remains conservative.

The schedule identity key includes the fields that can affect projection matching or route identity. It intentionally excludes progress/status fields because those are handled by current feed projection hydration and exact watched-episode checks.

Existing `feedProjections` without `scheduleProjectionUpdatedAt` are treated as schedule-identity timestamp `0`. They become strict only after a schedule identity field changes or a new row is inserted.

## Edge Cases

Completed shows with new releases still rely on release deltas to reactivate user state. The projection freshness change does not suppress release-delta updates.

Paused, dropped, planned/not-started, and completed rows remain projected the same way as ADR-0010. Status changes no longer stale the schedule projection window because Schedule and future-count logic already read current projection rows.

Untracked shows are filtered out at read time because projected rows must still point to existing current `feedProjections`.

Newly tracked shows receive a fresh `scheduleProjectionUpdatedAt`, so schedule reads fall back until the backend generates rows that include the new tracked identity.

Anime season aliases, long-running shows, same-day duplicate episodes, and provider/title fallback behavior are unchanged.

Future weekly rows remain bounded by the generated schedule window. Requests outside the generated window still fall back.

## Verification

Required checks:

- `npm run schedule-confidence:validate`
- `npx convex codegen`
- `npx tsc --noEmit`
- `npx convex deploy --dry-run --yes`

Operational checks after deployment:

- `npm run schedule-confidence:diagnose-projections -- --user-id <userId> --start-date 2026-05-18 --end-date 2026-06-08`
- `npm run schedule-confidence:diagnose-projections -- --user-id <userId> --start-date 2026-04-27 --end-date 2026-05-31`

Expected diagnostic reasons:

- `active` when the range is covered and no schedule identity change is newer than coverage.
- `outside_window` when the UI requests a range outside generated coverage.
- `missing_window` when no projection coverage exists for the user.
- `stale_schedule_identity` when a newly tracked show or provider/title identity change is newer than the generated coverage.

Known production motivation on May 18, 2026:

- Existing projection coverage was `2026-05-04` through `2026-09-15`.
- Desktop May month view can request `2026-04-27` through `2026-05-31`.
- `feedProjections.updatedAt` was newer than coverage, but that alone was too broad to prove schedule identity staleness.

## Rollback Notes

If schedule/watchlist regressions appear, revert the `feedProjections` schema fields, freshness guard changes, diagnostic query additions, and backend window change together.

If only the wider window causes write volume issues, reduce `scheduleProjectionPastDays` while keeping the schedule-identity freshness guard and diagnostics.

During rollback, watch Home active rows, same-day scheduled rows, future watchlist counts, Schedule month/week rows, completed-show reactivation, newly tracked shows, untracked shows, and title-fallback matches.
