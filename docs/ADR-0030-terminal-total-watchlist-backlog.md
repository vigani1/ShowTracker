# ADR-0030: Terminal Totals Preserve Watchlist Backlog

## Status

Accepted

## Context

On June 15, 2026, production `/show/tmdb:tv:69740` loaded Ozark as a tracked
TV show. The title had previously appeared in Home, then disappeared from the
active Watchlist until the detail route was opened. Opening detail triggered the
tracked metadata refresh, hydrated TMDB season details, and repaired the show
and feed projection to `releasedEpisodes: 44`, `totalEpisodes: 44`, and
`remainingEpisodes: 40`.

Local schedule-confidence evidence captured the stale shape before that repair:

- `shows.status = ended`
- `shows.totalEpisodes = 44`
- `shows.releasedEpisodes = 0`
- `feedProjections.remainingEpisodes = 0`
- `feedProjections.status = plan_to_watch` in the older snapshot, later
  `watching` after the user watched four episodes

The same evidence showed the reconciler once had a correct provider fact for
Ozark with `releasedEpisodes: 44`, but a later sparse-old-history pass emitted a
delta with `releasedEpisodes: 0` because the latest old provider event aired
before the user's activity and the imported row looked caught up.

## Current Behavior

Before this change:

- Feed projections treated any numeric `releasedEpisodes` value as authoritative,
  including `0`.
- A terminal TV show with `totalEpisodes: 44` and `releasedEpisodes: 0` projected
  as `remainingEpisodes: 0`.
- Home filtered zero-remaining `watching` rows out before the client could apply
  schedule-count guards.
- The schedule-confidence sparse-old-history guard could cap a known ended
  series down to the watched count when only one old provider event was present.
- Opening the detail route repaired Ozark because tracked metadata refresh
  hydrated all TMDB seasons, but Home did not perform that provider refresh.

## Decision

Terminal TV/anime shows with a positive provider total now treat that total as
the watchable floor for Home and schedule-confidence projections. If a terminal
row has `releasedEpisodes` lower than `totalEpisodes`, projections use the
larger terminal total when computing `remainingEpisodes`.

Tracked metadata refresh bypasses the one-hour throttle for terminal TV rows
whose released count is missing or lower than the known total.

The schedule-confidence export now includes the cached show lifecycle status.
The reconciler stores it as `show_status` and skips timestamp capping for
terminal rows with a known total and no future provider events. Ongoing sparse
old-history rows keep the existing cap.

## Reasoning

ADR-0009 and ADR-0026 prefer released/watchable counts over raw totals because
ongoing shows can include future planned episodes. That risk is different for a
provider-terminal show. When the provider says a series is ended/finished and
also gives a concrete total, that total is stronger evidence than a stale zero
released count.

The sparse-old-history guard is still valuable for long-running or ongoing shows
where one ancient event plus a large raw total could wake hundreds of unavailable
episodes. Ozark was not that case: its lifecycle was terminal, its total was
known, and there were no future rows.

Keeping this in projection math avoids a silent Home miss even before a user
opens detail. Keeping it in the reconciler prevents the VPS job from writing the
bad zero-released shape back into Convex.

## Provider/Data Assumptions

TMDB, AniList, Jikan/MAL, and normalized provider statuses that map to ended,
finished, completed, released, canceled, or cancelled are terminal lifecycle
signals.

For terminal TV/anime rows, a positive `totalEpisodes` value is safe as a
released/watchable floor when no future provider events are known.

For non-terminal rows, a numeric `releasedEpisodes` value, including `0`,
continues to win over raw totals so future planned episodes do not create false
Home backlog.

Provider IDs, route IDs, title fallback, duplicate collapse, schedule-cache
matching, and same-day airtime rules are unchanged.

## Edge Cases

An ongoing long-running show with one old provider row and a large total remains
capped to watched progress by the sparse-old-history guard.

A terminal show with `releasedEpisodes: 0`, `totalEpisodes: 44`, and four watched
episodes projects as 40 remaining and appears in Home.

A terminal show that is fully watched still projects as zero remaining.

A terminal show with no positive total keeps the existing behavior and relies on
provider refresh or schedule-confidence reconciliation.

If a terminal provider also has future events, the existing future-event logic
continues to protect against treating those rows as already released.

## Verification

Required checks for this change:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

The fixture suite includes a terminal-ended-total case shaped like Ozark:
`releasedEpisodes: 0`, `totalEpisodes: 44`, one old finale event, and four
watched episodes. Validation must produce `releasedEpisodes: 44` and
`remainingEpisodes: 40`.

Production verification should confirm `/show/tmdb:tv:69740` and Home both show
Ozark with 40 remaining episodes without needing another detail-triggered repair.

## Rollback Notes

Rollback by reverting the terminal-aware projection helpers in `convex/shows.ts`
and `convex/scheduleConfidence.ts`, removing `showStatus`/`show_status` from the
schedule-confidence export/import path, and restoring sparse-old-history capping
for terminal totals in `scripts/schedule-confidence.mjs`.

If rollback is needed because old ongoing shows reappear with huge backlogs,
inspect whether those rows were incorrectly marked terminal before weakening the
terminal-total floor.
