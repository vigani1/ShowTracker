# ADR-0021: Provider-Verified Schedule Cache Total Pruning

## Context

On June 3, 2026, Dorohedoro (`tmdb:tv:94404`) showed as caught up on the details page with `23/23` watched episodes, but the Schedule page still showed a new Dorohedoro `Episode 12` on June 3.

Production data showed the schedule entry came from the anime schedule cache:

- `scheduleCache` date `2026-06-03`, media type `anime`, provider row `anilist:173172`, normalized title `dorohedoroseason2`, `S01E12`, `Episode 12`, `2026-06-03T14:00:00.000Z`.
- `feedProjections` for Dorohedoro had `tmdbId: 94404`, `tvmazeId: 44383`, `watchedEpisodesCount: 23`, `totalEpisodes: 23`, and `remainingEpisodes: 0`.
- `userScheduleEvents` copied that stale cache row into the user's projection as route `tmdb:tv:94404` through the existing anime season title bridge.

Current provider checks showed the cached row was stale. AniList `173172` reports Dorohedoro Season 2 as `FINISHED`, `episodes: 11`, with no `nextAiringEpisode`; Jikan/MAL `57779` reports `Finished Airing`, `episodes: 11`, ending May 27, 2026; TVMaze `44383` lists season 2 through episode 11 on May 27, 2026.

## Current Behavior

Before this change:

- The server-owned schedule-confidence flow could refresh tracked show release facts and same-show schedule rows.
- `scheduleCache` pruning could remove entries whose `episodeNumber` exceeded a provider total, but only as part of a release delta that matched a tracked `shows` row.
- Dorohedoro's stale row did not have a durable provider ID on the tracked TMDB show. It entered through `anilist:173172` and then matched the TMDB show later by title alias.
- `applyReleaseDeltas` skipped cache maintenance when no `shows` row matched the provider IDs in a delta.
- The schedule projection copied the stale row from `scheduleCache` into `userScheduleEvents`, so the Schedule page showed an episode that the current provider metadata no longer considered real.

## Decision

The schedule-confidence apply step now validates AniList schedule-cache provider rows in the projection window against current AniList media metadata. When AniList says a media item is finished/cancelled and has a concrete total episode count, any cached AniList row above that total emits a cache-only maintenance delta.

Cache-only maintenance deltas:

- use the cache row's own durable provider ID, such as `anilist:173172`;
- include the provider-confirmed total and latest valid cached episode when available;
- are applied before user schedule projections are regenerated;
- may update `scheduleCache` even when no tracked `shows` row has that provider ID.

The existing `scheduleCache` pruning logic remains the place that edits cache rows. The new server step only supplies provider-confirmed stale-cache evidence for rows that were not reachable through tracked show IDs.

## Reasoning

Hiding completed or caught-up shows in schedule queries would be too broad. A caught-up show can still have a real future episode, and Schedule should show it.

Hard-coding Dorohedoro or assuming every `Episode 12` is stale would be too narrow and unsafe. The reliable fact is provider-local: an AniList cache row for `anilist:173172` cannot legitimately have episode 12 when current AniList metadata says that same media is finished with 11 episodes.

Applying cache maintenance before schedule projection keeps both source and projection data aligned. The stale source row is removed first, then `userScheduleEvents` is rebuilt without copying it.

Allowing cache-only maintenance to run without a matched `shows` row is necessary because title-bridged schedule rows can be valid or stale before the tracked show has a durable provider ID for that anime season.

## Provider/Data Assumptions

Provider IDs are trusted for pruning only within their own provider namespace. An AniList total can prune `anilist:<id>` cache rows for the same ID; it does not prune unrelated TMDB, TVMaze, IMDb, or title-only rows.

AniList finished/cancelled metadata with a positive `episodes` value is treated as authoritative for season-local AniList schedule rows above that episode number.

Title fallback is not broadened. The cache-only maintenance delta is keyed by the cached provider ID, not by a guessed title match.

TMDB/TVMaze remain trusted for the tracked Dorohedoro TV row. The new rule only removes the stale AniList cache prediction that current AniList itself invalidates.

## Edge Cases

Completed shows with new releases still reappear when a provider has a real next or latest unwatched release. This change removes only provider rows above the same provider's finished total.

Paused and dropped shows are unchanged. Cache pruning is global provider-cache maintenance, not a user status transition.

Planned/not-started shows still keep schedule visibility for valid future provider rows. Invalid rows above a finished provider total are removed for everyone.

Long-running shows are protected because pruning is provider-local and total-backed. It does not reinterpret absolute TV numbering or cumulative counts.

Anime season aliases still work. A real AniList season with valid episode numbers remains available for the existing anime season title bridge.

Missing provider IDs on tracked shows no longer block stale-cache cleanup when the cache row itself has a durable provider ID.

Title fallbacks remain conservative. Cache-only maintenance does not patch tracked show provider IDs and does not make a low-confidence title match a durable link.

Same-day duplicate logic from ADR-0020 remains unchanged. This change handles a different stale-cache shape: a single provider row above the provider-confirmed total.

Future weekly rows remain visible unless the row's own provider says the media is finished/cancelled with fewer episodes.

Stale provider totals are handled by rechecking current provider metadata at apply time. If AniList later corrects a total upward, rows within the new total are not pruned.

## Verification

Production diagnosis before the change:

- `npx convex data --prod shows --limit 1000 --format json` confirmed Dorohedoro `tmdbId: 94404`, `tvmazeId: 44383`, `totalEpisodes: 23`, `releasedEpisodes: 23`.
- `npx convex data --prod feedProjections --limit 2000 --format json` confirmed the user's Dorohedoro projection had `watchedEpisodesCount: 23`, `remainingEpisodes: 0`.
- `npx convex data --prod scheduleCache --limit 5000 --format json` confirmed the stale June 3 row was `anilist:173172`, `dorohedoroseason2`, `S01E12`.
- `npx convex data --prod userScheduleEvents --limit 10000 --format json` confirmed that stale row had been projected to `routeId: "tmdb:tv:94404"` with `sourceProvider: "anilist"` and `matchConfidence: "title_fallback"`.
- AniList GraphQL for `Media(id: 173172)` returned `status: FINISHED`, `episodes: 11`, `nextAiringEpisode: null`.
- Jikan for MAL `57779` returned `Finished Airing`, `episodes: 11`, ending May 27, 2026.
- TVMaze for show `44383` listed Dorohedoro season 2 through episode 11 on May 27, 2026.

Local verification:

- `npm run schedule-confidence:validate` now includes a fixture where a finished AniList provider cache row above provider total emits one cache-only maintenance delta.
- `node --check scripts/schedule-confidence.mjs`
- `npx tsc --noEmit --pretty false`
- `npx convex deploy --dry-run --yes`
- `git diff --check -- . ':!.schedule-confidence'`

## Rollback Notes

If valid AniList future schedule rows disappear, first inspect `buildScheduleCacheProviderMaintenanceDeltasFromMedia` and the `scheduleCacheMaintenanceVersion` 3 cache-only deltas.

The conservative rollback is to disable cache-only maintenance generation in `applyConvex` while leaving ADR-0020 duplicate suppression and tracked-show release deltas intact.

If cache rows remain stale after rollback, regenerate schedule projections from the unmodified `scheduleCache` so user projections match the source cache again.
