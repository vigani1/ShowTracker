# ADR-0027: Home Caught-Up Schedule Signal Guard

## Context

On June 11, 2026, production Home showed `Classroom of the Elite`
(`tmdb:tv:72517`) in the active Watchlist as `52/52 episodes` with status
`WATCHING`.

The production show state was correctly split between released and future-known
episodes:

- `shows.totalEpisodes = 54`
- `shows.releasedEpisodes = 52`
- `feedProjections.watchedEpisodesCount = 52`
- `feedProjections.remainingEpisodes = 0`
- `watchlistFutureCountProjections.availableCount = 0`
- `watchlistFutureCountProjections.futureCount = 2`

The row also had `newEpisodeSignalAt = lastWatchedAt + 1`. That signal shape is
valid for catch-up-after-airdate rows from ADR-0019, but in this case the
schedule-count projection proved there were no available episodes left and the
only known episodes were future rows.

## Current Behavior

Before this change, the Home active Watchlist filter treated
`newEpisodeSignalAt > lastWatchedAt` as enough to keep a row visible even when
`remainingEpisodes <= 0`.

That preserved valid cases such as a newly available episode whose provider
total had not yet increased, but it also allowed stale schedule signals to keep
caught-up rows visible. A future-only row could therefore appear as active
attention with `52/52 episodes`, even though the same Home schedule-count data
said there was nothing watchable now.

## Decision

Home now treats a fresh schedule signal as displayable only when it is backed by
actionable availability for the current airtime mode.

The active Watchlist filter still accepts schedule-count attention:

- in `same_day` mode, same-day schedule rows can surface attention before exact
  airtime;
- in `after_airtime` mode, only rows counted as available can surface attention;
- a positive `remainingEpisodes` value can still surface backlog unless the
  schedule-count data proves all remaining episodes are future-only.

For rows that are already caught up by released/watchable progress
(`remainingEpisodes <= 0`), `newEpisodeSignalAt` alone no longer overrides the
schedule-count result. If the count says `availableCount = 0` and all known
unwatched rows are future rows, the row is hidden from the active Watchlist.

## Reasoning

ADR-0009 and ADR-0026 define Home and detail progress around "what can I watch
now?" rather than raw planned totals. ADR-0017 and ADR-0019 allow schedule
signals to bridge provider lag, but those signals are not stronger than concrete
schedule-count evidence that the user is already caught up.

Keeping this as a final client display guard limits the blast radius. Convex can
continue sending rows with schedule signals as candidates, and the schedule
signal maintenance path can still clear stale `newEpisodeSignalAt` values when
it runs. The Home UI simply refuses to display a zero-remaining candidate when
the same Home count projection says there is no actionable episode.

## Provider/Data Assumptions

`releasedEpisodes` remains the watchable denominator when present. Raw
`totalEpisodes` can include future-known episodes and must not create Home
attention by itself.

`newEpisodeSignalAt` remains a candidate release-attention signal. It can be
normalized to after `lastWatchedAt` for catch-up-after-airdate rows, but it must
still agree with read-time schedule-count availability before a caught-up row is
shown.

`watchlistFutureCountProjections` and the schedule-cache fallback remain the
source of truth for whether unwatched schedule rows are available, same-day, or
future-only under the user's airtime mode.

Provider matching, route IDs, TMDB, TVMaze, AniList, Jikan/MAL, IMDb bridge IDs,
anime aliases, title fallback, duplicate collapse, and schedule-cache pruning
are unchanged.

## Edge Cases

A caught-up show with a real available schedule row still appears because its
schedule-count attention is positive.

A caught-up show with only future rows is hidden until those rows become
available under the selected airtime mode.

Completed shows still require displayable schedule attention before re-entering
the active Watchlist.

Paused, dropped, not-started, and upcoming-tracking rows keep their existing
section rules.

If future-count data is still loading, Home's existing Watchlist settling state
continues to hold the prior resolved snapshot instead of finalizing the filter
against an unresolved count map.

## Verification

Required checks for this change:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `git diff --check`
- `npx convex deploy --dry-run --yes`

Production Browser verification should open Home while logged in and confirm:

- `Classroom of the Elite` no longer appears in the active Watchlist when it is
  `52/52 episodes` with only future-known episodes remaining.
- Valid active rows with real availability, such as `Dr. STONE`, remain visible.
- Paused and backlog sections still render after the active Watchlist.

## Rollback Notes

Rollback by reverting the Home active Watchlist filter change in
`app/(tabs)/home/index.tsx`.

If valid caught-up shows with newly available schedule rows disappear, inspect
`getWatchlistScheduleAttentionCount`, `hasWatchlistActionableEpisode`, and
`schedule.syncHomeCachedScheduleSignalsForUser` before weakening provider
matching or changing Convex projection writes.
