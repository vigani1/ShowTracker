# ADR-0036: Terminal Imported Backlog Needs Metadata Confirmation

## Status

Accepted

## Context

On June 20, 2026, production Home hid `Ozark` (`tmdb:tv:69740`) again after
the schedule-confidence VPS run. The user's prior Home screenshot showed Ozark
as an active Watchlist row with `6/44 episodes`, `38 left`, and `Watching`.

Production after the run showed:

- `shows.status = ended`
- `shows.totalEpisodes = 44`
- `shows.releasedEpisodes = 6`
- `feedProjections.status = watching`
- `feedProjections.watchedEpisodesCount = 6`
- `feedProjections.remainingEpisodes = 0`

The VPS SQLite state showed the reconciler imported the correct projection
backlog before applying deltas:

- `library_items.remaining_episodes = 38`
- `library_items.total_episodes = 44`
- `library_items.watched_episodes_count = 6`

It then emitted an Ozark delta with `releasedEpisodes = 6` and
`simulatedProjection.remainingEpisodes = 0` because the local provider-event
cache had only one old TMDB event: the season 4 finale, `S04E14`, on
`2022-04-29`.

## Current Behavior

ADR-0030 allowed terminal known totals to rescue rows whose released count had
collapsed to zero.

ADR-0032 narrowed that rule because some terminal shows have raw catalog totals
larger than their watchable released count. It kept sparse-old-history capping
active when a positive released/watchable denominator already existed.

That left a gap: an imported active backlog such as Ozark's `6 watched + 38
remaining = 44 watchable` could still be capped down to the watched count when
the provider-event cache had only one old event, even if fresh provider detail
metadata also said 44 episodes were released.

## Decision

Schedule-confidence now preserves imported active backlog for terminal TV/anime
rows only when fresh provider metadata backs that imported watchable count.

The new rule requires:

- terminal lifecycle status,
- no known future provider events,
- an imported positive remaining backlog,
- provider metadata `releasedEpisodes` greater than or equal to the imported
  watched-plus-remaining count.

When those conditions hold, timestamp-only sparse-old capping does not collapse
the row to watched progress.

When imported backlog is larger than provider metadata supports, the existing
ADR-0032 cap remains active and the row stays caught up.

## Reasoning

Ozark's imported backlog was already correct, but one old event was too little
evidence to preserve it under the ADR-0032 guard. Fresh provider metadata is the
missing authority: it comes from provider detail payloads such as TMDB show
details, not from the raw imported terminal total alone.

This keeps the prior false-positive protection. A fully watched terminal row
with `161 released`, `184 total`, and a stale imported `23 remaining` does not
become active unless provider metadata also confirms 184 released episodes.

## Provider/Data Assumptions

Provider metadata `releasedEpisodes` is stronger than a sparse local
provider-event cache when a terminal show has no future events.

Raw terminal totals alone are still not enough to override a positive provider
released/watchable denominator.

Imported remaining backlog is user-facing state, but it needs provider metadata
confirmation before it can defeat sparse-old timestamp capping on terminal rows.

## Edge Cases

Ozark-shaped rows with `6 watched`, `38 imported remaining`, `44 total`, one old
finale event, and provider metadata `44 released` remain active with `38 left`.

Billy-and-Mandy-shaped rows with `161 watched`, stale imported `23 remaining`,
`184 total`, and provider metadata `161 released` remain caught up.

Terminal rows with no imported remaining backlog continue to use ADR-0030's
zero/missing released-count rescue.

Ongoing shows are unchanged and continue to use provider release facts instead
of raw totals.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation includes:

- a terminal metadata-backed Ozark-shaped row that must produce
  `releasedEpisodes = 44`, `releaseState = available_now`, and Home attention;
- a terminal mismatched-imported-backlog row that must remain
  `releasedEpisodes = 161`, `releaseState = caught_up`.

Production verification should run the VPS schedule-confidence job after merge
and confirm live Home shows Ozark as an active Watchlist row with `38 left`.

## Rollback Notes

Rollback by removing the metadata-backed imported backlog branch in
`scripts/schedule-confidence.mjs` and deleting the paired fixture assertions.

If rollback is considered because terminal false positives return, inspect
whether provider metadata actually confirms the imported watched-plus-remaining
count before weakening this rule.
