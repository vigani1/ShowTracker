# API Reference

ShowTracker uses external providers for catalog, schedule, identity, and release facts. Provider clients live in `lib/api/` and return normalized types from `lib/api/types.ts`.

Agents should read this doc before changing provider calls, route IDs, normalized media fields, release counts, or schedule facts. Provider behavior often affects Home and Schedule indirectly through Convex projections and the VPS schedule-confidence reconciler.

## Provider Roles

| Provider | Role |
| --- | --- |
| TMDB | Primary TV/movie catalog, movie details, TV seasons/episodes, posters/backdrops, external IDs |
| TVMaze | TV search/detail fallback, TV episode lists, country schedule, web/streaming schedule |
| AniList | Anime search/trending, anime identity, airing facts, relation graph |
| Jikan/MAL | Anime fallback/enrichment, MAL identity bridge, episode pages where useful |

TVDB is not a direct provider. Preserve a TVDB ID only as an imported/provider alias when one already exists.

## Environment

Relevant public Expo env values:

```text
EXPO_PUBLIC_TMDB_BASE_URL
EXPO_PUBLIC_TMDB_API_KEY
EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN
EXPO_PUBLIC_TVMAZE_BASE_URL
EXPO_PUBLIC_ANILIST_URL
EXPO_PUBLIC_CONVEX_SITE_URL
```

TMDB needs either an API key or read access token. TVMaze, AniList, and Jikan are currently used for read operations without project-specific secrets.

## Normalized Types

All provider responses should be normalized before UI use.

`NormalizedShow` includes:

- `id`, `mediaType`, `title`
- optional metadata such as `overview`, `posterUrl`, `backdropUrl`, `genres`, `status`, `rating`, `firstAired`
- count/runtime fields such as `totalEpisodes`, `releasedEpisodes`, `totalSeasons`, `episodeRuntime`
- provider IDs such as `tmdbId`, `tvdbId`, `anilistId`, `malId`, `tvmazeId`, `imdbId`
- anime relation fields such as `anilistFormat`, `animeSeason`, `animeSeasonYear`, `rootAnilistId`, `relatedAnilistIds`

`NormalizedEpisode` includes:

- `id`, `seasonNumber`, `episodeNumber`
- optional `name`, `overview`, `stillUrl`, `airDate`, `runtime`

`NormalizedScheduleEntry` includes:

- `showId`, `showTitle`, `mediaType`, `episode`, and optional `posterUrl`

## Provider ID Policy

Use provider-qualified IDs for joins and routes. Bare numbers are unsafe because providers reuse numeric IDs.

Normal route examples:

```text
tmdb:tv:1399
tmdb:movie:550
anilist:anime:1735
jikan:anime:20
tvmaze:tv:82
```

Trust direct provider IDs first, bridged IDs second, verified title fallback rarely, and broad title fallback never without explicit ADR coverage.

## Client Rules

- Screens/components must not call provider APIs directly when the data belongs in shared app behavior.
- API clients should handle failed and partial upstream responses without corrupting downstream state.
- 429/rate-limit responses should be retried or surfaced in typed failure paths appropriate to the provider.
- Raw provider responses should not leak into Convex user data or UI components.
- Images should remain external CDN URLs; never store image files in Convex.

## Release Facts

Release and schedule facts are not just display metadata. They affect Home, Watchlist, Schedule, completed-show reactivation, future-only filtering, and duplicate collapse.

When provider facts disagree, follow the ADRs instead of inventing a new fallback in the API client. Start with `docs/DECISIONS.md`.
