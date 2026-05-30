# ADR-0019: Home Schedule Signal Recency

## Context

On May 29, 2026, Dr. STONE (`tmdb:tv:86031`) was added on production and all but the latest episode were marked watched. The Home Watchlist did not show the title even though production schedule cache contained the May 28, 2026 release, `S04E33` / `Wanting Everything`, and the user had no watched row for that episode.

Production data showed the tracked `feedProjections` row at `status: watching`, `watchedEpisodesCount: 89`, `remainingEpisodes: 0`, and `totalEpisodes: 94`. The live schedule signal matcher found one available unwatched Dr. STONE episode, but `schedule:syncHomeCachedScheduleSignalsForUser` returned `already_ran_recently` because the per-user cached Home signal cursor had already run in the current 30-minute bucket.

Forcing the production sync proved a second part of the bug: the matcher wrote the episode's May 28 release timestamp, but the user's catch-up activity happened on May 29. Home still filtered the row out because `newEpisodeSignalAt` was older than `lastWatchedAt`.

## Current Behavior

Home reads `shows.getHomeActiveFeed` plus the same-day scheduled feed. A row with `remainingEpisodes <= 0` only stays in the active Watchlist when it has a `newEpisodeSignalAt` newer than `lastWatchedAt` or a same-day schedule count.

The cached Home schedule signal action runs when Home opens, but it used only the current 30-minute time bucket as its maintenance cursor. If the action ran before a newly added or newly updated watchlist row, later Home openings in the same bucket skipped evaluation. The schedule cache could know about an available unwatched episode while the feed projection still had no signal, so Home filtered the row out.

When the action did run, it stored the provider release timestamp directly. That worked for releases after the user's last watch activity, but it failed for the common catch-up flow where a user watches older episodes after the latest episode has already aired.

## Decision

The cached Home schedule signal cursor now includes the latest TV/anime `feedProjections.updatedAt` value for the user. Adding a show, changing watched progress, changing status, or otherwise updating a feed projection invalidates the skip cursor inside the same 30-minute bucket.

After applying schedule signals, the action stores a final cursor computed from the post-apply projection version. This prevents the signal patch itself from immediately forcing another redundant sync.

The cached signal scan now uses a 7-day recent-release lookback for catch-up repairs. Rows from today or yesterday keep the existing behavior. Older rows in that 7-day window are accepted by the cached Home action only when the user's last watch activity is after the provider signal, which is the catch-up-after-airdate shape. This keeps newly tracked or newly caught-up shows eligible when the latest available episode aired earlier in the week, without broadly waking every older recent schedule row on app open.

When applying a matched signal, the stored `newEpisodeSignalAt` is now at least one millisecond after the current `lastWatchedAt`. The matcher still uses the real provider release timestamp to decide availability, but the stored Home attention timestamp represents "new to the user's current watchlist state." Once the user watches that latest episode, the next `lastWatchedAt` naturally moves past the stored signal and Home hides the row again.

## Reasoning

The existing signal matcher already knew how to identify Dr. STONE's available episode through provider IDs and watched episode rows. The failures were the skip gate around that matcher and the assumption that provider release time must be newer than user activity, so changing active-feed filtering or adding title-specific exceptions would have increased regression risk.

Using the feed projection update timestamp makes the skip gate sensitive to the user's actual watchlist state. It remains bounded by the 30-minute bucket when nothing changes, but it reruns promptly after a relevant projection change.

Storing the final cursor after applying signals keeps the optimization stable. Without that, a successful signal patch would update the projection timestamp and make the next Home action in the same bucket run again.

Normalizing the stored signal timestamp keeps the existing Home and auto-pause semantics intact. Home can continue to treat `newEpisodeSignalAt > lastWatchedAt` as the active signal check, while catch-up-after-airdate rows still become visible.

Limiting extended cached lookback rows to catch-up-after-airdate matches reduces stale provider-cache risk. A direct provider row that aired several days ago but has no user watch activity after it is left to the existing full schedule signal and release-reconciliation paths rather than being newly introduced by the app-open cached repair.

## Alignment With Prior Decisions

This preserves ADR-0006 by keeping stale signal cleanup gated on provider-backed evidence. The matcher still clears only rows it checked and found no longer valid; it does not broaden stale-signal clearing or clear signals from title-only provider guesses.

It extends ADR-0017's `newEpisodeSignalAt` semantics without weakening them. A release signal remains trusted available attention for Home and auto-pause, but the stored attention time is normalized when the user catches up after the provider air date.

It keeps ADR-0017 and ADR-0018 watched-schedule suppression unchanged. Exact watched rows, inferred same-season offsets, and provider-style absolute-number evidence still decide whether a schedule row is already watched.

It stays within ADR-0010, ADR-0011, and ADR-0013 by preserving the projection/fallback architecture. No app-open provider hydration, broad Convex scan, schedule-cache mutation, projection repair expansion, or title-specific exception is introduced.

## Provider/Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb, route IDs, canonical keys, and title fallback keep their existing matching rules. This change does not make title fallback more trusted and does not add any show-specific matching.

Provider IDs remain the preferred match path. TV schedule rows without provider IDs only use same-media title fallback as before. Anime schedule rows keep the existing anime season alias handling.

Watched episode rows remain the source of truth for whether a scheduled episode is already watched. Provider totals and `remainingEpisodes` can be stale; they do not suppress a schedule signal by themselves.

## Edge Cases

Completed shows with new releases still rely on `newEpisodeSignalAt` to re-enter Home when a schedule row is available and unwatched.

Paused and dropped shows keep their existing section rules. The cached signal matcher still considers only `watching` and `completed` projections, and Home active filtering still excludes paused and dropped rows.

Planned/not-started shows remain out of the active Watchlist because the matcher only considers watched-progress rows with `watching` or `completed` status.

Long-running shows and anime season aliases keep the ADR-0017 and ADR-0018 watched-episode suppression rules. This change only decides when to rerun the matcher and how far back cached Home scans look.

Missing providers and title fallbacks remain conservative. Same-day duplicate episodes still dedupe through the existing schedule signal key.

Future weekly rows are still not considered available until the existing date and airtime checks allow them. The 7-day cached lookback only broadens recent past availability for catch-up-after-airdate rows; today and yesterday keep the previous cached behavior.

Stale provider totals are handled by schedule evidence. A projection with `remainingEpisodes: 0` can still surface when schedule cache proves an unwatched available episode.

## Verification

Production checks before the change:

- `npx convex data --prod shows --limit 100 --format json` confirmed Dr. STONE (`tmdbId: 86031`, `tvmazeId: 42372`) had `totalEpisodes: 94` and `releasedEpisodes: 89`.
- `npx convex data --prod feedProjections --limit 1000 --format json` confirmed the user's Dr. STONE projection had `status: watching`, `watchedEpisodesCount: 89`, `remainingEpisodes: 0`, and no schedule signal newer than `lastWatchedAt`.
- `npx convex data --prod watchedEpisodes --limit 1000 --format json` confirmed watched rows through `S04E32` and no watched row for `S04E33`.
- `npx convex data --prod scheduleCache --limit 1000 --format json` confirmed Dr. STONE schedule rows including May 28, 2026 `S04E33`, plus future weekly rows.
- `npx convex run --prod schedule:getHomeScheduleSignalMatches '{"userId":"ks72ekcbbe4cjqqmcyd42x2e2d82myhc","startDate":"2026-05-22","endDate":"2026-06-19","availableDate":"2026-05-29","nowMs":1780080000000}'` returned a Dr. STONE match with `matchedEpisodes: 1`.
- `npx convex run --prod schedule:syncHomeCachedScheduleSignalsForUser '{"userId":"ks72ekcbbe4cjqqmcyd42x2e2d82myhc","todayDate":"2026-05-29"}'` returned `skipped: true`, `reason: already_ran_recently`.
- Forcing the old production sync patched one feed projection and one user show, but it stored `newEpisodeSignalAt: 1779926400000`, which was still older than Dr. STONE `lastWatchedAt: 1780026396663`. That proved the recency normalization was needed in addition to the cursor fix.
- A historical May 24, 2026 matcher check showed no One Piece, Rick and Morty, or Wistoria match. It did expose a completed `Marvel's The Punisher` direct TMDB schedule-cache row from May 20, 2026. That row is why the cached extended lookback is limited to catch-up-after-airdate matches instead of broadly accepting every older recent provider row.

Local checks:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npx convex deploy --dry-run --yes`
- `npm run schedule-confidence:validate`
- `git diff --check`

Regression checks should confirm that Rick and Morty, Silo, Wistoria, One Piece, and Dr. STONE keep their expected active/paused/completed behavior after deployment.

## Rollback Notes

If Home schedule sync becomes too chatty, inspect `getScheduleSignalSyncCursor` and the final cursor write in `syncCachedHomeScheduleSignalsForUser`. The conservative rollback is to remove the projection-version component from the cursor while keeping the signal matcher unchanged.

If stale old releases start appearing, reduce `HOME_CACHED_SIGNAL_LOOKBACK_DAYS` while keeping the projection-aware cursor. Do not replace the matcher with show-title exceptions.
