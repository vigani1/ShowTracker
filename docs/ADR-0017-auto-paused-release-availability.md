# ADR-0017: Auto-Paused Release Availability

## Context

On May 24, 2026, Home showed misleading availability rows:

- Rick and Morty had an unwatched current-day episode, but the show was still marked `Paused` with an automatic snooze badge.
- Silo was caught up at 20 released episodes while season 3 was scheduled for July 2026, but it still appeared in the Paused queue because the row was system-snoozed and the raw planned total was higher than watched progress.
- Wistoria: Wand and Sword showed in the active Watchlist as `19/19 episodes` watched after the current-day episode was marked watched. The detail route still had a raw `19/24` denominator because episode 20 and later were future weekly rows beginning May 31, 2026.

The product risk is that Home stops representing "what can I watch now?" New releases can remain buried in Paused, while future-only planned seasons can look like available backlog in either Paused or the active Watchlist.

## Current Behavior

Before this change:

- `autoPauseInactiveShows` used `lastWatchedAt` and the raw `shows.totalEpisodes` guard. It did not treat `newEpisodeSignalAt` as recent activity and did not prefer `releasedEpisodes` when deciding whether a user was caught up.
- `scheduleConfidence.applyReleaseDeltas` resumed completed rows when a trusted `available_now` delta proved new released content, but it did not wake rows that were paused only because of `autoPausedAt`.
- `getHomePausedFeed` and the Home Paused section could include auto-paused rows even when the released/watchable backlog was zero. In `all_paused` mode, manually paused rows and system-snoozed rows were treated the same.
- The client filtered active future-only rows only in `after_airtime` mode. In `same_day` mode, a row like Wistoria could stay in the active Watchlist after today's episode was watched because all remaining progress was future weekly rows.
- `schedule.getFutureUpcomingCountsForWatchlist` counted schedule rows without removing episodes already present in `watchedEpisodes`, so a watched same-day episode could still produce Home schedule attention and a `1 left` badge.
- Some tracked rows store season episodes as absolute series numbers while schedule providers use in-season numbering. In production, Wistoria's watched row was stored as season 2 episode 19, while TVMaze's schedule row for the same release was season 2 episode 7.
- The Paused section did not apply the same future-count check.

## Decision

Auto-pause now treats the newest of `lastWatchedAt` and `newEpisodeSignalAt` as the inactivity anchor. A new release signal gets the same 30-day grace window as a watch event before the row can be auto-paused again.

The fully watched guard now prefers `releasedEpisodes` over raw `totalEpisodes`. Raw totals can still be used as a fallback when released counts are unavailable, but a known released/watchable count wins.

Trusted release repair now wakes system-owned auto-paused rows. When a direct non-title-fallback release delta proves `watchedEpisodesCount < releasedEpisodes`, `scheduleConfidence.applyReleaseDeltas` changes only rows with `autoPausedAt` from `paused` back to `watching` or `plan_to_watch` and clears `autoPausedAt`. Manually paused rows remain paused.

The daily auto-pause maintenance also repairs already-existing system snoozes that predate this change. It only wakes rows with `autoPausedAt` when `newEpisodeSignalAt` is newer than the last watch, the signal is still inside the 30-day attention window, and `shows.releasedEpisodes` is greater than watched progress. This covers production rows that already received the bad auto-pause before the release-delta wake behavior existed, without undoing old inactive backlog snoozes.

Home now uses one actionable-episode check for active rows and auto-paused rows. The check treats same-day schedule attention as actionable in `same_day` mode, treats post-airtime availability as actionable in `after_airtime` mode, and suppresses rows when every remaining episode is future-only.

Future watchlist schedule counts now remove episodes the user has already marked watched before calculating `availableCount`, `futureCount`, and `unavailableCount`. This applies to both the projection-backed path and the schedule-cache fallback path. The fallback path reads watched rows only for shows that actually matched schedule rows in the requested count window, preserving the cost intent of the projection work.

Watched schedule suppression now accepts two episode-number shapes: exact `showId + season + episode` matches, and a narrow absolute-number match when watched rows for a later season continue directly after the previous season's max episode. That covers rows like Wistoria S02E19 watched matching TVMaze S02E07 scheduled, without broadly treating all raw episode-number differences as watched.

The Home Paused section now treats manual pause and system snooze differently. Manual paused rows still appear in `all_paused` mode. Auto-paused rows appear only when they have actionable released or same-day schedule attention; future-only rows are suppressed until they become available under the user's airtime mode.

## Reasoning

Auto-pause should represent old inactive attention, not immediately hide a show on the day a new episode becomes available. Using `newEpisodeSignalAt` prevents a current release from being snoozed just because the user's last watched episode was more than 30 days ago.

Released counts are safer than planned totals for auto-pause. Planned totals can include future seasons, as with Silo season 3. Treating those planned episodes as watchable backlog creates false Paused queue work.

Waking only rows with `autoPausedAt` preserves user intent. A manually paused show can still stay paused through new releases. A system-snoozed show can rejoin active attention when trusted provider facts say there is something available now.

The maintenance repair is deliberately narrower than "auto-paused with remaining episodes." A stale backlog can remain snoozed; only a recent release signal after the user's last watch can wake it. That prevents the repair from turning the entire old auto-paused queue back into active Watchlist rows.

The client-side future-count check is needed because schedule projection counts can prove that a positive `remainingEpisodes` value is entirely future-only. Keeping that check on Home avoids relying on raw projection counts when schedule facts are more precise.

Filtering watched episodes inside the schedule-count query is safer than only hiding `remainingEpisodes <= 0` rows in the client. ADR-0002 intentionally allows same-day schedule facts to surface rows when provider totals lag, so the schedule fact must stay available for genuinely unwatched episodes and disappear only after the concrete season/episode key is watched. The absolute-number fallback is intentionally inferred only from the user's watched rows; it is not a provider title or route fallback.

## Alignment With Prior Decisions

This change preserves ADR-0002's same-day schedule bridge. Same-day schedule facts can still surface a row when provider totals lag, but only while the exact scheduled episode is still unwatched.

It preserves ADR-0005, ADR-0007, and ADR-0008 by keeping routine provider freshness and stale schedule-cache pruning in the external schedule-confidence workflow. No app-open provider hydration, broad title fallback, route matching expansion, or new Convex schedule refresh is introduced.

It follows ADR-0006 by treating stale attention signals as something the reconciler clears with provider-backed evidence. This change does not clear `newEpisodeSignalAt`; it only prevents auto-pause from immediately snoozing a row whose signal is fresh.

It extends ADR-0009 and ADR-0012's watchable-count direction: Home and auto-pause should prefer released/watchable counts over raw planned totals, because planned totals can include future seasons.

It stays within ADR-0010 and ADR-0011 by preserving the projection/fallback architecture. Future-count reads still use projection rows when coverage is active, fall back when coverage is missing or stale, and read watched episodes only for projected or matched schedule rows rather than scanning the entire library as a repair mechanism.

It respects ADR-0013 through ADR-0016 by not broadening `projectionRepair`, not trusting future-only provider rows as watchable backlog, and not changing title-fallback apply permissions. The only status promotion added here is for rows that the system itself auto-paused through `autoPausedAt`.

## Provider/Data Assumptions

Direct provider IDs remain the trusted path for release repair. Title-fallback deltas still cannot mutate user status.

`releasedEpisodes` is the watchable count for Home availability when present. `totalEpisodes` can include planned future episodes and is not enough by itself to prove available backlog.

`newEpisodeSignalAt` represents trusted available release attention, not a future schedule placeholder. Same-day schedule facts can supplement projection counts for display, but future-only counts intentionally suppress active and auto-paused rows until airtime rules make them available. The auto-pause maintenance repair trusts `newEpisodeSignalAt` only when it is newer than `lastWatchedAt` and younger than the inactivity threshold.

Watched schedule suppression trusts the tracked `showId` plus episode numbers from the tracked projection and `watchedEpisodes`. It first checks exact `seasonNumber` and `episodeNumber`. If watched rows show a season continuing directly from the previous season's max episode number, it also checks the schedule episode plus that inferred season offset. It does not use title fallback to decide whether an episode is watched.

TMDB, TVMaze, AniList, Jikan/MAL, IMDb bridge IDs, route IDs, canonical keys, anime season aliases, and low-confidence title fallback keep their existing matching rules.

## Edge Cases

Completed shows with new releases still resume through the existing completed-row path.

Paused shows wake only when they were system auto-paused. Manually paused rows stay paused. Dropped rows are unchanged.

Planned/not-started rows do not become active attention from future schedule entries. If an auto-paused row has no watched progress, the wake path uses `plan_to_watch`.

Long-running shows still rely on released counts and conservative provider matching. Raw planned totals alone should not create a Paused queue backlog.

Anime season aliases remain covered by the existing schedule/provider matching rules. This change does not broaden TV/anime title fallback.

Missing providers and title fallback remain conservative. Title-fallback release deltas are skipped before user-status repair.

Same-day duplicate episodes keep the existing schedule dedupe. Future weekly rows contribute to future-count suppression until they become available.

Same-day watched episodes no longer contribute to Home schedule attention counts, including watched rows stored with absolute season numbering. If an episode is unwatched, same-day behavior remains unchanged.

Stale provider totals are bounded by the same release-authority rules from ADR-0016. A future-only provider row must not wake an auto-paused show.

## Verification

Local checks run for this change:

- `npx tsc --noEmit --pretty false`
- `npm run schedule-confidence:validate`
- `npx expo lint`
- `git diff --check`
- `npx convex deploy --dry-run --yes`

`schedule-confidence:validate` passed with 17 fixture checks, 12 release facts, 12 deltas, and 3 expected audit issues.

Known-show checks:

- Rick and Morty with an unwatched May 24, 2026 release should not be immediately auto-paused because `newEpisodeSignalAt` is the latest attention timestamp.
- A trusted `available_now` release delta for an auto-paused Rick and Morty row should clear `autoPausedAt` and return the row to active watching attention.
- Silo with 20 watched and 20 released episodes, plus future season 3 rows beginning July 2026, should not appear as actionable auto-paused backlog before airtime.
- Wistoria: Wand and Sword with 19 watched/released episodes and future episode 20 on May 31, 2026 should not remain in the active Watchlist once the May 24, 2026 episode is watched. Production data confirmed the watched row is `season: 2, episode: 19` while the schedule row is TVMaze `S02E07`; the watched-schedule filter must treat that as watched through the inferred absolute episode offset.

Production data checks against `--prod` on May 24, 2026:

- Rick and Morty: `status: paused`, `autoPausedAt: 1779583501080`, `watchedEpisodesCount: 81`, `shows.releasedEpisodes: 82`, `newEpisodeSignalAt: 1779580800000`, and an unwatched TVMaze `S09E01` schedule row on `2026-05-24`. The maintenance repair predicate returns `repair-to-watching`.
- Silo: `status: paused`, `autoPausedAt: 1779583501080`, `watchedEpisodesCount: 20`, `shows.releasedEpisodes: 20`, and future-only TVMaze season 3 rows beginning July 2026. The maintenance repair predicate returns `leave-as-is`.
- Wistoria: `status: watching`, `watchedEpisodesCount: 19`, `shows.releasedEpisodes: 19`, `remainingEpisodes: 0`. The current production `watchlistFutureCountProjections` row had stale `availableCount: 1`, but the read-time projection path no longer counts stale projection rows and the watched schedule index maps TVMaze `S02E07` to watched `S02E19`.
- Production paused scan size: 630 `userShows` rows total, 8 paused rows, 3 system auto-paused rows; Rick is inside the first repair batch.

No local Expo or Convex dev server needs to be started for this verification.

## Rollback Notes

If current releases stop waking system-snoozed shows, inspect `scheduleConfidence.applyReleaseDeltas`, `resumeCompletedUserShowsForNewReleasedEpisodes`, and `newEpisodeSignalAt` updates before changing Home filters.

If manually paused shows start moving unexpectedly, revert the auto-paused wake branch and confirm only rows with `autoPausedAt` were affected.

If future-only rows reappear in Paused or the active Watchlist, inspect the released-count guard in `autoPauseInactiveShows` and the Home `hasWatchlistActionableEpisode` check.

If active Home rows start hiding valid releases, rollback should revert the Home Paused-section filter separately from the server wake logic so same-day active attention from ADR-0002 remains intact.
