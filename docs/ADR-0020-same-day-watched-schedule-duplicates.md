# ADR-0020: Same-Day Watched Schedule Duplicates

## Context

On May 31, 2026, Wistoria: Wand and Sword (`tmdb:tv:245842`) still appeared in the Home Watchlist after the latest visible episode was marked watched. Production detail data showed `20/24` planned episodes and the watched rows included the concrete current release, season 2 episode 8. The Home card still showed active attention because schedule-cache matching produced an available same-day row.

Production schedule data for May 31, 2026 contained two rows that matched the same tracked show:

- AniList `anilist:182300`, `S01E08`, `Episode 8`, `2026-05-31T07:30:00Z`.
- TVMaze `tvmaze:75379`, `S02E20`, `Episode 20`, `2026-05-31`.

The live TVMaze API currently reports the May 31, 2026 Wistoria release as `S02E08`, `Teachings of the Witch`, so the `S02E20` cache entry is stale provider/cache data. The app still has to handle that safely until the server-owned schedule job corrects cached rows.

## Current Behavior

Before this change:

- `schedule.getHomeScheduleSignalMatches` considered both same-day rows independently. The AniList row mapped to a watched episode, but the stale TVMaze `S02E20` row did not, so Home received a new schedule signal.
- `schedule.getTodayScheduledWatchlistFeed` and `schedule.getFutureUpcomingCountsForWatchlist` filtered watched rows after matching, but they did not use watched status to suppress stale same-show same-day duplicate provider rows.
- The stored schedule projection window was stale after the user watched Wistoria, so read-time queries fell back to `scheduleCache` and hit the duplicate-row shape directly.
- The server-owned schedule-confidence job could also import TMDB rows that duplicated the same season/date in season-local and cumulative numbering, such as Wistoria `S02E09` and `S02E21` on June 7, 2026.

## Decision

After matching schedule rows to tracked shows and loading watched rows, schedule read paths now identify same tracked show plus same date groups where at least one candidate is watched. If every unwatched candidate in that group collapses with a watched candidate under the existing same-day duplicate rules, the whole group is suppressed.

This rule is applied to:

- projected future watchlist counts;
- projected today scheduled watchlist rows;
- cached Home schedule signal matches;
- fallback today scheduled watchlist rows;
- fallback future watchlist counts.

The rule does not alter provider matching, route IDs, title fallback, release counts, status repair, or schedule-cache writes.

The schedule-confidence server also dedupes same-source same-show same-date episode aliases when the two episode numbers differ by a large offset and at least one row has a generic episode name. This removes source data shaped like Wistoria `S02E09` plus `S02E21` without collapsing ordinary back-to-back same-day episodes such as `S02E09` and `S02E10`.

## Reasoning

The unsafe fix would be to assume that Wistoria `S02E20` means `S02E08`. That can hide a real unwatched season 2 episode 20 for another show. The safer fix reuses the app's existing same-day duplicate semantics: when two providers describe the same tracked show on the same day and the rows are generic/conflicting enough to collapse as duplicates, a watched duplicate can prove that the stale duplicate should not keep Home active.

This preserves ADR-0002's schedule bridge. Same-day schedule rows can still surface a show when there is a genuinely unwatched release. They stop surfacing only when the conflicting same-day provider candidates collapse to a watched episode.

This preserves ADR-0017 and ADR-0018. Exact watched rows, watched-row absolute offsets, and provider-style absolute-number evidence still decide whether a row is watched. This change only decides what to do with duplicate candidates that already matched the same tracked show and date.

## Provider/Data Assumptions

Provider IDs remain the preferred match path. TVMaze rows still only title-match tracked TV rows unless a provider ID links them. AniList anime rows keep the existing anime season alias bridge.

`watchedEpisodes` remains the source of truth for watched status. A duplicate group is suppressed only after at least one candidate maps to an actual watched row for the same tracked `showId`.

Title fallback is not broadened. This change uses the existing same-day collapse predicate after a match has already happened.

The server-owned schedule-confidence workflow remains responsible for correcting stale schedule-cache facts. Read-time suppression is a defensive guard so stale duplicate cache rows do not create false Home attention while waiting for that workflow.

Same-source provider aliases are accepted only with a large episode-number delta and a generic episode name. This treats duplicated season-local/cumulative provider rows as stale aliases while preserving normal same-day multi-episode releases.

## Edge Cases

Completed shows with new releases still reappear when a same-day or release signal points to an unwatched episode.

Paused and dropped status rules are unchanged. This matcher does not resume rows or change manual pause intent.

Planned/not-started rows still do not become active Home attention from schedule rows because the affected Home paths only consider watched in-progress/completed tracked rows.

Long-running shows keep the ADR-0018 provider-style absolute-number handling. A single ordinary `S02E20` row is not treated as `S02E08`.

Anime season aliases remain supported through existing AniList title-variant matching. The Wistoria case uses that existing bridge only after AniList and TVMaze both match the same tracked row.

Missing providers and title fallbacks remain conservative. If there is no watched duplicate in the same tracked show/day group, an unwatched schedule row still behaves as before.

Same-day double episodes with distinct non-generic names are not suppressed by this rule because they do not collapse as generic duplicates. Existing duplicate semantics already collapse generic cross-provider rows for one tracked show/day, so this change aligns watched filtering with that behavior.

Same-source same-day rows with adjacent or small episode-number differences are not collapsed by the server alias rule. That keeps normal premieres, finales, and two-episode drops intact.

Future weekly rows can still contribute future/unavailable counts. The duplicate suppression only applies within the same tracked show/date group.

Stale provider totals remain separate from schedule evidence. Raw planned totals such as `24` for Wistoria do not prove available backlog.

## Verification

Production checks before the change:

- `npx convex data --prod feedProjections --limit 8191 --format json` confirmed Wistoria `tmdbId: 245842`, `watchedEpisodesCount: 20`, `remainingEpisodes: 0`, `lastWatchedAt: 1780248843043`, and `newEpisodeSignalAt: 1780248843044`.
- `npx convex data --prod watchedEpisodes --limit 8191 --format json` confirmed Wistoria watched rows include season 2 episode 8 for show id `k57dymawz89bk84c4w173y10h18180q0`.
- `npx convex data --prod scheduleCache --limit 4000 --format json` confirmed the May 31, 2026 duplicate rows: AniList `S01E08` watched-shape and stale TVMaze `S02E20`.
- `npx convex run --prod schedule:getHomeScheduleSignalMatches '{"userId":"ks72ekcbbe4cjqqmcyd42x2e2d82myhc","startDate":"2026-05-24","endDate":"2026-06-21","availableDate":"2026-05-31","nowMs":1780250000000,"extendedPastSignalMode":"catch_up_only"}'` returned Wistoria as a match before the fix.
- `Invoke-RestMethod 'https://api.tvmaze.com/shows/75379/episodes'` confirmed live TVMaze has May 31, 2026 as Wistoria `S02E08`, not `S02E20`.

Local verification:

- A focused Node reproduction using the exact prod Wistoria candidate shapes returned `{ "wistoriaGroupSuppressed": true, "staleCollapsesWithWatched": true }`.
- The VPS schedule-confidence run after the Convex deploy repaired the May 31, 2026 TVMaze cache row to `S02E08 / Teachings of the Witch`. It also exposed future TMDB alias rows such as June 7, 2026 `S02E09` plus `S02E21`, motivating the same-source alias dedupe.
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `npx convex deploy --dry-run --yes`

## Rollback Notes

If valid unwatched same-day releases disappear from Home, inspect `getWatchedSameDayDuplicateGroupKeys` first. The conservative rollback is to remove that helper and its call sites while keeping ADR-0017, ADR-0018, and ADR-0019 watched/signal logic intact.

If stale rows continue to appear after this read-time guard, inspect the server-owned schedule-confidence workflow and schedule-cache maintenance path for the provider fact that should replace stale TVMaze rows like Wistoria `S02E20`.
