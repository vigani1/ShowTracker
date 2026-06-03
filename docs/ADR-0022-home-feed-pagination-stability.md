# ADR-0022: Home Feed Pagination Stability

## Context

The Home Watchlist secondary sections can contain more rows than the initial
Convex query limit. When a user presses "Show more" enough times, the requested
limit increases so the next page can be fetched.

On web, that limit change can briefly make the section queries return
`undefined` while Convex resolves the new arguments. The Home screen previously
treated that transient state as an empty feed.

## Current Behavior

Before this change, paused and not-started section arrays were derived with
`feed ?? []`. During a limit refetch, those arrays became empty. The effects
that keep visible counts within the loaded section length then clamped the
expanded count back down.

Because Home also treated any unresolved section query as full watchlist
loading, the web `ScrollView` temporarily swapped to the skeleton layout. That
could collapse the expanded section and reset the scroll position toward the top
of the page.

## Decision

Home now keeps the last resolved active, paused, not-started, and same-day
scheduled feed values on screen while a same-context watchlist query is loading.
The stable context includes the media filter and, for same-day scheduled rows,
the current local day. It intentionally excludes pagination limits so expanding a
section does not erase the previous page while the larger query resolves.

The visible-count clamping effects now operate against those stable feed values,
so a transient Convex loading state cannot collapse an expanded section.

## Reasoning

Pagination should be additive from the user's point of view. Holding the last
resolved page during a larger-limit fetch preserves the visible section and
scroll position without changing which rows are eligible for Home.

This follows the existing Home pattern of stabilizing display values during
loading, but applies it to the section feed pages that drive the "Show more"
buttons.

## Provider/Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb, route IDs, canonical keys, title
fallback, anime relation rules, and low-confidence provider matching are
unchanged.

Feed projections remain the source for active, paused, and not-started Home
rows. Schedule-cache facts and same-day scheduled rows keep their existing
matching and dedupe behavior.

## Edge Cases

Changing the media filter uses a different stable context, so old all/TV/anime
rows are not held across filter changes. Same-day scheduled rows are not held
across a local day rollover.

If a section has loaded exactly to the previous query limit and the next larger
query is still pending, the existing rows remain visible. The "Show more" button
can temporarily hide until the larger result resolves if there are no known
loaded rows beyond the visible count.

Active, paused, not-started, completed, dropped, and upcoming eligibility rules
are not changed. Completed-show reactivation, auto-paused visibility, stale
release signals, duplicate schedule rows, and future-only filtering are not
changed.

## Verification

Static checks:

- `npx tsc --noEmit --pretty false`
- `npm run lint`

Manual regression target:

- On Home Watchlist web, expand the "Haven't started" or paused section past the
  initial secondary query limit. The section should keep the expanded rows while
  the next page loads and should not jump back to the top skeleton state.

## Rollback Notes

Revert the stable feed display values in `app/(tabs)/home/index.tsx` if Home
starts holding stale rows across media-filter changes or if initial watchlist
loading no longer shows the skeleton. Do not change provider matching, schedule
cache, or projection serialization as part of that rollback.
