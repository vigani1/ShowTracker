# API Reference

External API documentation for ShowTracker.

## TMDB (The Movie Database)

**Base URL**: `https://api.themoviedb.org/3`
**Auth**: API key via query param `?api_key=KEY` or header `Authorization: Bearer TOKEN`
**Rate Limit**: ~40 requests/second (very generous)
**Docs**: [developer.themoviedb.org](https://developer.themoviedb.org/docs)

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/trending/{media_type}/{time_window}` | GET | Trending items (media_type: tv, movie, all; time_window: day, week) |
| `/search/multi` | GET | Search across movies, TV, people |
| `/search/tv` | GET | Search TV shows only |
| `/search/movie` | GET | Search movies only |
| `/tv/{series_id}` | GET | TV show details |
| `/tv/{series_id}/season/{season_number}` | GET | Season details with episodes |
| `/tv/{series_id}/season/{season_number}/episode/{episode_number}` | GET | Single episode details |
| `/movie/{movie_id}` | GET | Movie details |
| `/tv/{series_id}/external_ids` | GET | External IDs (IMDB, TVDB, etc.) |

### Image URL Construction

```
https://image.tmdb.org/t/p/{size}{path}
```

**Poster sizes**: `w92`, `w154`, `w185`, `w342`, `w500`, `w780`, `original`
**Backdrop sizes**: `w300`, `w780`, `w1280`, `original`
**Still sizes** (episodes): `w92`, `w185`, `w300`, `original`

Example: `https://image.tmdb.org/t/p/w500/path-from-api.jpg`

---

## TVMaze

**Base URL**: `https://api.tvmaze.com`
**Auth**: None required
**Rate Limit**: 20 requests per 10 seconds
**CORS**: Enabled (can call from browser)
**Docs**: [tvmaze.com/api](https://www.tvmaze.com/api)

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/schedule?country=US&date=2026-02-08` | GET | Daily schedule by country |
| `/schedule/web?date=2026-02-08` | GET | Web/streaming schedule |
| `/search/shows?q=query` | GET | Search shows |
| `/shows/{id}` | GET | Show details |
| `/shows/{id}/episodes` | GET | All episodes for a show |
| `/shows/{id}?embed=episodes` | GET | Show details with embedded episodes |

### Embed Parameters

```
/shows/1?embed=episodes         # Show + all episodes
/shows/1?embed[]=episodes&embed[]=seasons  # Show + episodes + seasons
```

---

## AniList (GraphQL)

**Endpoint**: `https://graphql.anilist.co`
**Method**: POST (GraphQL)
**Auth**: None required for read operations
**Rate Limit**: 30 requests/minute
**Docs**: [docs.anilist.co](https://docs.anilist.co)

### Key Queries

```graphql
# Search Anime
query SearchAnime($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      title { romaji english native }
      coverImage { large medium }
      bannerImage
      description
      episodes
      status
      genres
      averageScore
      seasonYear
      season
      nextAiringEpisode { airingAt episode }
    }
  }
}

# Trending Anime
query TrendingAnime($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: TRENDING_DESC) {
      id
      title { romaji english }
      coverImage { large }
      bannerImage
      episodes
      status
      averageScore
      nextAiringEpisode { airingAt episode }
    }
  }
}
```

### Rate Limit Headers

- `X-RateLimit-Limit`: Max requests per minute
- `X-RateLimit-Remaining`: Remaining requests
- `Retry-After`: Seconds to wait (on 429)

---

## Jikan v4

**Base URL**: `https://api.jikan.moe/v4`
**Auth**: None required
**Rate Limit**: 60 requests/minute, 3 requests/second
**Use Case**: Fallback when AniList rate limits are hit

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `/anime?q=query&page=1` | Search anime |
| `/anime/{id}` | Anime details |
| `/anime/{id}/episodes` | Episode list |
| `/top/anime` | Top anime |
| `/seasons/now` | Currently airing anime |
| `/schedules?filter=monday` | Airing schedule by day |

---

## Simkl Calendar CDN

**Base URL**: `https://data.simkl.in`
**Auth**: None
**Rate Limit**: None (CDN-hosted)
**Update Frequency**: Every 6 hours

```text
https://data.simkl.in/calendar/tv.json       # TV show schedule
https://data.simkl.in/calendar/anime.json     # Anime schedule
https://data.simkl.in/calendar/movies.json    # Movie releases
```

---

## Normalized Type Mappings

All API responses are normalized to shared types in `lib/api/types.ts`.

### NormalizedShow

| Field | TMDB | AniList | TVMaze | Jikan |
|-------|------|---------|--------|-------|
| `id` | `id` | `id` | `id` | `mal_id` |
| `title` | `name` or `title` | `title.english` or `title.romaji` | `name` | `title` |
| `overview` | `overview` | `description` (strip HTML) | `summary` (strip HTML) | `synopsis` |
| `posterUrl` | `image.tmdb.org/t/p/w500{poster_path}` | `coverImage.large` | `image.medium` | `images.jpg.large_image_url` |
| `backdropUrl` | `image.tmdb.org/t/p/w1280{backdrop_path}` | `bannerImage` | — | — |
| `mediaType` | `media_type` field | Always `"anime"` | Always `"tv"` | Always `"anime"` |
| `status` | `status` | `status` | `status` | `status` |
| `rating` | `vote_average` (0-10) | `averageScore` (0-100, divide by 10) | `rating.average` | `score` (0-10) |
| `totalEpisodes` | `number_of_episodes` | `episodes` | — | `episodes` |

### NormalizedEpisode

| Field | TMDB | AniList | TVMaze |
|-------|------|---------|--------|
| `season` | `season_number` | 1 (anime usually single season) | `season` |
| `episode` | `episode_number` | `episode` (from airing schedule) | `number` |
| `title` | `name` | — | `name` |
| `overview` | `overview` | — | `summary` (strip HTML) |
| `airDate` | `air_date` | Unix timestamp → ISO string | `airdate` |
| `stillUrl` | `image.tmdb.org/t/p/w300{still_path}` | — | `image.medium` |
| `runtime` | `runtime` | — | `runtime` |

---

## Status Normalization

All API statuses normalized to consistent format:

```typescript
// Input → Output
"Returning Series" → "returning"
"Ended" → "ended"
"RELEASING" → "airing"
"FINISHED" → "finished"
"Currently Airing" → "airing"
```

---

## Fallback Strategy

### Missing Air Dates
- Default: Episode treated as "released" (optimistic)
- UI shows: "Air date TBA"

### Missing Runtime
- TV/Anime: 24 minutes (default episode length)
- Movie: 110 minutes (average movie)

### Missing Episode Count
- TV: Calculated from seasons array
- Anime: Default 12 episodes (standard season)

### Missing Images
1. Episode stillUrl
2. Show backdropUrl
3. Show posterUrl
4. Generic placeholder with episode number

---

## API-Specific Behaviors

- **TMDB (TV)**: Best episode images (stills), complete season/episode data
- **TMDB (Movies)**: Full runtime always available, no episode structure
- **AniList**: No episode-level data in basic queries, relations graph for franchise continuity
- **Jikan**: Episode list with titles and air dates, no episode images
- **TVMaze**: Episode images via TV recordings, accurate air dates

---

## Validation

```typescript
function validateNormalizedShow(show: NormalizedShow): string[] {
  const errors: string[] = [];
  if (!show.id) errors.push("Missing id");
  if (!show.mediaType) errors.push("Missing mediaType");
  if (!show.title) errors.push("Missing title");
  if (!show.episodeRuntime || show.episodeRuntime <= 0) {
    errors.push("Missing or invalid episodeRuntime");
  }
  return errors;
}
```
