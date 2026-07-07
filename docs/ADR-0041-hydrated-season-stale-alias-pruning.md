# ADR-0041: Hydrated Season Stale Alias Pruning

## Status

Accepted

## Context

On July 7, 2026, production Home showed `Demon Slayer: Kimetsu no Yaiba`
and `The Apothecary Diaries` in the active Watchlist even though both should
have been caught up.

The VPS reconciler had cached stale provider rows:

- Demon Slayer had a stale TMDB `S05E18` row dated September 8, 2024, while
  current TMDB details say the ended show has 63 regular episodes and season 5
  ends at `S05E08`.
- Apothecary had a stale TMDB `S01E49` dated October 1, 2026, while current
  TMDB season detail exposes episode 49 with no air date and no
  `next_episode_to_air`.
- Apothecary also has provider numbering disagreement: TMDB represents the
  July 4, 2025 finale as `S01E48`, while TVMaze represents the same release as
  `S02E24`.

ADR-0040 added a watched-anchor-backed released floor for returning seasons.
That fixed real new releases such as Mushoku Tensei, but the floor was too
permissive for old cached provider aliases: old TVMaze season-local rows that
the user had already watched through could be counted as newly unwatched rows
because their exact season/episode numbers did not match TMDB-style watched
anchors.

## Current Behavior

Before this decision, TMDB fetch pruning used regular-season summary counts.
If the summary still included an undated placeholder or stale count, a cached
dated row inside that count could survive even when fresh season detail no
longer supported that dated row.

The watched-anchor floor also counted any released provider row whose exact
season/episode key was not in the watched-anchor set. It did not require that
the provider row aired on or after the user's latest watch day. Old cross-
provider aliases could therefore inflate released counts:

- Demon Slayer projected `64/64` with `1 left`.
- Apothecary projected `72/72` with `24 left`.

## Decision

TMDB provider refresh now hydrates the last-aired regular season as well as the
next scheduled season. For hydrated seasons, pruning treats the fresh season
detail as an exact episode identity set. Cached TMDB rows in that hydrated
season are removed when they are not present as fresh dated/current provider
events, even if the summary episode count still includes the number.

The watched-anchor-backed released floor now ignores provider rows whose air
date is before the user's latest watch day. Rows on the same UTC day as the
latest watch still count, preserving same-day multi-episode drops where the
user watched one released episode and another released episode remains.

When there are no known future rows, fresh provider metadata can also cap a
larger stale imported total even if the provider has an undated placeholder and
`releasedEpisodes < totalEpisodes`. The released/watchable count remains the
released metadata value; the catalog total is capped to the fresh provider
total instead of the stale Convex/imported total.

## Reasoning

Fresh TMDB season detail is stronger than cached dated provider rows for the
same provider/show/season. Summary episode counts can include undated
placeholders, but Home attention needs released/watchable facts, not planned
or stale date rows.

Watched anchors are useful evidence for new returning-season rows, but only
when those rows plausibly happened after the user's watched anchor history.
Old provider aliases that aired before the latest watch day should not wake
Home just because providers disagree about season numbering.

This keeps ADR-0040's Mushoku behavior: July 4, 2026 S03 rows remain counted
after a prior-season April 2026 last watch, and a same-day partial watch still
counts the other same-day released row.

The metadata total cap is needed after a bad delta has already poisoned Convex:
once the stale dated future row is pruned, the imported row can still say
`72 total / 24 remaining`. Fresh provider metadata saying `48 released / 49
total` is the stronger source for release projection.

## Provider/Data Assumptions

TMDB `/tv/:id/season/:seasonNumber` is authoritative enough to prune cached
TMDB rows for that same regular season when the season fetch succeeds.

TMDB season `0` specials remain outside regular progress and Schedule
maintenance under ADR-0037.

TVMaze and TMDB can represent the same anime run with different season
numbering. Exact watched anchors should not treat old alternate numbering as
new backlog when the row predates the user's latest watch day.

## Edge Cases

A same-day multi-episode release remains visible after the user watches one
episode, because rows on the latest watch date still count.

If TMDB later adds an air date for Apothecary episode 49, the next provider run
will insert it as a fresh current event and Home can surface it normally.

If a stale cached row is outside the normal recent/future prune window but
belongs to a freshly hydrated TMDB season, it is still pruned because that row
can affect release facts even when it no longer affects Schedule.

Rows from providers without a fresh complete season payload keep existing
pruning behavior.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
node --check scripts/schedule-confidence.mjs
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation covers:

- stale TMDB `S05E18` inside a freshly hydrated Demon Slayer season 5 being
  pruned and producing `63/63` caught up;
- stale TMDB `S01E49` inside a freshly hydrated Apothecary season 1 being
  pruned;
- old TVMaze `S02E01`/`S02E24` Apothecary aliases not inflating watched-anchor
  released counts after the user's latest watch day, while fresh `48/49`
  provider metadata caps the stale imported `72` total;
- ADR-0040's same-day returning-season partial-watch case still producing a
  positive released backlog.

Production verification should run the VPS schedule-confidence job after merge
and confirm live Home no longer shows Demon Slayer or Apothecary as active
Watchlist rows when the corrected facts are caught up.

## Rollback Notes

Rollback by restoring TMDB hydration to next-season-only, removing
`exactSeasonNumbers` pruning, and removing the latest-watch-day guard from
`getWatchedAnchorBackedReleasedEpisodeFloor`.

If rollback is considered because a valid newly released row is hidden, inspect
whether the row's air date is before, on, or after the user's latest watch day
before weakening the guard.
