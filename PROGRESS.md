# ShowTracker Progress

## Current Phase
Phase 4: Tracking Features (in progress)

## Completed
- [x] Project planning and research (docs/PLAN.md)
- [x] Tech stack selection
- [x] API selection and evaluation
- [x] Repo organization for AI agents
- [x] Phase 1: Project setup (Expo init, NativeWind, Convex, Expo Router)
  - [x] Scaffold Expo Router layouts and placeholder screens
  - [x] Configure NativeWind + Tailwind presets
  - [x] Add initial Convex schema and environment template
  - [x] Create base UI components (Card, Button, Badge, ScreenWrapper)
  - [x] Configure dark mode support (NativeWind + system preference)
- [x] Phase 2: API Layer + Data Infrastructure
  - [x] Build TMDB client (lib/api/tmdb.ts)
  - [x] Build AniList GraphQL client (lib/api/anilist.ts)
  - [x] Build TVMaze client (lib/api/tvmaze.ts)
  - [x] Build Jikan client (lib/api/jikan.ts)
  - [x] Create unified types (NormalizedShow, NormalizedEpisode, NormalizedSeason)
  - [x] Build normalizer functions for each API → unified types
  - [x] Implement Convex show caching mutation (upsert show)
- [x] Phase 3: Core Screens
  - [x] Discovery screen with TV/Anime/Movie tabs and responsive desktop/mobile grids
  - [x] Search screen with debounced cross-source search + filter chips
  - [x] Show detail screen with hero, season/episode actions, and tracking entry points
  - [x] Episode state UX improvements (release-aware behavior and clearer watch actions)
- [x] Navigation + UI shell redesign (TV-inspired)
  - [x] Persistent desktop remote navigation across app screens
  - [x] Mobile bottom navigation preserved for tab screens
  - [x] Floating back button pattern for non-tab screens
  - [x] Responsive TV frame layout tuning for desktop and mobile
- [x] Theme system hardening
  - [x] Light/Dark mode toggle on profile
  - [x] Theme persistence across reloads (web local storage)
  - [x] Theme-consistent background/shell rendering across routes
- [x] Home feed density + scroll behavior updates
  - [x] More efficient card density on desktop and mobile
  - [x] Incremental "load more while scrolling" behavior

## Pending
- [ ] Phase 4: Tracking Features (Watchlist, Episode marking) - remaining polish and edge cases
- [ ] Phase 5: Schedule View
- [ ] Phase 6: Custom Lists
- [ ] Phase 7: Statistics
- [ ] Phase 8: Polish

## Known Issues
- React Native Web emits `props.pointerEvents is deprecated. Use style.pointerEvents` warning from upstream internals.
- Continue UX QA pass for non-tab/detail screens on very small mobile heights.

## Future Ideas / Backlog
- Notifications for new episodes (push notifications)
- Import from TVTime/Trakt
- Recommendations based on watch history
