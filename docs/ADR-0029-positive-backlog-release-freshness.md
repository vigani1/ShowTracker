# ADR-0029: Positive Backlog Beats Future-Only Schedule Counts

## Status

Accepted

## Context

On June 15, 2026, production `/show/tmdb:tv:60625` loaded Rick and Morty as a tracked `Watching` show. The detail page showed season 9 episode 4 as aired on June 14, 2026 and unwatched, but Home did not show Rick and Morty in the active Watchlist.

Production data showed the bug had two parts:

- `shows.releasedEpisodes`, the detail progress header, and the user feed projection could remain stale at `84` even while the detail season payload showed `85` released episodes.
- After a forced metadata repair updated the projection to `watchedEpisodesCount: 84`, `remainingEpisodes: 1`, `newEpisodeSignalAt: 2026-06-14`, and `homeSortAt: 2026-06-14`, Home still hid the row because the ADR-0027 client guard compared `futureCount: 6` against `remainingEpisodes: 1` and classified the row as future-only.

This was introduced by the interaction between older client mutation payloads and ADR-0027. Detail/watch mutations preserve existing `releasedEpisodes`, but they also stamped `lastUpdated` with the client time even when the payload did not carry release-count freshness. That made stale `releasedEpisodes` look fresh and allowed `refreshTrackedShowMetadata` to throttle. ADR-0027 then added a final future-only display guard for caught-up rows, but its positive-remaining branch also hid real released backlog when future scheduled rows existed.

## Current Behavior

Before this change:

- Existing TV/anime show rows could receive a fresh `lastUpdated` from client payloads that omitted `releasedEpisodes`.
- A subsequent tracked metadata refresh could skip provider fetches for up to one hour and rebuild the user's projection from stale release counts.
- Home's client guard treated `futureCount >= remainingEpisodes` as proof that a row had no actionable episode, even when `remainingEpisodes` was already the released/watchable backlog.
- Rick and Morty with one released unwatched episode and six future rows was hidden from Home.

## Decision

Client-origin show upserts that do not include a `releasedEpisodes` field no longer advance `lastUpdated` for existing TV/anime rows. They may still update display metadata and preserve existing release counts, but provider freshness remains tied to payloads that explicitly carry release-count facts.

Home now treats a positive `remainingEpisodes` value with a fresh `newEpisodeSignalAt` as actionable backlog before applying the future-count veto. The future-only guard still hides caught-up rows and positive-remaining rows that have no fresh release signal and whose schedule counts prove all remaining entries are unavailable/future.

Detail progress now uses the larger released count when loaded season payloads prove more episodes have aired than the show-level provider summary reports. When only the current season is fully loaded, previous season summary counts are combined with the highest released episode number in the loaded season. Raw planned totals still bound the denominator and upcoming episode rows remain visible.

## Reasoning

`lastUpdated` controls provider refresh throttling, so it must represent provider freshness rather than any client write touching a show row. Preserving it for payloads without release facts allows the existing refresh action to fetch TMDB season details and repair stale release counts instead of being blocked by a cosmetic or tracking mutation.

Home `remainingEpisodes` is intended to mean released/watchable backlog after ADR-0009 and ADR-0026. Future scheduled rows are separate facts. They can prove a caught-up row is future-only, but they should not cancel a fresh release signal that says there is released backlog.

The detail route already loads season payloads to render episode cards. When those payloads expose a newly aired episode, they are stronger evidence for watchable progress than a stale TMDB `last_episode_to_air` summary. Combining the loaded season's released episode number with previous season summary counts keeps the detail route and Home aligned without requiring every prior season to be hydrated.

This keeps ADR-0027's caught-up protection intact while avoiding the Rick and Morty false negative.

## Provider/Data Assumptions

TMDB season details remain trusted for refining released TV episode counts when a tracked metadata refresh runs.

Client payloads from detail/import/list flows may have useful catalog fields but should not be treated as release-count freshness unless they explicitly include `releasedEpisodes`.

`newEpisodeSignalAt` remains a release-attention candidate only when it is newer than `lastWatchedAt`.

`watchlistFutureCountProjections` and schedule-cache counts still identify available, unavailable, and future rows for Home, but future rows are not subtracted from positive released backlog when a fresh release signal exists.

## Edge Cases

Caught-up rows with `remainingEpisodes <= 0` and only future rows remain hidden.

A watching row with positive remaining episodes and a fresh release signal appears even when future episodes are also scheduled.

A detail route with the current season loaded can show `84/85` progress even if the show-level summary still reports `84` released episodes.

A positive-remaining row with no fresh release signal can still be hidden when schedule counts prove the remaining count is future-only.

Movies keep their existing `lastUpdated` behavior because release-count freshness is not part of movie watchlist availability.

New show rows still receive the incoming `lastUpdated` because there is no prior freshness timestamp to preserve.

## Verification

Production diagnosis:

- `/show/tmdb:tv:60625` showed S09E04 as aired and unwatched while Watch Progress still read `84/84`.
- Home did not include Rick and Morty.
- A forced metadata repair for `tmdb:tv:60625` returned `releasedEpisodes: 85`, `totalEpisodes: 91`, and repaired one user's projection.
- Production schedule counts for the user returned `tmdb:tv:60625` with `availableCount: 0`, `futureCount: 6`, and `unavailableCount: 6`, proving the client future-count guard was hiding the repaired positive backlog.

Required checks for this change:

```bash
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Production verification should open Home while logged in and confirm Rick and Morty appears as `1 left` after deploy. It should also open `/show/tmdb:tv:60625` and confirm detail Watch Progress reads `84/85 episodes` while S09E04 is the next watchable episode. It should also confirm caught-up future-only rows such as the ADR-0027 Classroom of the Elite case remain hidden.

## Rollback Notes

Rollback by reverting the `buildShowPatch` freshness preservation in `convex/shows.ts`, the positive-backlog release-signal guard in `app/(tabs)/home/index.tsx`, and the season-proven released-count preference in `app/show/[id].tsx`.

If rollback is needed because stale future-only rows reappear, inspect whether those rows have positive `remainingEpisodes` without reliable `releasedEpisodes` and repair the projection source before weakening the released/watchable backlog contract.
