# ADR-0028: Detail Rail Performance Windowing

## Context

On June 13, 2026, production detail routes for long-running shows exposed visible lag on web. `/show/tmdb:tv:30983` mounted roughly 1,200 quick-rail episode cards and images for Detective Conan, producing a very large horizontal scroll area before the user interacted with it. The route also kept status changes feeling slow because status selection waited for the Convex write while the oversized detail tree re-rendered.

The quick rail behavior itself is valued: it anchors near the next relevant episode, supports horizontal scrubbing, and loads adjacent seasons without jumping when older seasons are prepended.

## Current Behavior

Before this change, `ContinueTrackingRail` rendered every loaded rail item into one horizontal `ScrollView`. For shows with a single huge loaded season, that meant every episode card, overview, image, and press target mounted at once.

The rail already preserved scroll position when previous seasons were prepended by measuring the old first item and applying a fixed card-width offset. It also loaded adjacent TMDB seasons when the user scrolled near either edge.

Status changes updated only after `setWatchlistStatus` completed. The status menu remained visible while the mutation was in flight.

`getEpisodeWatchCounts` returned one row for every watched episode even though the UI displays a distinct rewatch label only when `watchCount > 1`.

## Decision

The detail quick rail now uses fixed-width windowing inside the existing horizontal `ScrollView`. It renders a small overscanned range around the current scroll offset and fills the non-rendered area with left and right spacers calculated from the same card widths. The total scroll width remains stable, so horizontal scrolling, edge-triggered season loading, and prepend anchor compensation keep the same behavior.

Rail images are only mounted for the rendered window. On web, rail images also request lazy/asynchronous image decoding.

Status selection now closes the menu and updates the top action label optimistically while the Convex mutation runs. The underlying progress, watched keys, Home/watchlist projections, and persisted status still come from Convex. If the mutation fails, the optimistic label rolls back and the existing error message path is used.

`getEpisodeWatchCounts` now returns only entries with `watchCount > 1`, because count `1` renders identically to an omitted count.

## Reasoning

The lag was dominated by client rendering and image mounting, not by a change in release eligibility. Preserving the `ScrollView` and existing prepend compensation avoids the previous class of rail jumps while reducing the mounted work for very large shows.

Optimistic status feedback improves perceived responsiveness without changing server-side write order or Home eligibility. Home and watchlist state still update through the same Convex mutation and projection paths.

Trimming one-time watch-count rows reduces payload and client state churn without removing any visible rewatch information.

## Provider/Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb IDs, canonical keys, anime relation rules, and title fallback behavior are unchanged.

Episode ordering remains the normalized season/episode order already used by the detail route. Fixed rail widths are part of the existing rail design and are used only for rendering spacers and scroll-offset math.

Released/watchable progress continues to follow ADR-0026. This decision does not change `remainingEpisodes`, `releasedEpisodes`, `newEpisodeSignalAt`, `homeSortAt`, schedule facts, provider totals, duplicate collapse, or projection repair.

## Edge Cases

Huge single-season shows render only the visible rail window while retaining the full scroll range.

When previous seasons are loaded and prepended, the existing first-item anchor is still used to keep the user at the same episode.

The caught-up card keeps its wider card width in spacer calculations. The loading card is also included in the virtual width when present.

If a status mutation fails, the optimistic action label returns to the latest subscribed tracking state.

Episodes watched exactly once still display as `Watched`; rewatched episodes still display their count.

## Verification

Required local checks:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `git diff --check`

Manual web checks:

- Open `/show/tmdb:tv:30983` and confirm the quick rail mounts a small rendered window rather than every episode card.
- Confirm the rail initially anchors near the next relevant episode.
- Drag/scroll left and right, including near rail edges, and confirm adjacent loads do not jump the current position.
- Change a status from the top action menu and confirm the menu closes immediately, the label updates optimistically, and the persisted Convex state catches up.
- Open `/show/tmdb:tv:37854` and confirm ordinary long-running shows still render and scroll correctly.

## Rollback Notes

Rollback by reverting the rail windowing in `components/ContinueTrackingRail.tsx`, the optimistic action-label state in `app/show/[id].tsx`, and the `getEpisodeWatchCounts` payload trim in `convex/shows.ts`.

If rollback is needed because of rail positioning, verify the original all-items rail does not reintroduce large-show lag before deploying. Do not change Home, Schedule, provider matching, release availability, projection repair, or status mutation semantics as part of this rollback.
