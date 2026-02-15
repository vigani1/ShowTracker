# ShowTracker - Implementation Plan

## Context

Building a cross-platform show/anime/movie tracking app to replace TVTime, which suffers from slow performance, bad UX, and feature bloat. The goal is a fast, clean, open-source tracker that covers TV shows, anime, and movies with unified search, a schedule calendar, watchlist with unwatched episode tracking, custom lists, and watch statistics. It will run on web and mobile (iOS/Android) from a single codebase.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | Expo SDK 52+ (React Native) | Single codebase for web + iOS + Android |
| **Routing** | Expo Router v4 | File-based routing, unified URLs, deep links |
| **Web Support** | React Native Web (via Expo) | Production-ready, app-like web experience |
| **Styling** | NativeWind v4 (Tailwind CSS) | Fast development, excellent web parity |
| **Backend/DB** | Convex | Real-time sync, TypeScript-native, 0.5GB free |
| **Auth** | Convex Auth | Built-in, supports social + email/password |
| **Client State** | Zustand + MMKV | UI state + basic offline persistence |
| **Server State** | Convex reactive hooks | useQuery/useMutation, auto-updating UI |

## APIs

| Domain | API | Rate Limit | Auth |
|--------|-----|-----------|------|
| Movies + TV metadata/images | **TMDB** | ~40 req/sec | API key |
| TV schedule (airing dates) | **TVMaze** | 20 req/10sec | None |
| Anime metadata + airing | **AniList** (GraphQL) | 30 req/min | None |
| Anime fallback | **Jikan v4** | 60 req/min | None |
| Combined schedule CDN | **Simkl Calendar** | CDN (no limit) | None |

### Why These APIs?

**TMDB** — Most generous rate limits (~40 req/sec), best image quality (up to 3840x2160), largest movie/TV database, free for non-commercial use, stable for 10+ years.

**TVMaze** — Best-in-class schedule/airing data with dedicated endpoints by country and date, no API key needed, CORS enabled for direct browser use, actively maintained.

**AniList** — Best anime API for developers (GraphQL flexibility), airing schedule with countdown timestamps, 500K+ entries, no auth for reads. Currently degraded to 30 req/min (was 90) but still workable with caching.

**Jikan v4** — Anime fallback if AniList rate limits are too tight. No auth, 60 req/min, self-hostable, backed by MyAnimeList data.

**Simkl Calendar CDN** — Pre-generated JSON files covering TV + anime + movie schedules, updated every 6 hours. No rate limit concerns since it's CDN-hosted static files.

### APIs Evaluated and Rejected

| API | Why Not |
|-----|---------|
| TVDB | No longer free — requires subscription/licensing |
| OMDb | Only 1,000 req/day free; TMDB is better in every way |
| Trakt | Tightening rate limits; no images; anime support weak |
| Kitsu | Declining community; AniList and Jikan are stronger |
| Consumet | Public API shut down; focused on streaming links, not metadata |
| Notify.moe | Personal project, unstable API, archived GitHub |
| Bangumi | Chinese-language community focus |

---

## Feature List

### Core Features
1. **Discovery** - Trending/popular TV, anime, movies (tabs)
2. **Search** - Unified search across all media types with type filter
3. **Show Detail** - Show info + expandable seasons + episodes (name, thumbnail, description)
4. **Watchlist** - Shows with unwatched episodes, filtered by type
5. **Schedule** - Infinite scroll of **your tracked shows' episodes** grouped by date (past + future)
6. **Episode Tracking** - Mark episodes watched (tap, batch mark season)
7. **Show Status** - Watching, Paused, Dropped, Completed, Plan to Watch
8. **Movie Tracking** - Simple watched/unwatched toggle, can be added to custom lists + stats
9. **Custom Lists** - Create named lists, add/remove/reorder shows and movies
10. **Statistics** - Episodes watched, movies watched, total watch time (hours/days/months/years), by type
11. **Required Auth** - Users must log in to use the app, all data syncs across devices via Convex

### Recommended Additions
12. **Batch mark** - "Mark all up to here" for catching up on episodes
13. **Theme expansion (optional)** - Re-introduce Light mode later (current production shell is dark-only)
14. **Data export** - JSON export of all user data
15. **Pull-to-refresh** - Standard refresh pattern on all lists
16. **Offline caching** - Recently viewed shows/watchlist available offline via MMKV

---

## App Structure (Expo Router)

```
app/
  _layout.tsx              # Root layout (Convex + Auth providers)
  (auth)/
    login.tsx              # Login screen
    register.tsx           # Register screen
  (tabs)/
    _layout.tsx            # Desktop sidebar + mobile bottom tab layout
    index.tsx              # Home dashboard
    discover.tsx           # Discovery
    search.tsx             # Search
    watchlist.tsx          # Watchlist
    schedule.tsx           # Schedule calendar (hidden from mobile tab bar)
    profile.tsx            # Profile + account/settings
    Extra.tsx              # Hidden placeholder route
  show/
    [id].tsx               # Show detail (type+externalId in URL)
  list/
    [id].tsx               # Custom list detail
    create.tsx             # Create list
```

---

## Convex Schema

### `shows` (cached API metadata)
```ts
shows: defineTable({
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  imdbId: v.optional(v.string()),
  mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
  title: v.string(),
  overview: v.optional(v.string()),
  posterUrl: v.optional(v.string()),
  backdropUrl: v.optional(v.string()),
  genres: v.optional(v.array(v.string())),
  status: v.optional(v.string()),        // "Returning Series", "Ended", etc.
  totalEpisodes: v.optional(v.number()),
  totalSeasons: v.optional(v.number()),
  episodeRuntime: v.optional(v.number()), // minutes
  rating: v.optional(v.number()),
  firstAired: v.optional(v.string()),
  lastUpdated: v.number(),                // timestamp for cache invalidation
})
  .index("by_tmdbId", ["tmdbId"])
  .index("by_anilistId", ["anilistId"])
  .index("by_tvmazeId", ["tvmazeId"])
  .index("by_mediaType", ["mediaType"])
```

### `userShows` (user's relationship to a show or movie)
```ts
userShows: defineTable({
  userId: v.id("users"),
  showId: v.id("shows"),
  // For TV/anime: full status tracking. For movies: "completed" = watched, "plan_to_watch" = unwatched
  status: v.union(
    v.literal("watching"),
    v.literal("paused"),
    v.literal("dropped"),
    v.literal("completed"),
    v.literal("plan_to_watch")
  ),
  addedAt: v.number(),
  lastWatchedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_user_show", ["userId", "showId"])
```

### `watchedEpisodes` (individual episode tracking)
```ts
watchedEpisodes: defineTable({
  userId: v.id("users"),
  showId: v.id("shows"),
  season: v.number(),
  episode: v.number(),
  watchedAt: v.number(),
  runtime: v.optional(v.number()),  // minutes, for stats calculation
})
  .index("by_user_show", ["userId", "showId"])
  .index("by_user", ["userId"])
  .index("by_watchedAt", ["userId", "watchedAt"])
```

### `customLists`
```ts
customLists: defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  showIds: v.array(v.id("shows")),    // ordered array
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
```

### `scheduleCache` (cached schedule data)
```ts
scheduleCache: defineTable({
  date: v.string(),           // "2026-02-08"
  mediaType: v.string(),      // "tv" | "anime"
  episodes: v.string(),       // JSON string of episode data
  lastUpdated: v.number(),
})
  .index("by_date", ["date"])
  .index("by_date_type", ["date", "mediaType"])
```

---

## API Integration Architecture

### Unified API Service Layer (`lib/api/`)
```
lib/
  api/
    tmdb.ts         # TMDB client (movies + TV)
    tvmaze.ts       # TVMaze client (schedule)
    anilist.ts      # AniList GraphQL client (anime)
    jikan.ts        # Jikan client (anime fallback)
    types.ts        # Unified data types (NormalizedShow, NormalizedEpisode)
    normalize.ts    # Transform API responses → unified types
    cache.ts        # In-memory request cache with TTL
```

### Data Flow
1. **Search/Discovery**: Client calls API directly → normalize response → display
2. **Add to watchlist**: Client calls Convex mutation → upserts into `shows` + `userShows`
3. **Schedule**: Convex action fetches TVMaze/AniList schedule → stores in `scheduleCache` → client reads via query
4. **Show detail**: Check Convex cache first → if stale (>24h), fetch fresh from API → update cache

### Caching Strategy
- **Convex DB**: Show metadata cached with `lastUpdated` timestamp, refresh if >24 hours old
- **In-memory (client)**: API responses cached for 15 min (search, trending) using simple Map with TTL
- **MMKV (offline)**: Watchlist and recently viewed shows persisted locally

### Rate Limit Handling
- TMDB: Generous (40/sec) — no special handling needed
- TVMaze: Moderate (2/sec) — batch schedule fetches, cache aggressively in Convex
- AniList: Tight (30/min) — queue requests, use Convex-side caching, fallback to Jikan

---

## Implementation Phases

### Phase 1: Project Setup
1. Initialize Expo project with TypeScript template
2. Install and configure NativeWind v4
3. Set up Convex (npx convex init, schema, auth)
4. Configure Expo Router with tab navigation layout
5. Set up TMDB API key management (environment variables)
6. Create base UI components (Card, Button, Badge, ScreenWrapper)
7. Configure dark-mode-first theming (currently enforced dark-only)

### Phase 2: API Layer + Data Infrastructure
1. Build TMDB client (`lib/api/tmdb.ts`) — search, trending, show/season/episode details
2. Build AniList GraphQL client (`lib/api/anilist.ts`) — search, trending, airing schedule
3. Build TVMaze client (`lib/api/tvmaze.ts`) — schedule by date
4. Build Jikan client (`lib/api/jikan.ts`) — anime fallback
5. Create unified types (`NormalizedShow`, `NormalizedEpisode`, `NormalizedSeason`)
6. Build normalizer functions for each API → unified types
7. Implement Convex schema (all tables above)
8. Build Convex functions: show caching (upsert show from API data)

### Phase 3: Core Screens
1. **Discovery screen** — 3 horizontal scrollable rows (Trending TV, Trending Anime, Popular Movies), each showing poster cards. Tap opens show detail.
2. **Search screen** — Search bar + type filter chips (All/TV/Anime/Movies) + results grid. Debounced search hitting TMDB + AniList in parallel.
3. **Show Detail screen** — Hero backdrop + poster + info + collapsible season list. Each season expands to show episodes with thumbnail, name, description, watched toggle.

### Phase 4: Tracking Features
1. **Add to watchlist** — Button on show detail, picks default status "watching"
2. **Status management** — Status picker (watching/paused/dropped/completed/plan to watch)
3. **Episode marking** — Tap episode to toggle watched. "Mark all up to here" on long press.
4. **Watchlist screen** — Shows with status "watching" that have unwatched episodes. Show poster + title + "X new episodes" badge. Sorted by most recent new episode.
5. Convex queries: `getWatchlist`, `getUserShowStatus`, `getWatchedEpisodes`, `markEpisodeWatched`, `batchMarkWatched`

### Phase 5: Schedule View
1. **Schedule screen** — Infinite FlatList grouped by date headers (e.g., "Today - Feb 8", "Tomorrow - Feb 9", "Yesterday - Feb 7")
2. Each item: episode poster/thumbnail + show name + episode name + S01E05 label + air time
3. Scroll up for past, down for future
4. **Only shows episodes for shows the user is tracking** (status = watching or plan_to_watch)
5. Data source: TVMaze schedule (TV) + AniList airing schedule (anime), cross-referenced with user's tracked shows
6. Convex action to fetch and cache schedule data by date range
7. Filter chips: All / TV / Anime

### Phase 6: Custom Lists
1. Create list (name + optional description)
2. Add shows to list from show detail or from list edit screen
3. Reorder shows via drag handle
4. View list as poster grid or list view
5. Delete list (with confirmation)

### Phase 7: Statistics
1. **Stats calculations** (Convex query):
   - Total episodes watched (count of `watchedEpisodes`)
   - Total watch time = sum of `runtime` from `watchedEpisodes`
   - Display as: X hours / X days / X months / X years
   - Breakdown by media type (TV / Anime / Movies)
   - Shows completed count
   - Current streak (consecutive days with watched episodes)
2. **Profile screen** — Stats cards + settings (export data, logout, account controls)

### Phase 8: Polish
1. Skeleton loading states for all screens
2. Pull-to-refresh on lists
3. Empty states with illustrations
4. Error states with retry
5. Offline caching: persist watchlist + recent shows in MMKV via Zustand
6. Image caching (Expo Image component handles this)
7. Performance: virtualized lists (FlashList), memo expensive components
8. Haptic feedback on episode marking (mobile)
9. Responsive layout: 2-column grid on tablet/web, single column on phone

---

## Verification Plan

1. **Web**: Run `npx expo start --web`, verify all tabs navigate correctly, search works, show detail loads seasons/episodes
2. **Mobile**: Run on iOS/Android simulator, test tab navigation, episode marking, pull-to-refresh
3. **API integration**: Search for "Breaking Bad" (TMDB), "Attack on Titan" (AniList), verify images and metadata load
4. **Schedule**: Verify today's schedule loads from TVMaze, anime schedule from AniList
5. **Tracking**: Add show → mark episodes → verify watchlist updates → check statistics count
6. **Offline**: Enable airplane mode → verify cached watchlist still displays
7. **Cross-device sync**: Open on web + mobile simultaneously → mark episode on one → verify it appears on the other (Convex real-time)
