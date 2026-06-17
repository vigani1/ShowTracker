# ShowTracker Architecture

## System Shape

```text
Expo app (native + web)
  -> lib/api provider clients for TMDB, TVMaze, AniList, Jikan
  -> Convex client for auth, user state, projections, repairs
  -> Convex database and functions
  -> schedule-confidence SQLite reconciler for heavyweight release intelligence
  -> compact release/projection deltas back to Convex
```

Convex remains the source of truth for user-owned synced state. Provider APIs are sources of catalog, identity, schedule, and release facts. The schedule-confidence reconciler handles heavyweight provider/release reconciliation outside reactive app reads, then writes compact facts back to Convex.

## Production Runtime

```text
main branch
  -> Netlify auto-deploys the web app
  -> Convex production serves auth, user data, functions, projections, and crons
  -> private VPS at /opt/showtracker runs schedule-confidence from origin/main
  -> Browser verification checks the live Netlify app against production data
```

Agents should treat production bugs as cross-system until proven otherwise. A detail page can be correct because it reads provider/detail facts while Home or Schedule is wrong because projection, schedule cache, or VPS reconciliation state is stale.

## Frontend

The app uses Expo Router 6 with authenticated shell routes and direct-linkable detail/list routes.

Important routes:

- `app/(auth)/login.tsx` and `app/(auth)/register.tsx`.
- `app/(tabs)/home/index.tsx` for Home watchlist and upcoming/schedule surfaces.
- `app/(tabs)/discover/index.tsx`, `search.tsx`, `recommendations.tsx`, and `library/index.tsx`.
- `app/(tabs)/profile.tsx` and `app/profile/settings.tsx`.
- `app/show/[id].tsx` for direct and in-app show detail.
- `app/list/[id].tsx` and `app/list/create.tsx`.
- `app/import.tsx` for import flows.

Styling is NativeWind. App/component images should use React Native `Image`.

## Provider API Layer

Provider clients live in `lib/api/` and return normalized types from `lib/api/types.ts`.

- `tmdb.ts`: TV/movie discovery, detail, season/episode data, and external IDs.
- `tvmaze.ts`: TV search, detail, episode lists, country schedule, and web schedule.
- `anilist.ts`: anime search, trends, airing facts, and relation graph.
- `jikan.ts`: MAL/Jikan fallback and anime episode enrichment.
- `normalize.ts`: provider response normalization.
- `cache.ts`: in-memory API response TTL cache.

Screens should not consume raw provider responses. Normalize first, then persist through Convex where synced user state is involved.

## Convex Backend

Convex functions live in one file per domain:

- `convex/shows.ts`: show cache, tracking, Home feeds, Library, anime relations, import/reset, watch actions, repair/backfill tools.
- `convex/schedule.ts`: schedule cache, Home schedule signals, projected schedule reads, future count reads.
- `convex/scheduleConfidence.ts`: token-protected import/export/apply boundary for the SQLite reconciler.
- `convex/lists.ts`: custom lists.
- `convex/stats.ts`: profile, stats, favorites, and watch history.
- `convex/auth.ts`, `auth.config.ts`, `http.ts`, `crons.ts`: auth, HTTP routes, scheduled jobs.

Key tables:

- `shows`: cached normalized provider metadata and provider IDs.
- `userShows`: a user's relationship to a show/movie and status/progress state.
- `watchedEpisodes`: per-episode watch history.
- `customLists`, `userFavorites`, `userProfiles`, `userSocial`, `userStats`.
- `feedProjections`: compact per-user show rows used by Home, Discover tracked-state checks, Library, and repairs.
- `scheduleCache`: global date/media schedule buckets.
- `userScheduleEvents`, `watchlistFutureCountProjections`, `userScheduleProjectionWindows`: compact user-specific schedule projections.
- `rateLimits`, `maintenanceState`: operational state.

## Core Flows

### Discovery And Search

```text
User searches or opens a feed
  -> provider clients fetch TMDB/AniList/TVMaze/Jikan as needed
  -> normalize to shared types
  -> tracked-state badges read compact Convex projection state
  -> UI renders provider results without storing user data outside Convex
```

### Add Or Track A Title

```text
User tracks a title
  -> Convex upserts normalized show metadata
  -> Convex creates or updates userShows
  -> feedProjections refresh for cheap Home/Library reads
  -> reactive queries update the UI
```

### Watch Progress

```text
User marks episode/season/show/movie watched or unwatched
  -> Convex mutation updates watchedEpisodes and userShows
  -> stats/projection repair paths refresh focused derived state
  -> Home, Library, details, and Profile react to compact rows
```

### Home And Schedule

```text
Home/Schedule query
  -> reads feedProjections and userScheduleEvents/count projections when fresh
  -> falls back only through guarded legacy schedule-cache paths
  -> preserves provider-ID-first matching and conservative title fallback
```

### Release Reconciliation

```text
scripts/schedule-confidence.mjs
  -> imports tracked Convex library and schedule cache
  -> reconciles provider links and release facts in SQLite
  -> emits audit issues and compact deltas
  -> convex/scheduleConfidence.ts applies release and projection deltas
```

The reconciler should make missing provider links, title-only matches, conflicting provider IDs, and stale release facts inspectable instead of silently absent.

When diagnosing mismatches between detail, Home, Watchlist, and Schedule, identify which layer produced each fact before changing behavior:

- provider client/detail payload
- Convex cached show metadata
- `feedProjections`
- `scheduleCache`
- user schedule projections
- schedule-confidence SQLite/VPS output

## Routing And Identity

Route IDs are provider-qualified, for example `tmdb:tv:123`, `tmdb:movie:456`, `anilist:anime:789`, `jikan:anime:321`, or `tvmaze:tv:654`. Do not compare bare numeric IDs across providers.

Provider matching rules live in ADRs, especially ADR-0002 and ADR-0017 through ADR-0021. Title fallback must remain narrow and auditable.

## Architecture Guardrails

- User-owned synced data stays in Convex.
- Provider API calls stay in `lib/api/*` or Convex actions.
- Broad aggregate repair/backfill must not run from normal app navigation.
- Watchlist/schedule/release/provider/projection changes need ADR coverage.
- Optimize Convex I/O by materializing compact projections, not by hiding correct release facts.
