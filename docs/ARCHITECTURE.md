# ShowTracker Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Expo App (RN + Web)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Discovery │  │  Search  │  │ Watchlist │  │Schedule│  │
│  │  Screen   │  │  Screen  │  │  Screen  │  │ Screen │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │             │             │       │
│  ┌────▼──────────────▼─────────────▼─────────────▼────┐  │
│  │              lib/api/ (API Layer)                   │  │
│  │  tmdb.ts  anilist.ts  tvmaze.ts  jikan.ts         │  │
│  │  normalize.ts  types.ts  cache.ts                  │  │
│  └────┬──────────────┬─────────────┬─────────────┬────┘  │
│       │              │             │             │       │
│  ┌────▼──────────────▼─────────────▼─────────────▼────┐  │
│  │              Convex Client (useQuery/useMutation)   │  │
│  └────────────────────────┬───────────────────────────┘  │
└───────────────────────────┼──────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Convex Cloud  │
                    │  ┌───────────┐ │
                    │  │  queries  │ │
                    │  │ mutations │ │
                    │  │  actions  │ │
                    │  └─────┬─────┘ │
                    │  ┌─────▼─────┐ │
                    │  │   Tables  │ │
                    │  │  shows    │ │
                    │  │ userShows │ │
                    │  │ watched   │ │
                    │  │  Episodes │ │
                    │  │ custom    │ │
                    │  │  Lists    │ │
                    │  │ schedule  │ │
                    │  │  Cache    │ │
                    │  └───────────┘ │
                    └────────────────┘
```

## Data Flow Patterns

### Search / Discovery (Read-Only, No Auth Required for API)
```
User types query
  → Debounce (300ms)
  → lib/api/tmdb.search() + lib/api/anilist.search() (parallel)
  → normalize.ts transforms to NormalizedShow[]
  → In-memory cache stores result (15min TTL)
  → Component renders results
```

### Add Show to Watchlist
```
User taps "Add to Watchlist"
  → Convex mutation: upsertShow (cache show metadata in shows table)
  → Convex mutation: addUserShow (create userShows entry, status="watching")
  → Convex reactive query updates UI instantly
```

### Mark Episode Watched
```
User taps episode checkbox
  → Convex mutation: markEpisodeWatched
  → Inserts into watchedEpisodes table
  → Updates userShows.lastWatchedAt
  → Reactive queries update: watchlist badge count, stats, schedule highlighting
```

### Schedule Sync
```
Convex scheduled action (runs every 6 hours):
  → Fetch TVMaze schedule for today ± 7 days
  → Fetch AniList airing schedule for same range
  → Normalize and store in scheduleCache table

User opens Schedule screen:
  → Convex query: getSchedule(userId, dateRange)
  → Cross-reference scheduleCache with user's tracked shows (userShows)
  → Return only episodes for shows user is tracking
  → Client renders grouped by date
```

### Show Detail (Cache-First)
```
User opens show detail:
  → Convex query: getShow(showId)
  → If show.lastUpdated > 24h ago:
    → Convex action: fetchAndUpdateShow
    → Calls TMDB/AniList API for fresh data
    → Updates shows table
    → Reactive query returns updated data
  → Else: return cached data immediately
```

## Auth Flow

```
App Launch
  → Root _layout.tsx checks Convex auth state
  → If not authenticated → redirect to (auth)/login
  → If authenticated → render (tabs) layout

Login/Register
  → Convex Auth handles OAuth / email+password
  → On success: auth token stored, user redirected to (tabs)
  → All Convex queries/mutations validate auth via ctx.auth.getUserIdentity()
```

## Caching Strategy (3 Layers)

| Layer | Storage | TTL | What's Cached |
|-------|---------|-----|---------------|
| **Convex DB** | Cloud database | 24 hours | Show metadata, schedule data |
| **In-Memory** | JavaScript Map | 15 minutes | API search results, trending lists |
| **MMKV** | Device storage | Until refresh | Watchlist, recently viewed shows |

### Cache Invalidation
- Convex DB: `lastUpdated` timestamp checked on read, refresh if stale
- In-Memory: TTL-based expiry, cleared on app restart
- MMKV: Overwritten when fresh data arrives, serves as offline fallback

## Convex Schema Overview

### Table Relationships
```
users (managed by Convex Auth)
  │
  ├── userShows (userId → showId) — user's relationship to a show
  │     └── shows — cached show metadata from external APIs
  │
  ├── watchedEpisodes (userId → showId, season, episode) — individual episode tracking
  │
  └── customLists (userId, showIds[]) — user-created lists of shows

scheduleCache — cached schedule data by date, independent of users
```

### Key Indexes
- `userShows.by_user_status` — fast watchlist queries filtered by status
- `userShows.by_user_show` — check if user tracks a specific show
- `watchedEpisodes.by_user_show` — get watched episodes for a show
- `watchedEpisodes.by_watchedAt` — stats queries sorted by time
- `shows.by_tmdbId` / `by_anilistId` — deduplicate when caching API data
- `scheduleCache.by_date_type` — fetch schedule for a date+type combo

## Expo Router Layout Hierarchy

```
app/
  _layout.tsx              # Root: ConvexProvider + AuthProvider + ThemeProvider
  │
  ├── (auth)/
  │   _layout.tsx          # Auth layout (no tab bar)
  │   login.tsx
  │   register.tsx
  │
  ├── (tabs)/
  │   _layout.tsx          # Tab bar with 5 tabs
  │   index.tsx            # Discovery (Home)
  │   search.tsx           # Search
  │   watchlist.tsx        # Watchlist
  │   schedule.tsx         # Schedule
  │   profile.tsx          # Profile + Stats + Settings
  │
  ├── show/
  │   [id].tsx             # Show detail (dynamic route)
  │
  └── list/
      [id].tsx             # Custom list detail
      create.tsx           # Create new list
```

### Navigation Guards
- Root layout checks auth state
- Unauthenticated users see only (auth) screens
- All (tabs) and detail screens require authentication
- Deep links work via Expo Router's URL-based routing
