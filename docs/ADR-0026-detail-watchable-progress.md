# ADR-0026: Detail Watchable Progress Denominator

## Context

On June 11, 2026, production showed `Classroom of the Elite` at `/show/tmdb:tv:72517` with `52/54 episodes` and `96%` progress on the detail page. The same user row on Home correctly showed the title as caught up at `52/52 episodes`.

Convex production data already had the correct split:

- `shows.totalEpisodes = 54`
- `shows.releasedEpisodes = 52`
- `feedProjections.watchedEpisodesCount = 52`
- `feedProjections.remainingEpisodes = 0`

The provider schedule also exposed future rows for season 4 episodes 15 and 16, so the raw total was not itself stale. The bug was that the detail page reused raw planned totals for progress and show-level fully-watched checks.

## Current Behavior

Before this change, the detail page calculated:

- `totalEpisodesCount` from `show.totalEpisodes` first.
- progress as `watchedEpisodesCount / totalEpisodesCount`.
- caught-up rail text from the same raw total.
- show-level "fully watched" action availability from the same raw total.

For shows with future-known episodes, a user who had watched every released episode still looked unfinished on the detail page. Home did not have this problem because ADR-0009, ADR-0015, and ADR-0017 already make Home and auto-pause prefer released/watchable counts over raw planned totals.

## Decision

Detail progress now uses a watchable denominator for non-movie tracking:

1. Prefer `show.releasedEpisodes` when present.
2. Fall back to released episodes from loaded season payloads.
3. Fall back to the raw planned total only when no released count is known.
4. Keep the denominator at least as high as the user's watched count so early/manual future watches never display `watched > total`.
5. Bound the denominator by the raw planned total when that total is known.

The detail page still displays the raw planned episode total in catalog badges and still shows upcoming future episode cards. Only user progress, caught-up rail progress text, and show-level fully-watched action gating use the watchable denominator.

## Reasoning

The detail page should answer the same user-facing progress question as Home: "Am I caught up with what can be watched now?" Raw provider totals answer a different catalog question: "How many episodes are known or planned?"

Using the watchable denominator keeps the detail route consistent with Home without weakening schedule correctness. Future episodes remain visible as upcoming rows, so users can still see that more episodes are planned.

This also avoids exposing a misleading "mark all watched" state when the only unwatched episodes are future-dated. Show-level actions continue to batch only released episodes.

## Provider/Data Assumptions

`releasedEpisodes` is trusted when Convex or the normalized provider detail payload supplies a positive count. TMDB and TVMaze detail payloads can include future episodes in the raw total, while their episode dates identify which rows are currently released.

When `releasedEpisodes` is unavailable, loaded season episodes are allowed to infer released counts from `airDate`. If neither source is available, the detail page keeps the previous raw-total behavior.

Future provider rows are not pruned by this decision. Schedule-cache maintenance, provider-date conflicts, and stale row pruning remain governed by the schedule/release ADRs.

## Edge Cases

Finished shows with no future episodes are unchanged because released and total counts match.

Long-running shows with missing release counts keep falling back to raw totals, preserving older behavior where the app cannot confidently separate released from planned.

If a user has manually watched more episodes than the released count, the watchable denominator expands up to the watched count and remains bounded by the raw total when known.

Anime and TV detail routes share this rule. Movie progress remains unchanged.

Season accordions keep showing planned season episode counts plus upcoming labels; those rows are catalog detail, not progress completion.

## Verification

Required checks:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `git diff --check`
- `npx convex deploy --dry-run --yes`

Production verification should open `/show/tmdb:tv:72517` while logged in and confirm:

- `Classroom of the Elite` Watch Progress shows `52/52 episodes`.
- The percentage reads `100%`.
- Season 4 episodes 15 and 16 remain visible as upcoming future episodes.
- Home still shows the same title as caught up at `52/52 episodes`.

## Rollback Notes

Rollback by reverting the detail-page denominator change. If reverted, watch for detail routes showing caught-up titles as incomplete whenever providers expose future-known episode totals.

During rollback, re-check Home active rows, paused rows, completed/caught-up rows, future episode cards, and show-level mark-all behavior for titles with future known episodes.
