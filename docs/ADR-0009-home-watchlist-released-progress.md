# ADR-0009: Home Watchlist Released Progress Counts

## Context

Family Guy showed `2 left` and `455/457 episodes` on the Home watchlist card while the show detail screen showed `455/456 episodes`, leaving only one released episode to watch. The mismatch is risky because the Home watchlist count is used as an attention signal, while the detail route can load fresher provider metadata.

## Current Behavior

Before this change, Home and scheduled-watchlist card serializers read feed projections with:

- `remainingEpisodes` based on `releasedEpisodes` when that field existed, otherwise `totalEpisodes`.
- `totalEpisodes` copied from the raw show total, even when `releasedEpisodes` was lower.
- no projection repair when `refreshTrackedShowMetadata` skipped provider refresh due the one-hour metadata throttle.

That meant a projection could keep showing a planned or stale provider total on the card even after the tracked show metadata was fresh enough to skip refetching.

## Decision

Home and scheduled-watchlist card payloads now use the released/watchable episode count as their serialized `totalEpisodes` denominator whenever `remainingEpisodes` makes that count known. The stored `feedProjections.totalEpisodes` value remains the raw provider show total so Discover/Recommendations tracked-state maps keep their existing semantics.

The same watchable count continues to drive `remainingEpisodes`.

When a tracked show metadata refresh is throttled, the action still refreshes the current user's feed projection from the current Convex show row. The provider refetch throttle remains in place. The throttle is bypassed only for TV shows with missing or invalid `releasedEpisodes`, because those rows cannot safely distinguish released backlog from future planned totals.

## Reasoning

The Home watchlist card should answer "what can I watch now?" rather than "how many provider-planned episodes exist?" Using the released count as the card denominator keeps the badge and progress text aligned with detail progress when the provider exposes a lower released total than the raw total.

Keeping the stored projection total unchanged limits blast radius. Other projection consumers can keep treating `totalEpisodes` as a raw provider total, while Home and scheduled-watchlist cards deliberately serialize a watchable display total.

Refreshing only the current user's projection during a throttled detail refresh is safer than broadly rebuilding every user's projections or changing schedule-cache matching. It fixes stale card rows without touching provider reconciliation, route IDs, sorting, dedupe, or calendar counts.

## Provider/Data Assumptions

TMDB TV totals can include planned or stale future episodes. When TMDB exposes released episode counts, those are trusted for Home watchlist progress over raw `number_of_episodes`.

AniList/Jikan anime totals and released counts keep their existing normalization. Title fallback, low-confidence provider matching, TVMaze schedule rows, IMDb route bridging, and anime relation/root IDs are unchanged.

If `releasedEpisodes` is missing, Home card payloads keep falling back to `totalEpisodes` until a tracked metadata refresh can populate a released count. The new throttle bypass exists only to repair that missing released-count state for tracked TV shows.

## Edge Cases

Completed shows with new releases still rely on released counts and `newEpisodeSignalAt` to reappear. Paused and dropped shows keep their existing section filters. Planned/not-started shows still fall back to raw totals when no released count exists. Long-running shows such as Family Guy benefit because future/stale totals no longer overstate the Home card denominator once released counts are known.

Anime season aliases, missing providers, title fallbacks, same-day duplicate episodes, future weekly rows, stale provider totals, and schedule-cache merges keep the same provider identity and dedupe behavior. This change only adjusts the serialized Home/scheduled-card progress denominator and the projection repair path after a throttled detail refresh.

Discover and Recommendations continue reading raw projection totals for tracked-state labels.

## Verification

Static checks:

- `npx convex codegen`
- `npx tsc --noEmit`
- `npx expo lint`

Known-show check:

- Family Guy with 455 watched and 456 released episodes should project as `455/456 episodes` and `1 left` on Home after the projection refresh path runs.

## Rollback Notes

Revert the watchable card-total serializers in `convex/shows.ts` and `convex/schedule.ts`, plus the throttled projection refresh path in `convex/shows.ts`, if Home starts hiding real released backlog or if paused/completed rows stop reappearing when new episodes become available.

After rollback, watch Home watchlist rows, completed-show reactivation, paused queue rows, and schedule attention counts for Family Guy, other long-running TMDB shows, and long-running anime.
