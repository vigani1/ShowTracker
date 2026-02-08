# ShowTracker API Reference

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

TMDB serves images via their CDN. Construct URLs as:

```
https://image.tmdb.org/t/p/{size}{path}
```

**Poster sizes**: `w92`, `w154`, `w185`, `w342`, `w500`, `w780`, `original`
**Backdrop sizes**: `w300`, `w780`, `w1280`, `original`
**Still sizes** (episodes): `w92`, `w185`, `w300`, `original`

Example:
```
https://image.tmdb.org/t/p/w500/path-from-api.jpg
```

### Common Query Parameters

| Param | Description |
|-------|-------------|
| `api_key` | Your TMDB API key |
| `language` | Response language (default: en-US) |
| `page` | Pagination (1-based, max 500) |
| `query` | Search query string |
| `include_adult` | Include adult content (default: false) |

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

TVMaze supports embedding related resources to reduce API calls:

```
/shows/1?embed=episodes         # Show + all episodes
/shows/1?embed[]=episodes&embed[]=seasons  # Show + episodes + seasons
```

### Schedule Response Shape

Each schedule entry includes:
- `id`: Episode ID
- `name`: Episode name
- `season`: Season number
- `number`: Episode number
- `airdate`: "2026-02-08"
- `airtime`: "20:00"
- `runtime`: Minutes
- `show`: Embedded show object with name, image, etc.

---

## AniList (GraphQL)

**Endpoint**: `https://graphql.anilist.co`
**Method**: POST (GraphQL)
**Auth**: None required for read operations
**Rate Limit**: 30 requests/minute (degraded from 90)
**Docs**: [docs.anilist.co](https://docs.anilist.co)

### Key Queries

#### Search Anime
```graphql
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
```

#### Trending Anime
```graphql
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

#### Airing Schedule
```graphql
query AiringSchedule($airingAtGreater: Int, $airingAtLesser: Int) {
  Page(page: 1, perPage: 50) {
    airingSchedules(
      airingAt_greater: $airingAtGreater
      airingAt_lesser: $airingAtLesser
      sort: TIME
    ) {
      airingAt
      episode
      media {
        id
        title { romaji english }
        coverImage { large }
      }
    }
  }
}
```

Note: `airingAt_greater` and `airingAt_lesser` use Unix timestamps.

### Rate Limit Headers

AniList returns rate limit info in response headers:
- `X-RateLimit-Limit`: Max requests per minute
- `X-RateLimit-Remaining`: Remaining requests
- `Retry-After`: Seconds to wait (on 429)

---

## Jikan v4 (MyAnimeList Unofficial)

**Base URL**: `https://api.jikan.moe/v4`
**Auth**: None required
**Rate Limit**: 60 requests/minute, 3 requests/second
**Use Case**: Fallback when AniList rate limits are hit
**Docs**: [docs.api.jikan.moe](https://docs.api.jikan.moe)

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/anime?q=query&page=1` | GET | Search anime |
| `/anime/{id}` | GET | Anime details |
| `/anime/{id}/episodes` | GET | Episode list |
| `/top/anime` | GET | Top anime |
| `/seasons/now` | GET | Currently airing anime |
| `/schedules?filter=monday` | GET | Airing schedule by day |

### When to Use Jikan vs AniList
- **Default**: Use AniList (better data structure, GraphQL flexibility)
- **Fallback**: Switch to Jikan when AniList returns 429 (rate limited)
- **Schedule by day**: Jikan's `/schedules` endpoint is simpler for day-based schedule views

---

## Simkl Calendar CDN

**Base URL**: `https://data.simkl.in`
**Auth**: None
**Rate Limit**: None (CDN-hosted static files)
**Update Frequency**: Every 6 hours
**Use Case**: Pre-built schedule data covering TV + anime + movies

### Calendar URLs

```
https://data.simkl.in/calendar/tv.json       # TV show schedule
https://data.simkl.in/calendar/anime.json     # Anime schedule
https://data.simkl.in/calendar/movies.json    # Movie releases
```

These are static JSON files updated periodically. Good for bulk schedule loading without hitting per-request rate limits.

---

## Unified Type Mappings

All API responses are normalized to shared types in `lib/api/types.ts`.

### NormalizedShow

| Field | TMDB | AniList | TVMaze | Jikan |
|-------|------|---------|--------|-------|
| `id` | `id` (number) | `id` (number) | `id` (number) | `mal_id` (number) |
| `title` | `name` or `title` | `title.english` or `title.romaji` | `name` | `title` |
| `overview` | `overview` | `description` (strip HTML) | `summary` (strip HTML) | `synopsis` |
| `posterUrl` | `image.tmdb.org/t/p/w500{poster_path}` | `coverImage.large` | `image.medium` | `images.jpg.large_image_url` |
| `backdropUrl` | `image.tmdb.org/t/p/w1280{backdrop_path}` | `bannerImage` | — | — |
| `mediaType` | `media_type` field | Always `"anime"` | Always `"tv"` | Always `"anime"` |
| `status` | `status` | `status` | `status` | `status` |
| `rating` | `vote_average` (0-10) | `averageScore` (0-100, divide by 10) | `rating.average` | `score` (0-10) |
| `totalEpisodes` | `number_of_episodes` | `episodes` | — (count from episodes list) | `episodes` |
| `genres` | `genre_ids` → lookup | `genres[]` | `genres[]` | `genres[].name` |
| `source` | `"tmdb"` | `"anilist"` | `"tvmaze"` | `"jikan"` |
| `externalId` | TMDB ID | AniList ID | TVMaze ID | MAL ID |

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
