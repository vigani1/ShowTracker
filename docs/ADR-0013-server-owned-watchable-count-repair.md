# ADR-0013: Server-Owned Watchable Count Repair

## Context

Several Home watchlist cards showed stale progress totals until each show detail route was opened manually. The detail route refreshes provider metadata for one tracked show, then rebuilds that show's feed projection. That made the counts correct, but it moved routine count repair into user navigation and Convex action work.

The motivating examples were current Home cards such as Euphoria, The Boys, The Beginning After the End, Dorohedoro, and Classroom of the Elite. Their next released or same-day episodes were known by provider data, but the cached `feedProjections` rows could still contain an older watchable denominator until detail-page refresh ran.

## Current Behavior

Before this change:

- The external schedule-confidence server imported tracked rows from `feedProjections`.
- The server fetched provider schedule facts and emitted compact release deltas.
- Convex applied those deltas to `shows`, `userShows`, `feedProjections`, and `scheduleCache`.
- `scheduleConfidence.applyReleaseDeltas` only visited user-specific projection rows when the show document changed, a stale Home signal needed clearing, or a released episode was clearly available now.
- For quiet stale-projection cases, the server could emit a provider-backed fact while Convex skipped projection repair because the stored show row was already unchanged.
- Multi-season provider rows could also expose only a season-local episode number. The server needed catalogue metadata, such as TMDB season totals plus `last_episode_to_air`, to translate "season 2 episode 8 aired" into the user's watchable episode count.

That meant opening a show detail page could still be the only path that refreshed the cached Home denominator for a specific tracked show.

## Decision

Keep provider metadata refresh owned by the external backend job.

The server reconciler now carries provider catalogue counts alongside provider schedule events when real provider fetching is enabled. TMDB and AniList metadata are used to compute provider-backed released and total episode counts; TVMaze full episode lists can contribute released counts. These catalogue counts do not replace the general release-fact calculation. They are only used as a bounded repair input when the imported user-specific watchable count from `watchedEpisodesCount + remainingEpisodes` is behind.

When the provider-backed released count is higher than the imported watchable count, the server emits a compact `projectionRepair` delta. Convex treats that as permission to visit the matched show's `userShows` rows and rebuild the affected `feedProjections`, even if the `shows` document itself does not need a patch.

Convex still does not fetch providers in this path. It only applies compact deltas and projection rebuilds for matched provider-ID rows.

## Reasoning

The Home card denominator should be repaired by the same controlled backend job that already owns provider reconciliation. This avoids reintroducing user-triggered Convex provider fetches or broad Convex scans.

Using `releasedEpisodes` as the repair gate is safer than blindly copying schedule totals. Schedule providers can list future episodes beyond the current watchable count, and some rows use season-local episode numbers. A future schedule total should not make Home display unreleased backlog. The repair signal only changes the delta payload for rows where provider metadata or the existing trusted fact says the released/watchable count is ahead of the imported projection.

The delta includes diagnostic details, including the imported watchable count and provider-backed released count. If the repair path fires unexpectedly, the next audit can explain why without guessing from function names.

## Provider/Data Assumptions

TMDB TV details are trusted for `number_of_episodes`, `last_episode_to_air`, and season episode counts when a TMDB ID is already attached to the tracked show. TMDB-derived released counts are computed as prior-season episode totals plus the latest aired episode number.

AniList is trusted for anime totals and next-airing episode numbers when an AniList ID is already attached. When AniList reports the next airing episode, released count is `nextAiringEpisode.episode - 1`. Finished AniList entries can use their total as released.

TVMaze episode lists can contribute released counts when reached through an existing TVMaze ID or a conservative TV lookup. TVMaze title search does not expand Convex apply permissions; title fallback deltas remain audited and skipped by Convex.

Title-only fallback remains blocked from Convex mutation. Missing-provider rows remain audit issues unless they are static fully released rows covered by prior rules.

## Edge Cases

Completed shows with new releases can still resume through the existing available-now path. The new repair signal only makes stale projections catch up to provider-backed released counts.

Paused shows can have their displayed progress repaired, but this does not promote them out of the paused section. Dropped rows are not treated as repair candidates for Home attention.

Planned/not-started shows can keep existing raw totals unless provider metadata creates a concrete released/watchable count. This avoids turning future-only schedules into released backlog.

Long-running shows and multi-season shows are repaired through catalogue released counts, not through season-local schedule episode numbers alone.

Anime season aliases keep the existing AniList/MAL identity rules. Same-day duplicate episodes and future weekly rows keep the existing schedule-cache dedupe behavior.

Stale provider totals are bounded by the watchable-count gate: future schedule totals do not become Home progress totals unless provider released counts also move forward.

## Verification

Planned verification:

- `npm run schedule-confidence:validate`
- `npx convex codegen`
- `npx tsc --noEmit --pretty false`
- `npx expo lint`
- `git diff --check`

Synthetic coverage should include the stale projection case where the show row already has the correct released count but the imported feed projection is behind. The expected result is a `projectionRepair` delta and a repaired `feedProjections.remainingEpisodes` after apply.

Known-show checks after deployment should include the Home cards that originally changed only after opening detail pages: Euphoria, The Boys, The Beginning After the End, Dorohedoro, and Classroom of the Elite.

## Rollback Notes

If Home starts showing unreleased future episodes as watchable, revert the `projectionRepair` delta generation in `scripts/schedule-confidence.mjs` and the `projectionRepair` visitor path in `convex/scheduleConfidence.ts`.

If schedule rows regress while Home counts remain correct, inspect schedule-cache maintenance separately before reverting this ADR. The repair signal is only supposed to rebuild user feed projections from already matched provider counts.
