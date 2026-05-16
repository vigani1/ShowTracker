# ADR 0004: Tracked IDs Projection Read

## Status

Accepted

## Context

The US Convex usage audit showed `shows.getTrackedIds` as a recurring read-heavy normal-app path. The query is used by Discover and Recommendations to build tracked-status maps for result cards.

Before this change, `shows.getTrackedIds` read up to 1000 `userShows` rows and then performed one `shows` document read per row. That N+1 shape made the cost scale with both the user's library size and the linked show hydration cost, even though the UI only needs compact identity and tracking state.

This does not directly change Home watchlist rows, schedule cache matching, schedule counts, or episode availability. It still touches tracked identity display for Discover and Recommendations, so the decision is recorded as an ADR and keeps provider identity behavior conservative.

## Current Behavior Before This Change

Before this change:

- Discover and Recommendations subscribed to `shows.getTrackedIds`.
- The query read `userShows` by current user.
- For each tracked row, it read the linked `shows` document.
- It returned only `mediaType`, `tmdbId`, `anilistId`, `status`, `watchedEpisodesCount`, and `totalEpisodes`.
- The frontend keyed TV/movie rows by TMDB ID and anime rows by AniList ID.
- MAL-only anime rows could be used for internal dedupe, but the public return shape did not expose `malId`, so the current frontend did not mark MAL-only result cards from this query.

## Decision

`shows.getTrackedIds` now reads from `feedProjections` by `userId` instead of reading `userShows` and hydrating each linked `shows` document.

The query preserves the same public return shape:

- `mediaType`
- `tmdbId`
- `anilistId`
- `status`
- `watchedEpisodesCount`
- `totalEpisodes`

The query also preserves the same duplicate preference policy:

- completed or watched entries win over unwatched entries;
- higher watched count wins next;
- the most recent projection activity timestamp is used as the final tie-breaker.

No schedule table, schedule cache row, Home feed query, watchlist count query, or provider matching helper is changed by this ADR.

## Reasoning

`feedProjections` already stores the compact denormalized fields needed by Discover and Recommendations. It is maintained by the tracking mutations and projection refresh paths that also support Home/watchlist views.

Using projections removes the per-row `shows` hydration from a frequently subscribed query. This is safer than changing frontend filtering behavior or adding a new cache because the query remains a normal Convex reactive read and keeps the same result contract.

The main risk is projection coverage. If a `userShows` row exists without a corresponding `feedProjections` row, Discover and Recommendations may fail to show that item as already tracked. The app already relies on `feedProjections` for Home/watchlist surfaces, so projection coverage is already operationally important. If missing projection rows are found, the fix should be a targeted projection rebuild or repair, not restoring N+1 hydration in this recurring query.

## Provider And Data Assumptions

This decision does not change provider trust or route identity rules.

- TMDB remains the tracked-card identity for TV and movie rows when a TMDB ID exists.
- AniList remains the tracked-card identity for anime rows when an AniList ID exists.
- MAL/Jikan remains available inside `feedProjections` for internal anime dedupe fallback, but this query still does not expose `malId` because the existing frontend return shape does not consume it.
- TVMaze and IMDb fields remain untouched and are not used by this tracked-card query.
- No title fallback is added. Missing provider IDs remain intentionally unmarked in Discover and Recommendations rather than using fuzzy title matching.

## Edge Cases

- Completed shows: still returned with `status: "completed"` and keep the completed/watched preference in duplicate collapse.
- Paused, dropped, planned, and not-started shows: still returned with their projection status and watched counts.
- Long-running shows: still use projected `totalEpisodes` and watched count for card badge state.
- Anime season aliases and franchise entries: no new alias matching is added; duplicate collapse still prefers AniList, then MAL internally, then the projection show ID.
- MAL-only anime: behavior remains effectively unchanged for the frontend because `malId` was not returned before this change.
- Missing provider IDs: still do not create frontend tracked keys.
- Same-title TV/anime rows: no title fallback is introduced, so TV and anime remain separated by media/provider identity.
- Future weekly rows, same-day duplicate episodes, schedule cache rows, and watchlist future counts: not affected because schedule queries and matching helpers are unchanged.
- Projection drift or missing projections: Discover/Recommendations may under-mark tracked cards. Roll back or run a projection repair if production evidence shows projection coverage is incomplete.
- Orphan projection rows: Discover/Recommendations may over-mark a removed title if a `feedProjections` row survives after its `userShows` row is deleted. Existing removal/reset paths are expected to delete projection rows; if production evidence shows orphans, repair the projection table rather than reintroducing per-row show hydration.

## Verification

Local validation for this change should include:

```bash
npx tsc --noEmit --pretty false
npx expo lint
git diff --check
```

Production verification after deploy should check:

- `shows.getTrackedIds` read I/O drops compared with the pre-change N+1 shape.
- Discover still marks tracked TV/movie cards that have TMDB IDs.
- Discover still marks tracked anime cards that have AniList IDs.
- Recommendations still filters or badges already-tracked results consistently.
- Home watchlist and schedule dashboard metrics remain unchanged, because those queries were not changed.

## Rollback Notes

If Discover or Recommendations stop marking tracked items correctly, first compare the user's `userShows` and `feedProjections` coverage. If projection rows are missing, repair or rebuild projections for the affected user.

Rollback is straightforward: restore `shows.getTrackedIds` to read `userShows` and linked `shows` documents. That brings back the previous N+1 Convex I/O cost, so it should only be used if projection coverage is proven unreliable and cannot be repaired quickly.
