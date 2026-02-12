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
  - [x] Simplified to dark-only (Midnight Pulse); removed light mode toggle, localStorage persistence, and all light-* color tokens
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

## PR Readiness Snapshot (current branch)
- [x] `npx expo lint` passes
- [x] `npx tsc --noEmit` passes

## Pending
- [ ] Phase 4: Tracking Features (Watchlist, Episode marking) - remaining polish and edge cases
- [ ] Phase 5: Schedule View
- [ ] Phase 6: Custom Lists
- [ ] Phase 7: Statistics
- [ ] Phase 8: Polish

## Known Issues
- React Native Web emits `props.pointerEvents is deprecated. Use style.pointerEvents` warning from upstream internals.
- Continue UX QA pass for non-tab/detail screens on very small mobile heights.
- `app/show/[id].tsx` has an `exhaustive-deps` lint warning for the auto-expand season effect.

## Future Ideas / Backlog
- Notifications for new episodes (push notifications)
- Import from TVTime/Trakt
- Recommendations based on watch history

## Planned Later (Requested)
- [ ] Upgrade project from Expo SDK 54 to SDK 55
  - [x] Confirm version availability (as of 2026-02-12 only `55.0.0-preview.x` exists on npm; no stable `55.x`)
  - [x] Keep project on latest stable SDK 54 (`expo@54.0.33`) and run alignment/doctor checks
  - [ ] Upgrade to SDK 55 once stable is published
  - [ ] Resolve SDK 55 breaking changes (if any) and re-run lint/typecheck
  - [ ] Validate iOS, Android, and web smoke flows after upgrade
- [ ] Keep desktop sidebar persistent across authenticated app routes
  - [x] Move sidebar shell to a shared authenticated desktop layout (not tabs-only)
  - [x] Ensure detail routes (show/list/create) render inside same desktop shell
  - [x] Preserve current mobile tab navigation behavior
