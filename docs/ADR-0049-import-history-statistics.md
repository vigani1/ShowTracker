# ADR-0049: Imported History Statistics

## Context

TV Time and metadata providers do not share a universal season/episode numbering scheme. Production
diagnosis found 17,500 stored watched rows and 510,511 runtime minutes for an imported account, while
the provider-bounded `userShows` aggregates exposed only 15,972 rows and 470,649 minutes to Profile.
Examples included Bleach, whose 409 stored rows became 41 progress rows because the matched provider
represented its seasons differently.

## Current Behavior

`userShows` stores separate optional history aggregates for unique episodes, total watches, and runtime.
History aggregates include every persisted watched row. Existing `watchedEpisodesCount`,
`watchedTotalCount`, and `watchedRuntimeMinutes` remain provider-bounded progress aggregates. Profile
statistics prefer history aggregates and fall back to legacy progress fields until a row is repaired.

The explicit Refresh stats action repairs tracking aggregates in bounded batches before materializing
statistics. TV Time import also populates history aggregates as each imported show is refreshed.

## Decision

- Persist `watchedHistoryEpisodesCount`, `watchedHistoryTotalCount`, and
  `watchedHistoryRuntimeMinutes` on each `userShows` row.
- Compute history values from every stored watched row, including numbering that falls outside the
  currently matched provider's catalog bounds.
- Keep provider-bounded progress fields unchanged for status, Home, Watchlist, Schedule, and release
  projections.
- Use history fields for Profile episode, rewatch, and watch-time statistics.

## Reasoning

A stored watched row is authoritative evidence that the user watched something, even when two providers
label that episode differently. Dropping it from historical statistics loses real user data. At the
same time, treating cross-provider numbering as canonical progress could complete a show incorrectly or
distort release availability. Separate derived fields preserve both meanings without weakening existing
projection safeguards.

## Provider And Data Assumptions

TV Time archive rows have already passed import validation and matching. TMDB, TVMaze, AniList, and
Jikan remain authoritative for current catalog metadata and exact runtime enrichment where available,
but their episode bounds are not assumed to describe another provider's historical numbering.

## Edge Cases

- Rewatches increase history total and runtime while unique history count remains stable.
- Provider-out-of-bounds rows count in statistics but not provider progress.
- Legacy rows without history fields continue using their existing progress aggregates until repaired.
- Movies represented as S00E00 continue to count because they are persisted watch rows.
- Refresh stats fails instead of materializing a partial repair if its bounded batch limit is exhausted.

## Verification

- Unit test history aggregation with a high season/episode outside ordinary provider bounds.
- Run TV Time import tests, TypeScript, lint, React Doctor, and a Convex production dry run.
- In production, use Refresh stats and verify the materialized runtime equals the sum of persisted
  watched-row runtime multiplied by watch count.
- Confirm provider-bounded `watchedEpisodesCount` values and Home projections do not change.

## Rollback

Remove the history fields and return Profile statistics to the existing progress aggregates. This keeps
provider progress unchanged but reintroduces undercounting whenever imported numbering differs from the
matched provider.
