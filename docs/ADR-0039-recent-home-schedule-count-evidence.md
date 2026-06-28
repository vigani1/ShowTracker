# ADR-0039: Recent Home Schedule Count Evidence

## Status

Accepted

## Context

On June 29, 2026, One Piece (`tmdb:tv:37854`) disappeared from the Home
Watchlist even though episode 1168 had aired on June 28, 2026 at 14:15 UTC and
the Schedule tab contained that episode. Opening the show detail repaired the
row immediately because the detail refresh wrote fresh provider progress:
`1167/1181` became actionable as `1 left`.

Production/VPS state before the detail repair showed the stale shape:

- `watchedEpisodesCount = 1167`
- `totalEpisodes = 1181`
- `remainingEpisodes = 0`
- `newEpisodeSignalAt` still pointed at the prior June 21 episode
- the schedule-confidence release fact had episode 1168 as `nextScheduled`,
  because the daily VPS run happened before the episode's 14:15 UTC airtime

This is related to ADR-0002 and ADR-0019. The cached Home schedule signal
action can patch `newEpisodeSignalAt` from schedule-cache rows in a recent
lookback window. However, ADR-0027 added a final Home display guard: a
zero-remaining row with a fresh schedule signal must also have actionable
schedule-count evidence. Before this decision, Home queried that count evidence
from `today` forward only. Once a just-aired episode was on the previous
calendar date, the signal could be valid while the display guard only saw
future rows and hid the show.

## Current Behavior Before This Change

Home opened the Watchlist and ran `schedule.syncHomeCachedScheduleSignals`.
That action used the existing 7-day recent release lookback and could identify
recent available schedule rows.

The Home screen separately queried `schedule.getFutureUpcomingCountsForWatchlist`
with `startDate = todayKey`. That meant the display guard did not count
yesterday's still-unwatched schedule row. For a stale projection with
`remainingEpisodes = 0`, the row could remain hidden until a detail page or the
next server reconciliation updated the projection's released/remaining counts.

## Decision

Home watchlist schedule-count evidence now starts 7 days before the client's
current Home date and still extends 90 days forward. This makes the count window
match the cached Home signal lookback window.

The change is limited to the Home Watchlist query arguments. It does not change
provider fetching, schedule-cache writes, provider matching, route IDs, duplicate
collapse, watched-episode suppression, or status mutations.

## Reasoning

The bug was a mismatch between two Home safeguards. The signal writer already
accepted recent schedule-cache evidence, but the display guard only accepted
today-forward count evidence. A row with recent valid schedule evidence could
therefore be patched as attention-worthy and then filtered out by a narrower
query.

Using the same 7-day bound keeps the behavior aligned with ADR-0019. It covers
post-airtime and catch-up-after-airdate cases without adding app-open provider
hydration or broad repair work. The schedule-count query still uses existing
provider matching, adjacent-date duplicate suppression, watched-episode anchors,
and future-only classification.

This also preserves ADR-0027's intent. Future-only rows are still hidden. The
difference is that a recent already-aired unwatched row can now back a fresh
schedule signal after the calendar day rolls over.

## Provider and Data Assumptions

Schedule-cache rows are compact provider facts maintained by the
schedule-confidence system. They are trusted as recent Home attention evidence
only through the existing conservative match and dedupe rules.

The 7-day lookback is not a provider refresh. If schedule-cache data is stale or
moved, the server-owned schedule-confidence workflow remains responsible for
pruning and replacing it.

Watched episode rows remain the source of truth for whether a schedule row has
already been consumed. Recent count evidence does not override watched anchors.

## Edge Cases

Rows that are caught up and have no fresh `newEpisodeSignalAt` are still not
selected by the active feed.

Rows with only future-known schedule events remain hidden when the count data
says there is no actionable episode for the current airtime mode.

Paused, dropped, and not-started rows keep their existing Home section rules.

Long-running shows with provider season disagreements continue to use the
existing schedule duplicate and watched-anchor rules before count evidence is
returned.

## Verification

Local validation run for this change:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm run schedule-confidence:validate`
- `npx convex deploy --dry-run --yes`
- `npx expo export --platform web --output-dir dist`
- `git diff --check`

The production scenario that motivated the change was One Piece episode 1168:
Schedule had the June 28 release, the projection still had `remainingEpisodes =
0`, and the row reappeared only after the detail route wrote fresh provider
progress.

Production Browser verification after deployment should confirm One Piece
remains visible without requiring a detail-page refresh when recent schedule
evidence exists.

## Rollback Notes

Rollback by restoring the Home watchlist count query start date to `todayKey` in
`app/(tabs)/home/index.tsx`.

If stale recent schedule rows appear after this change, inspect
`schedule.getFutureUpcomingCountsForWatchlist`,
`schedule.syncHomeCachedScheduleSignals`, watched-anchor suppression, and the
schedule-confidence pruning path before reducing the lookback or weakening
provider matching.
