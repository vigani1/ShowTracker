# ADR-0018: Provider Schedule Episode Numbering

## Context

On May 24, 2026, One Piece remained in the active Home Watchlist after episode 1163 was marked watched. The card showed `1163/1163 episodes` and `1 left`, while the detail panel showed raw planned progress as `1163/1181 episodes`.

This is the same product risk as the Wistoria case in ADR-0017, but a different provider-numbering shape. The tracked watched row is stored as the series absolute episode, `S23E1163`. The current production schedule rows include TVMaze-style yearly numbering, where the May 24, 2026 release is `S2026E08`, and nearby rows carry generic names like `Episode 1164`. The app must infer watched status from provider evidence, not from show-specific exceptions.

## Current Behavior

Before this change, `schedule.getFutureUpcomingCountsForWatchlist`, `schedule.getTodayScheduledWatchlistFeed`, and `schedule.getHomeScheduleSignalMatches` filtered watched schedule rows by:

- exact `showId + seasonNumber + episodeNumber`;
- the ADR-0017 same-season absolute offset inferred from watched rows, such as Wistoria watched `S02E19` matching scheduled `S02E07`.

That did not cover rows where the schedule provider season is a year or placeholder. One Piece production rows used `S2026E08` for the already-watched May 24 episode, so the schedule count still produced `availableCount: 1` and Home rendered the active card.

## Decision

Watched schedule suppression now also builds a schedule-derived absolute offset. For each matched schedule row, the server parses only generic episode labels in the form `Episode NNN`. If at least two rows for the same tracked show and schedule season agree on the same high offset, and there is no tie, the matcher can map provider season episodes to watched absolute episode numbers.

The matcher still checks exact keys first. It then allows direct absolute episode-number matching only for provider-style season numbers, currently season `1` or year-like seasons, and only when the episode number is at least `100`. Finally, it applies the schedule-derived offset against the watched absolute episode index.

The proof window is wider than the candidate window. Today-only reads and home signal reads may use nearby future rows to prove numbering, but future rows are still not eligible as available episodes until the existing date and airtime checks allow them.

The external schedule-confidence projection generator uses the same provider-style absolute numbering evidence for `watchlistFutureCountProjections`. Because that server job imports aggregate watched counts rather than every watched episode row, it only suppresses mapped absolute episodes whose absolute episode number is at or below the imported `watchedEpisodesCount`. Convex read-time queries remain stricter because they check the actual `watchedEpisodes` table.

## Reasoning

This avoids a One Piece-specific fix and keeps the behavior provider-evidence based. A single titled row like `S2026E08` is not enough to prove it means absolute episode 1163, but nearby generic rows like `Episode 1164`, `Episode 1165`, and `Episode 1166` can prove a stable `+1155` offset for the `2026` schedule season.

Requiring at least two agreeing rows and rejecting ties prevents a stray generic title from hiding an unwatched episode. Restricting direct absolute matching to provider-style seasons avoids treating ordinary later-season episode numbers as globally absolute when exact season matching should remain authoritative.

Using a wider proof window does not broaden availability. It only supplies numbering evidence; the existing schedule candidate loops still decide whether a row is same-day, post-airtime, future-only, duplicated, or matched to a tracked show.

## Provider/Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb bridge IDs, route IDs, canonical keys, and title fallback keep their existing matching rules. This change does not make title fallback more trusted for matching a show; it only interprets episode numbers after the row has already matched a tracked show.

Generic names matching `Episode NNN` are treated as numbering evidence when `NNN` is at least three digits. Descriptive titles with embedded numbers are intentionally ignored.

Tracked `watchedEpisodes` remain the source of truth for whether an episode has been watched. Schedule-derived offsets can only hide a schedule row when the mapped absolute episode exists in `watchedEpisodes` for the same tracked `showId`.

## Edge Cases

Completed shows with new releases still depend on release availability and watched rows; this change only changes schedule-row suppression after an episode is already watched.

Paused and dropped shows keep their existing status rules. A manually paused row is not resumed by this matcher.

Planned/not-started rows do not become active from the proof window. Future weekly rows can prove numbering, but they remain future-only until date and airtime checks make them available.

Long-running shows and anime season aliases are the main target. The matcher covers provider-year seasons and provider season `1` absolute episode rows without adding title-specific logic.

Missing providers and title fallback remain conservative. If there are not two agreeing generic rows, the new schedule-derived offset is not used.

Same-day duplicate rows keep the existing dedupe behavior. If both an absolute `S1E1163` row and a yearly `S2026E08` row exist for One Piece, both can be recognized as watched through separate absolute evidence.

Stale provider totals are unchanged. Raw planned totals such as One Piece `1181` still do not prove current availability by themselves.

## Verification

Local checks:

- `npx tsc --noEmit --pretty false`
- `npx expo lint`
- `npm run schedule-confidence:validate`
- `git diff --check`
- `npx convex deploy --dry-run --yes`
- `npx convex deploy --yes`

Production data simulation against `--prod` on May 24, 2026 loaded 630 `feedProjections`, 8191 recent `watchedEpisodes`, and 239 `userScheduleEvents`. The One Piece watched rows loaded included `S23E1156` through `S23E1163`.

Projection-backed count simulation for May 24 to August 22, 2026:

- One Piece: inferred offset `showId k5715hy4kw309fe1ddw6k9975h818mt6`, schedule season `2026`, offset `1155`. Old available count was `1`; new available count is `0`. The only newly filtered row is `2026-05-24 S2026E08`, `I Want You to Praise Me - The Reunion of Robin and Saul`.
- Rick and Morty: old available count `1`, new available count `1`, future count `9`.
- Silo: old available count `0`, new available count `0`, future count `8`.
- Wistoria: old available count `0`, new available count `0`, future count `6`.

Schedule-cache fallback simulation for May 24 to June 14, 2026 loaded 1140 `scheduleCache` rows and 44 proof rows. One Piece had two same-day cache rows:

- `S1E1163`, `Episode 1163`, filtered by direct provider-style absolute episode matching.
- `S2026E08`, `I Want You to Praise Me - The Reunion of Robin and Saul`, filtered by the inferred `+1155` offset.

The all-current-row projection simulation found exactly one row newly hidden by this change: One Piece on May 24, 2026. No Rick and Morty, Silo, or Wistoria behavior changed.

After deploying to production, `npx convex run --prod schedule:getFutureUpcomingCountsForWatchlistForUser '{"userId":"ks72ekcbbe4cjqqmcyd42x2e2d82myhc","startDate":"2026-05-24","endDate":"2026-08-22"}'` returned One Piece `routeId: tmdb:tv:37854` with `availableCount: 0`, `futureCount: 12`, and `unavailableCount: 12`.

The first VPS schedule-confidence run after the read-time fix proved a second stored-projection gap: `watchlistFutureCountProjections` still wrote One Piece `availableCount: 1` for both `mediaFilter: tv` and `mediaFilter: all`. The follow-up server projection fix adds a fixture named `Provider Year Numbering`; validation asserts the watched `S2026E08` row is suppressed from stored counts while future `Episode 1164` and `Episode 1165` remain future/unavailable.

## Rollback Notes

If valid unwatched episodes disappear from Home, first inspect `getScheduleAbsoluteSeasonOffsets` and `hasProviderAbsoluteEpisodeNumber`. The conservative rollback is to remove the schedule-derived offset and provider-style absolute checks while keeping the exact and ADR-0017 watched-row offset logic.

If today-only schedule rows regress again, inspect the proof-window query in `getProjectedTodayScheduledWatchlistFeed`, the fallback proof range in `getTodayScheduledWatchlistFeed`, and the future proof rows used by `getHomeScheduleSignalMatches`.

If schedule reads become too expensive, keep the matcher but reduce the proof window. Do not replace it with show-title exceptions.
