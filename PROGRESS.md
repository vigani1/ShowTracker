# ShowTracker Progress

## Current Phase
Phase 3: Core Screens (Discovery, Search, Show Detail) (in progress)

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

## Pending
- [ ] Phase 3: Core Screens (Discovery, Search, Show Detail)
- [ ] Phase 4: Tracking Features (Watchlist, Episode marking)
- [ ] Phase 5: Schedule View
- [ ] Phase 6: Custom Lists
- [ ] Phase 7: Statistics
- [ ] Phase 8: Polish

## Known Issues
(none yet)

## Future Ideas / Backlog
- Notifications for new episodes (push notifications)
- Social features (share lists with friends)
- Import from TVTime/Trakt
- Recommendations based on watch history
- Multi-language support
- Widget for mobile home screen showing next episodes
