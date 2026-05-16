# ADR 0002: Watchlist Schedule Cache Bridge and Provider Route Fallbacks

## Status

Accepted

## Context

The Home watchlist and Schedule views depend on several overlapping data paths:

- `feedProjections` holds the reactive watchlist rows and episode counts.
- `scheduleCache` holds schedule facts produced from provider data and the external reconciler.
- Home attention logic uses `remainingEpisodes`, `newEpisodeSignalAt`, future schedule counts, and the user's watch status to decide which rows deserve attention.
- Schedule rows use provider IDs, route IDs, normalized titles, watched episode rows, and cross-provider dedupe logic to attach schedule facts back to tracked shows.

This area has repeatedly regressed because provider data does not arrive in one consistent shape. A show can be tracked through TMDB or AniList while schedule facts may arrive through TVMaze, AniList, TMDB, IMDb, or a title fallback. Provider totals can lag behind same-day schedule rows, especially for long-running shows or shows with new releases. That caused valid schedule rows to appear in the Schedule tab but not in the Home watchlist attention feed, or to open a route that the app could not parse.

The concrete bugs behind this decision were:

- A tracked show could have a same-day schedule row, but still appear as `Caught up` or fail to show on Home because `remainingEpisodes` had not caught up yet.
- Convex schedule/list/feed helpers could emit `tvmaze:tv:*` or `imdb:*` route IDs, while the app route parser only accepted `tmdb`, `anilist`, and `jikan`.
- A broad TV/anime title fallback can reintroduce duplicate or wrong-row schedule matches, especially when TVMaze and anime providers disagree about season identity or when the user tracks a TV entry and an anime entry with similar titles.

## Current Behavior Before This Change

Before this ADR's change set:

- Home mainly trusted projection counts for the card badge and attention rows.
- A same-day schedule fact could be visible in Schedule but not represented as Home attention when provider episode totals lagged.
- Home cards could show `Caught up` even when the current day had an unwatched scheduled episode.
- Route helpers in Convex could return provider route IDs the app did not understand.
- Schedule title fallback behavior was easy to broaden accidentally because the duplicate-prevention intent was not documented.

## Decision

Use the schedule cache as an additional same-day Home attention signal, but keep the watchlist projection as the primary reactive row source.

The implementation adds `schedule.getTodayScheduledWatchlistFeed`, which reads the selected/current day from `scheduleCache`, attaches entries to tracked projections, removes already-watched episodes, dedupes by watchlist route, and returns compact `ScheduledWatchlistItem` rows. Home then merges those rows with the normal watchlist feed so a same-day scheduled release can surface even if provider totals or `remainingEpisodes` lag.

Home card badges now treat same-day scheduled attention as authoritative for display. If a row has no positive `remainingEpisodes` but does have a same-day scheduled unwatched episode, the card shows the scheduled count instead of `Caught up`.

The app also accepts provider route IDs already emitted by Convex:

- `tvmaze:tv:<id>`
- `imdb:<mediaType>:tt...`

TVMaze show routes load TVMaze show details and episodes directly. IMDb routes first try TMDB `/find` and then, for TV, fall back to TVMaze lookup by IMDb ID.

Provider title fallback remains intentionally conservative:

- Provider ID matches always win.
- TVMaze/TV schedule rows may title-match tracked TV rows only.
- AniList/anime schedule rows may bridge TV/anime title aliases when needed for anime season alias cases.
- TVMaze/TV rows must not broadly title-match tracked anime rows unless a provider ID links them.

## Reasoning

The Home bug was not that the projection model should be replaced. Projections are still the right primary source for user-specific watchlist state because they carry status, watched counts, remaining counts, sort state, and reactive updates. The missing piece was that same-day schedule cache facts can be newer or more precise than provider totals. Treating schedule cache rows as an additional same-day attention signal fixes that without rebuilding Home around schedule data.

The route fallback is safe because Convex already emits TVMaze and IMDb route IDs. Supporting those IDs prevents valid rows from navigating to an invalid show page. It does not change which shows are tracked or matched; it only makes existing provider identities navigable.

The title fallback rule is deliberately narrower than a simple "match same normalized title across all TV/anime rows" approach. Broad title matching can hide duplicates in one case but create wrong matches in another. Schedule matching must prefer durable provider IDs and only use title fallback where the provider's media model requires it. Anime season aliases are the known bridge case; TVMaze TV rows are not allowed to bridge into anime rows by title alone.

## Provider and Data Assumptions

- TMDB remains the main catalog source for TV/movie detail pages when a TMDB ID exists.
- AniList remains the preferred anime identity when an AniList ID exists.
- Jikan/MAL remains an anime fallback route only.
- TVMaze is trusted for TV schedule facts and as a TV detail fallback when a TVMaze route is the only available route.
- IMDb is treated as an external bridge. IMDb routes should resolve through TMDB first, then TVMaze for TV.
- Title fallback is lower confidence than provider ID matching and must be constrained by media/source rules.
- `newEpisodeSignalAt` is an authoritative schedule signal and must not require `remainingEpisodes > 0`.
- Same-day schedule attention is valid even when provider episode totals have not yet updated.

## Edge Cases Covered

- Completed shows with new releases can reappear when `newEpisodeSignalAt` or same-day schedule facts indicate new unwatched material.
- Paused shows can remain present in Schedule but should not become active Home attention.
- Dropped shows can remain visible in Schedule if the Schedule view intentionally includes them, but they should not become active Home attention.
- Planned/not-started shows should not be promoted to active Home watchlist attention just because they have a schedule row.
- Long-running shows may have provider season disagreements; dedupe must include season and episode identity and must not rely on title alone.
- Anime season aliases can require AniList/anime title fallback across closely related TV/anime tracked entries.
- TVMaze/TV rows must not broadly title-match anime entries by title alone.
- Missing provider IDs should produce conservative behavior, not broad cross-media matching.
- Same-day duplicate provider rows should collapse to one row per watchlist route, preferring the row whose source media matches the tracked row and then the better schedule episode candidate.
- Future weekly rows still come from schedule cache and future count logic; this change only adds a same-day Home bridge.
- Stale provider totals should not force a card to say `Caught up` when schedule cache has an unwatched current-day episode.

## Verification

Validation commands run for this change set:

```powershell
npx tsc --noEmit
npx expo lint
git diff --check
npx convex deploy --dry-run --yes
```

Convex functions were also deployed to the production US deployment after the dry run passed.

Known scenario checks motivating this ADR:

- Detective Conan and Daemons of the Shadow Realm were visible in Schedule for the current day but did not reliably appear as Home watchlist attention.
- Detective Conan could show as `Caught up` despite a current-day scheduled episode because projection counts lagged the schedule fact.
- The Beginning After the End required careful TV/anime alias handling without treating every TVMaze TV row as an anime title fallback.
- Prior duplicate issues around SpongeBob, One Piece, Witch Hat Atelier, Dr. STONE, Slime, Classroom of the Elite, Re:ZERO, The Boys, and The Beginning After the End showed why schedule matching needs documented source and dedupe rules.

Future verification for changes touching this area should include a UI or query-level simulation across at least one week, selected-day Schedule counts, Home active attention rows, paused rows, not-started rows, completed-show reactivation, and route navigation for provider fallback IDs.

## Consequences

- Home has a small additional same-day schedule query while on the watchlist tab.
- Home can show schedule attention even when `remainingEpisodes` is zero or stale.
- TVMaze-only and IMDb-only provider routes can open a show page instead of failing route parsing.
- TVMaze detail pages may have less rich imagery than TMDB because TVMaze does not provide the same poster/backdrop split.
- The schedule matcher is intentionally less aggressive than a broad title-matching implementation; missing provider IDs may still require audit resolution rather than automatic matching.
- Future agents must not broaden TV/anime title fallback without a new ADR that explains the bug, duplicate risk, provider assumptions, and verification evidence.

## Alternatives Considered

- Trust `remainingEpisodes` only: rejected because provider totals can lag current-day schedule facts and hide valid releases.
- Rebuild Home entirely from schedule cache: rejected because Home needs user-specific projection state, status rules, watched counts, and stable sorting.
- Broadly title-match TV and anime schedule rows: rejected because it can reintroduce duplicates or wrong matches across providers and similarly titled entries.
- Add only route parser support and leave Home unchanged: rejected because it fixes "not found" navigation but not the missing Home attention bug.
- Force provider/reconciler repair before display: rejected because display should remain correct when compact schedule facts are already available but provider totals are stale.

## Rollback Notes

If Home starts showing incorrect active rows, first inspect the merge between normal watchlist rows and `getTodayScheduledWatchlistFeed`. Reverting only the Home same-day bridge should preserve normal projection-based watchlist behavior.

If duplicate schedule rows return, inspect `findTrackedScheduleMatch`, `selectedByRoute`, and same-day episode dedupe before broadening title fallback. Do not remove the rule that TVMaze/TV rows stay same-media unless provider IDs match.

If provider fallback show pages break, inspect `parseShowRouteId`, `createShowRouteId`, the TVMaze route branch in `app/show/[id].tsx`, and IMDb lookup fallback order.
