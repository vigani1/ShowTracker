# Continue Tracking Rail Plan

## Summary

Add a horizontal "Continue tracking" rail to TV/anime show detail pages. It gives users quick access to their current spot without scrolling through long season lists: previous watched episode first, then the next episode to watch, then a few following episodes across season boundaries.

For shows with no progress, the rail starts at the first released episode. The rail must not load every episode up front; it should hydrate only the small window it needs and extend sideways as the user scrolls.

## Product Behavior

- Show the rail on TV/anime show detail pages; hide it for movies.
- Show it when the title can be tracked.
- For untracked authenticated users, tapping a start episode should create/add tracking through the existing episode mutation path.
- Initial rail size:
  - 3 cards on narrow mobile.
  - 5 cards on wider layouts.
- Extend the rail in small batches when the user scrolls near the horizontal end.
- Include the previous watched episode first when it exists.
- Then show the next unwatched episode and a few following episodes.
- Cross season boundaries automatically when enough adjacent metadata is available.
- Include at most one future unaired episode when it is the next known episode; render it disabled with its air date.
- Keep existing behavior for tapping episodes:
  - Watched episodes open the existing watched action menu.
  - Unwatched released episodes use the existing mark-watched flow.
  - Later episodes still trigger the existing missing-previous-episodes prompt.
  - Future unaired episodes are disabled unless already watched.

## Loading And Data Flow

- Build a small sorted episode window around progress, not a full flattened episode list.
- Reuse existing watched/progress state already used by the show detail page.
- Reuse existing episode toggle, watched action menu, pending state, watch counts, and release-date availability logic.
- For TMDB TV:
  - Use the existing `resolveSeasonEpisodes` flow.
  - Auto-load only the immediate season needed for the rail.
  - Load further adjacent seasons only when horizontal scrolling reaches them.
- For anime/Jikan:
  - Use already loaded page data first.
  - Fetch the next Jikan episode page only when the rail needs more.
  - Preserve the existing background full-episode refresh behavior.
- Keep Convex schema unchanged.

## Implementation Notes

Create a dedicated `components/ContinueTrackingRail.tsx` component and wire it from `app/show/[id].tsx` above the existing `Seasons & Episodes` section. Keep the component presentational where possible; the show detail screen should own episode loading and mutation handlers because it already owns the tracking state.

Recommended component props:

```ts
type ContinueTrackingRailItem =
  | {
      kind: "episode";
      episode: NormalizedEpisode;
      watched: boolean;
      isUpdating: boolean;
      watchCount?: number;
      availability: EpisodeAvailability;
    }
  | {
      kind: "caught-up";
      text: string;
      credit: string;
      progressLabel: string;
    };

type ContinueTrackingRailProps = {
  items: ContinueTrackingRailItem[];
  isLoadingMore: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onToggleEpisode: (episode: NormalizedEpisode) => void;
};
```

The rail should use a horizontal `ScrollView`. Trigger `onLoadMore` when the user scrolls within roughly 240px of the right edge. Use `scrollEventThrottle={16}` and guard with `isLoadingMore` so the same batch is not requested repeatedly.

### Progress Window Algorithm

In `app/show/[id].tsx`, derive rail content from the current `seasons`, `watchedEpisodeKeys`, `episodeWatchCounts`, and existing availability helpers.

Use these rules:

1. Sort loaded/known episodes by `seasonNumber`, then `episodeNumber`.
2. Find the latest watched episode among known episodes.
3. Find the first released unwatched episode after the latest watched episode.
4. If there is no latest watched episode, use the first released known episode as the next episode.
5. Initial rail content is:
   - latest watched episode, if it exists;
   - next episode to watch, if it exists;
   - following released episodes up to the responsive card target;
   - at most one future episode if it is the next known episode after all released/watchable episodes.
6. If all known released episodes are watched and there is no known future episode, show the latest watched episode plus the caught-up block.
7. Do not include specials unless they are part of the current normalized season list and naturally fall in sorted order.

If the algorithm cannot find enough known episodes, load only the immediate next required source:

- For TMDB TV, call existing `resolveSeasonEpisodes` for the next season number that could contain the next rail item.
- For anime/Jikan, fetch the next Jikan episode page only when the rail needs more anime episodes than are currently loaded.

### Show Detail State

Add minimal rail-specific state in `app/show/[id].tsx`:

```ts
const [railTargetCount, setRailTargetCount] = useState(width < 640 ? 3 : 5);
const [isRailLoadingMore, setIsRailLoadingMore] = useState(false);
const [nextAnimeRailPage, setNextAnimeRailPage] = useState(2);
const [animeRailHasMorePages, setAnimeRailHasMorePages] = useState(false);
```

The exact state names can vary, but the implementation must distinguish:

- how many cards the rail is trying to display;
- whether a rail load-more operation is running;
- the next Jikan page to request for anime;
- whether anime has more pages available.

When the user scrolls near the end, increase the target by 4 and hydrate the next needed season/page if the current known episodes are insufficient.

### TMDB TV Loading

Use existing season placeholders and `resolveSeasonEpisodes`. Do not introduce direct TMDB calls inside the rail component.

When the rail needs more episodes:

1. Inspect sorted seasons.
2. Find the earliest season at or after the current rail boundary whose `episodes` are missing.
3. Call `resolveSeasonEpisodes(season)` for one season only.
4. Recompute rail items from updated `seasons`.

### Anime/Jikan Loading

The current show detail flow loads page 1, then may background-refresh more pages. The rail should not force a full crawl.

When the rail needs more anime episodes and the current show has a `malId`:

1. Call `getJikanAnimeEpisodesPage(show.malId, nextAnimeRailPage)`.
2. Merge returned episodes into the single anime season, deduping by `seasonNumber:episodeNumber`.
3. Increment `nextAnimeRailPage`.
4. Set `animeRailHasMorePages` from the page response.

Initialize `animeRailHasMorePages` from the existing page-1 response where available. If that is not currently stored, add state during the existing anime load path rather than refetching page 1.

### Untracked Show Behavior

Rely on the existing `toggleEpisodeWatched` mutation path to create the show/user tracking record when needed. Before implementation, verify that `convex/shows.ts` `toggleEpisodeWatched` calls `ensureShowRecordId` and creates a `userShows` row when missing. If that is not true, fix the existing mutation path instead of adding special rail-only tracking logic.

### Caught-Up Quote Selection

Use a deterministic helper, not render-time randomness:

```ts
function getCaughtUpLine(showId: string, date = new Date()) {
  const dayKey = date.toISOString().slice(0, 10);
  const seed = `${showId}:${dayKey}`;
  const index = hashString(seed) % CAUGHT_UP_LINES.length;
  return CAUGHT_UP_LINES[index];
}
```

Any simple stable string hash is fine. The selected line should not change during ordinary React re-renders.

## Caught-Up State

If the user is fully caught up and there is no known next episode, keep the rail visible with:

- The latest watched episode card.
- A compact celebratory "caught up" block.
- A small sparkle/check motif.
- A warm accent, soft glow, or progress-line treatment.
- No confetti animation.

Caught-up copy should use a stable per-show-per-day selection from this candidate list. Attribution should stay short: character name or show name only.

1. "And now my watch is ended." - Game of Thrones
2. "That's all. The rest is confetti." - Nell Crain
3. "Then our business here is finished." - Gus Fring
4. "That's it." - Gus Fring
5. "Just like that." - Gus Fring
6. "It's finished, okay?" - Emmit Stussy
7. "I'm done." - Walter White
8. "Because of you, there will be a tomorrow." - Wu
9. "And if we did it once, we can do it again!" - Goliath
10. "They're final, yet festival." - Lexi Carter
11. "All's well that ends well." - Star Trek
12. "The work is done." - The Lord of the Rings
13. "There and back again." - Bilbo Baggins
14. "We're all stories in the end." - The Doctor
15. "Everybody lives!" - The Doctor
16. "It is over." - Obi-Wan Kenobi
17. "We did it." - Dora
18. "Mission accomplished." - Kim Possible
19. "The deed is done." - Macbeth
20. "All good things..." - Star Trek

This quote/reference list is candidate copy for development and needs a final wording/source audit before release.

## Test Plan

- Run `npx expo lint`.
- Run a TypeScript check if available through the local Expo/TypeScript setup.
- Manually verify show detail cases:
  - No progress.
  - Partial progress.
  - Crossing a season boundary.
  - Fully caught up.
  - Long multi-season show.
  - Untracked show start.
  - Future next episode.
  - Anime with paged Jikan episodes.
- Verify tapping next episodes updates the rail optimistically.
- Verify tapping later episodes still triggers the existing missing-earlier-episodes prompt where appropriate.
- Verify horizontal scrolling loads only one additional season/page at a time.
- Verify the caught-up quote is stable across re-renders and changes across day/show seed.
- If frontend/backend servers are already running, inspect the web UI with Chrome DevTools MCP and run `npm run ui:inspect:quick` after implementation.

## Acceptance Criteria

- A user can open a long-running show and mark the next episode watched from the rail without scrolling to the season accordion.
- The rail starts at the first released episode for a trackable show with no progress.
- The rail crosses from one season to the next without loading every season up front.
- Already watched rail cards use the same watched action behavior as existing episode cards.
- Later-episode taps still respect the existing missing-previous-episodes prompt.
- Future episodes are visible only as the next known episode and cannot be marked watched before release.
- Fully caught-up shows show the latest watched episode and a compact celebratory caught-up block.
- No Convex schema changes are introduced.

## Assumptions

- The rail should not load every episode up front.
- Existing watch/unwatch/rewatch behavior remains the source of truth.
- Real quote/reference copy is acceptable during development, with final audit before release.
