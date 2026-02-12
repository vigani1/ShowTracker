# ShowTracker Progress

## Current Phase

Phase 8: Polish and validation (in progress)

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
  - [x] Configure theme foundation (NativeWind; later migrated to dark-only)
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
  - [x] Stack gesture navigation for non-tab screens (edge swipe on iOS + default Android back)
  - [x] Detail routes (`/show/*`, `/list/*`) run as full-page stack screens on mobile
  - [x] Desktop sidebar visibility scoped to app-shell routes (hidden on auth/landing)
  - [x] Responsive TV frame layout tuning for desktop and mobile
- [x] Theme system hardening
  - [x] Simplified to dark-only (Midnight Pulse); removed light mode toggle, localStorage persistence, and all light-\* color tokens
  - [x] Theme-consistent background/shell rendering across routes
- [x] Home feed density + scroll behavior updates
  - [x] More efficient card density on desktop and mobile
  - [x] Incremental "load more while scrolling" behavior
- [x] "Midnight Pulse" UI Redesign (aggressive overhaul)
  - [x] New color system: warm charcoal blacks, red-orange primary, sky-blue accent (zinc scale)
  - [x] Removed entire skeuomorphic TV/remote theme (ScreenWrapper, TvSideRemotePanel, DesktopRemoteDock deleted)
  - [x] New desktop sidebar navigation (collapsible 240px/72px, frosted glass, active accent bars)
  - [x] Modernized mobile bottom tab bar (60px, no borders, shadow-based)
  - [x] Rebuilt all base components: Button (3 variants), Badge (5 color variants), Card, MediaPosterCard (gradient overlay, progress bar, glow), PageBackButton (clean circle)
  - [x] New shared components: SegmentedControl, SearchInput, ProgressBar, HeroSection
  - [x] Rebuilt Home screen: bold "My Shows" header, segmented control filter, poster grid with dark gradient overlays and inline progress
  - [x] Rebuilt Discover screen: hero banner with backdrop image, trending grid, section headers
  - [x] Rebuilt Search screen: frosted glass search input, segmented filter pills, result grid
  - [x] Rebuilt Show Detail screen: full-bleed backdrop hero, floating poster, modern action buttons, clean accordion seasons
  - [x] Rebuilt Profile screen: centered account state, card-based settings, and dedicated sign-out action
  - [x] Rebuilt Auth screens: centered card layout, clean inputs, modern typography
  - [x] Updated Watchlist/Schedule placeholder screens to match new design system
  - [x] Removed Extra/More tab (settings absorbed into Profile)
  - [x] Tailwind config fully replaced with Midnight Pulse tokens
  - [x] Global CSS updated with noise texture overlay, radial glow, frosted glass utilities
  - [x] Typography overhauled: no more serif, 12px minimum, extrabold display weights, tight tracking

- [x] Dark-only theme migration
  - [x] Removed all `light-*` Tailwind tokens and `html:not(.dark)` CSS block
  - [x] Simplified ThemeProvider to force dark mode on mount (no localStorage, no device scheme)
  - [x] Stripped redundant `dark:` class duplicates from all components and screens (~20 files)
  - [x] Removed Appearance card and theme toggle from Profile screen
  - [x] Hard-coded dark values in root and tab layouts (StatusBar, tab bar colors)
- [x] Convex Auth fix
  - [x] Fixed JWT_PRIVATE_KEY format (raw PEM via stdin, not base64-encoded)
  - [x] Regenerated JWKS and set both environment variables
- [x] Grid layout fix (Home, Discover, Search)
  - [x] Replaced calculated `getMainContentWidth()` with `onLayout` measurement on grid containers
  - [x] Fixes right-side gap caused by scrollbar width and sidebar not accounted for in calculation
  - [x] Search grid uses FlashList with `ItemSeparatorComponent` for proper spacing
- [x] Show detail — watched state reliability
  - [x] Replaced `useState + useEffect` sync pattern with `useMemo` derivation from Convex tracking query
  - [x] Separate `pendingOverrides` state for optimistic updates during mutations
  - [x] Checkboxes and progress bar now render correctly on first load (no extra render cycle delay)
- [x] Show detail — season accordion improvements
  - [x] Auto-expand earliest season with unwatched episodes; fully watched seasons stay collapsed
  - [x] Season "fully watched" radio button fills without needing to expand (falls back to episodeCount when episodes not loaded)
- [x] Show detail — progress bar fix
  - [x] Replaced Animated.View with plain View + CSS transition (RN Web Animated string interpolation broken)
  - [x] Progress bar now visually fills to match the percentage text
- [x] Component cleanup (EpisodeCard, SeasonAccordion)
  - [x] Removed broken Animated fills; replaced with conditional Views that render based on watched state
  - [x] Removed unused Animated content fade from SeasonAccordion
- [x] Home dashboard — "episodes left" badge visibility improvement (solid dark backdrop + bold text)
- [x] Tracking toggle expansion (season + full-show)
  - [x] Added Convex mutation `unmarkSeasonWatched` for reverse batch toggles
  - [x] Show detail now supports two-way toggles for season and full-show watched state
  - [x] Optimistic UI uses `pendingOverrides` merged with reactive tracking keys to avoid first-render desync
- [x] Auth UX hardening
  - [x] Login/Register now provide explicit success states and clearer validation/network/auth failure messaging
  - [x] Guest sign-in flow now reports deterministic success/failure feedback
- [x] Navigation shell finalization
  - [x] Desktop uses collapsible sidebar on app-shell routes (Home, Discover, Search, Library, Profile, Show, List)
  - [x] Mobile bottom bar uses five visible tabs (Home, Discover, Search, Library, Profile)
  - [x] List and Show detail routes are hidden from tabs and rendered as stack screens
  - [x] Removed in-screen back buttons in favor of native gesture/back navigation
- [x] Phase 4: Tracking Features
  - [x] Watchlist add/status flows for shows, anime, and movies
  - [x] Episode/season/full-show watched toggles with optimistic updates
  - [x] Rewatch support for episodes, seasons, full shows, and movies
  - [x] Batch rewatch and full-clear mutations for faster bulk actions
- [x] Phase 5: Schedule View
  - [x] Schedule data integration and grouped timeline rendering
  - [x] Infinite loading behavior for earlier/later windows
  - [x] Tracked-show filtering and media-type coverage (TV + anime)
- [x] Phase 6: Custom Lists
  - [x] Create/edit/delete list flows
  - [x] Add-to-list from show details and list page
  - [x] Reorder and remove list items in edit mode
- [x] Phase 7: Statistics
  - [x] Dashboard/profile rails for active/favorite shows and movies
  - [x] Watch-time and progress aggregation hooks in Convex queries
  - [x] Cross-media tracking visibility for watching/completed/plan states
- [x] Discover/List UX expansion
  - [x] Discover infinite scroll for TV/anime/movies
  - [x] Browser swipe-back restoration on web (`overscroll-behavior-y` fix)
  - [x] List-page card consistency and add-show watchlist picker

## PR Readiness Snapshot (current branch)

- [x] `npx expo lint` passes
- [x] `npx tsc --noEmit` passes

## Pending

- [ ] Phase 8: Polish and validation
  - [ ] API normalization parity check: ensure TV/anime/movie adapters return equivalent required fields where possible
  - [ ] Cross-source deduplication pass: resolve duplicates where TMDB TV/discovery already includes anime that also appears from AniList/Jikan
  - [ ] Anime season canonicalization: normalize franchises so season-based entries are grouped correctly (avoid split rows like "Title Season 1" + "Title Season 2" unless intended)
  - [ ] Anime season/episode completeness audit: patch cases where one source lacks seasons/episode structure but another source provides it
  - [ ] Missing metadata fallback pass: handle absent air dates, runtimes, season/episode totals, and status values safely
  - [ ] End-to-end QA on mobile image rendering, watch actions, and list edit flows
  - [ ] Final UX sweep for loading/error states and microcopy consistency

## Known Issues

- React Native Web emits `props.pointerEvents is deprecated. Use style.pointerEvents` warning from upstream internals.
- Some API records still arrive without complete metadata (air dates, runtimes, or totals), requiring additional fallback validation.
- Duplicate anime entries can appear when TMDB show feeds overlap with AniList/Jikan results.
- Anime source mismatch: TMDB can return anime without season structure while AniList can expose seasonized entries as separate shows, causing split titles.
- Continue UX QA pass for non-tab/detail screens on very small mobile heights.

## Future Phases (Post-Polish)

### Phase 9: Data Canonicalization & Source Harmonization

- [ ] Cross-source deduplication policy and implementation (TMDB vs AniList/Jikan overlap)
- [ ] Anime franchise season canonicalization (group seasonized entries into a single title flow where appropriate)
- [ ] Source merge strategy for incomplete records (prefer richer season/episode payloads)
- [ ] Backfill/reconciliation pass for previously cached inconsistent records

### Phase 10: Reliability & Quality Hardening

- [ ] Metadata completeness hardening (air dates/runtime/season totals/status fallbacks)
- [ ] Regression checklist for watch actions (mark watched/unwatched/rewatch across TV/anime/movies)
- [ ] End-to-end QA matrix (web/iOS/Android) for list editing, discovery pagination, and profile rails
- [ ] Performance tuning pass on long lists and high-volume watch histories

### Phase 11: Platform Upgrade & Expansion

- [ ] Notifications for new episodes (push notifications)
- [ ] Import from TVTime/Trakt
- [ ] Recommendations based on watch history
