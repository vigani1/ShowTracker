# ADR-0031: Watched Anchors Suppress Stale Schedule Counts

## Status

Accepted

## Context

On June 15, 2026, production `/show/tmdb:tv:30983` showed Detective Conan in
Home with `1 left` even though the detail rail showed the user had watched the
latest available episode. Convex data confirmed the split:

- `watchedEpisodes` contained S01E1204 for Detective Conan.
- `userShows.watchedEpisodesCount` and the feed projection still said `1203`.
- `watchlistFutureCountProjections` counted S01E1204 as available today.
- The detail route clamped progress to its current watchable denominator, while
  Home trusted the stale aggregate and schedule count.

This happened after schedule-confidence repaired provider totals. The watched
row had been inserted while the known single-season total was lower, so the
aggregate recomputation filtered S01E1204 out as out of bounds. Later provider
metadata expanded the total, but the aggregate was not repaired with the new
bounds before the VPS projection job rebuilt Home counts.

## Current Behavior

Before this change:

- Schedule-confidence exported aggregate watched counts but not exact watched
  episode anchors.
- The local projection builder suppressed count rows by aggregate count and
  provider absolute aliases only.
- Release-delta application updated show totals and feed projections, but did
  not recompute affected `userShows` aggregates when the known total increased.
- A stale aggregate plus a same-day provider row could re-create Home attention
  even when the exact episode row was already watched.

## Decision

Schedule-confidence export now includes a bounded tail of exact watched episode
anchors for TV/anime feed projections. The SQLite projection builder stores
those anchors and suppresses watchlist future-count rows when a schedule event
matches an exact watched anchor or a provider absolute alias derived from one.

When release-delta application widens a known TV/anime total, it recomputes
tracking aggregates for user rows on that show before patching projections. A
token-protected one-show repair mutation uses the same aggregate rules so
production can repair an already affected title without a broad backfill.

The Convex importer also persists exported `showStatus`, preserving the
terminal-total behavior from ADR-0030 on VPS runs.

## Reasoning

Home should not wake a title when the episode-level watch history already proves
the scheduled row is watched. Aggregate counts are still the compact source of
truth for most projections, but they can lag when provider bounds expand after
an out-of-bounds watch insert.

Exporting a bounded anchor tail keeps schedule-confidence compact while covering
the high-number, latest-episode rows that schedule counts need. Recomputing
only user rows for the show whose total widened avoids a routine-navigation
backfill and keeps the repair tied to the metadata change that made the watched
row valid.

## Provider/Data Assumptions

Provider schedule rows for current long-running shows usually target the latest
high episode numbers. A bounded descending watched anchor set is enough to prove
those rows watched without exporting full histories.

For provider-year or season-local aliases, the existing schedule absolute-offset
logic remains authoritative. Watched anchors only add exact episode evidence;
they do not weaken direct provider ID, title fallback, duplicate collapse, or
airtime rules.

When a known single-season total increases, previously ignored watched rows can
become valid. The repaired aggregate should use the same bounds as normal
episode mutations.

## Edge Cases

A watched anchor suppresses the Home count for that exact scheduled episode
even if `watchedEpisodesCount` is lower.

An unwatched future episode after the watched anchor still counts normally.

Shows with no watched anchors keep aggregate-count behavior.

If a show has more watched rows than the bounded anchor export, older holes are
not inferred as watched from anchors. Existing aggregate and provider alias
rules still apply.

The one-show repair mutation is import-token protected and bounded to tracked
rows for the matched show; it is not a broad aggregate backfill.

## Verification

Required checks for this change:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

The fixture suite includes `Watched Anchor Drift`: aggregate count `1203`, exact
watched anchor S01E1204, and a same-day S01E1204 provider event. Validation must
produce no `watchlistFutureCountProjections` count row for that route.

Production verification should repair `/show/tmdb:tv:30983`, re-run schedule
projections, and confirm Home no longer shows Detective Conan as `1 left` after
the user has watched S01E1204.

## Rollback Notes

Rollback by removing watched anchor export/import, the SQLite
`watched_episode_anchors_json` column usage, anchor checks in
`isProjectedScheduleEventWatched`, and the targeted aggregate repair mutation.

If rollback is needed because real unwatched rows are hidden, inspect whether
the stored watched anchor was incorrectly created before removing provider
absolute alias handling.
