# ADR-0024: Home Watchlist Tab Return Stability

## Context

Home uses one screen for both the Watchlist and Schedule modes. To keep Convex
subscriptions scoped to the active mode, Watchlist feed and schedule-count
queries are skipped while the Schedule tab is active.

ADR-0022 made Home hold resolved Watchlist feed pages during pagination
refetches, but that stabilization only covered loading states while Watchlist
was still the active tab.

## Current Behavior

Before this change, switching from Watchlist to Schedule caused the skipped
Watchlist queries to resolve as `undefined`. The stable feed hooks did not treat
the inactive Schedule tab as a loading state, so the displayed Watchlist feed
values also became `undefined`.

That transient empty state cleared the settled Watchlist snapshot and clamped
visible section counts. Returning to Watchlist then reattached the Convex
queries and briefly rendered a partial/skeleton Watchlist: active rows could
appear before Paused and Backlog sections returned, creating a fast visible
flicker.

## Decision

Home now treats the inactive Schedule tab as a held loading state for Watchlist
feed data and future schedule-count data. The last resolved Watchlist active,
same-day scheduled, paused, not-started, and future-count rows remain available
while Schedule is active.

The settled Watchlist snapshot is no longer cleared while Schedule is active.
It is cleared only when Watchlist is active and the current Watchlist context has
no resolved data, such as a true first load or a media-filter context change.

## Reasoning

Switching tabs should preserve the user's previous Watchlist view. The Schedule
tab's skipped queries mean "not subscribed right now", not "the Watchlist has no
rows." Holding the prior same-context values prevents the UI from recalculating
sections against empty arrays and an empty future-count map.

This extends ADR-0022's display-stability principle from pagination refetches to
Home mode switching without keeping unused Convex subscriptions alive.

## Provider/Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb, route IDs, canonical keys, anime aliases,
bridge IDs, title fallback, provider matching, schedule projection reads, and
duplicate suppression are unchanged.

Future schedule counts remain keyed by the same start date, end date, and media
filter. Held counts are reused only for the same context key.

## Edge Cases

Changing the media filter while Schedule is active uses a different Watchlist
context key. Old Watchlist rows are not reused for the new filter; returning to
Watchlist can show the normal initial loading state until the new context
resolves.

If a user opens Home directly into Watchlist with no prior Watchlist snapshot,
the initial skeleton still appears.

Local day rollover changes the same-day scheduled feed key and future-count date
window. The previous day's Watchlist data is not held across that context change.

If provider facts or projections update while the user is on Schedule, the held
Watchlist view is only a visual bridge. Returning to Watchlist reattaches the
queries and refreshes the display once the new data resolves.

## Verification

Static checks:

- `npx tsc --noEmit --pretty false`
- `npx expo lint`

Manual regression target:

- On production web Home, start on Watchlist with active, Paused, and Backlog
  sections visible.
- Switch to Schedule, then back to Watchlist.
- Watchlist should return without a full or partial loading flicker; Paused and
  Backlog sections should remain present through the transition.

## Rollback Notes

Revert the Home stable feed/count holding changes in
`app/(tabs)/home/index.tsx` if Watchlist starts showing stale rows after
media-filter or local-day changes. Do not change provider matching, Convex
schedule functions, schedule projection generation, or duplicate suppression as
part of that rollback.
