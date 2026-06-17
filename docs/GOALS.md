# ShowTracker Goals

## Product Goal

Build a fast, minimal tracker for shows, anime, and movies that is pleasant to use across web, iOS, and Android from one Expo codebase. ShowTracker should replace TVTime for personal tracking while staying open source and easier for agents to reason about.

The core user promise:

- Discover trending TV, anime, and movies.
- Search across media types.
- Track episode, season, show, and movie progress.
- Manage a Home watchlist focused on what needs attention.
- See upcoming and newly available episodes for tracked titles.
- Create custom lists.
- Inspect watch statistics.
- Import existing tracking data and repair stale tracking state without broad background backfills.

## UX Direction

The app should be quiet, quick, and utility-first. Prefer dense but readable screens over marketing-style pages. Home should surface what the user can act on now, while Library keeps the full saved/tracked collection.

Use the language in `CONTEXT.md` consistently. In particular, "Library" means the full saved/tracked collection, while "Watchlist" means the Home-focused continuation surface.

## Data Ownership

Convex owns user-synced state:

- Auth-linked users and profiles.
- Tracked shows and statuses.
- Watched episodes and watch history.
- Favorites and custom lists.
- Compact Home, Library, stats, schedule, and release projections.

External providers own catalog and release facts. Provider API calls go through `lib/api/*` or Convex actions, and provider responses must be normalized before UI use.

The schedule-confidence reconciler owns heavyweight release/provider intelligence work. It uses local/server-side SQLite as a working store, then writes compact changed facts and user-specific projections back to Convex.

## Provider Policy

Use provider-qualified IDs as the normal join surface. Bare numeric IDs must never be compared across providers.

- TMDB is the primary TV/movie catalog source.
- AniList is the preferred anime identity source.
- Jikan/MAL is anime fallback/enrichment.
- TVMaze is trusted for TV episode/schedule data where useful.
- IMDb is a bridge identifier.
- TVDB may be preserved as an imported/provider alias, but it is not a direct provider source.
- Title fallback is low-confidence and must stay narrow, auditable, and blocked where it can create TV/anime duplicate or wrong-row bugs.

## High-Risk Areas

Home watchlist, Schedule, release availability, provider matching, route IDs, duplicate collapse, and projection reads are regression-prone. Preserve correctness first, then optimize cost.

Do not solve Convex I/O by weakening release-state behavior. If a correct answer is too expensive in a reactive query, move the expensive work to reconciliation/projection jobs and keep app reads compact.

Do not re-enable broad tracking aggregate rebuilds from normal app navigation. Repair paths should be explicit, bounded, and scoped to one user/show or a paginated current-user repair.

## Non-Goals

- Do not migrate away from Convex for user-owned synced state.
- Do not add TheTVDB as a direct provider without a new decision.
- Do not make local-only persistence the source of truth for user data.
- Do not hide provider/release uncertainty silently; low-confidence or missing-provider cases should be auditable.
- Do not keep historical phase plans just because they once guided implementation. Preserve durable reasoning in ADRs.

## Working Rule

Use these docs to avoid reopening settled decisions. If behavior in code and docs disagree, treat the code as current behavior and fix the docs when the task calls for it.
