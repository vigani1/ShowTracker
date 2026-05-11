# Convex Usage Audit And Future Fixes Plan

Last updated: 2026-05-11

## Purpose

This document tracks Convex usage risks, current cost drivers, and future fixes to consider if usage increases. It is not a mandate to optimize everything immediately. The goal is to keep paid usage predictable while avoiding the broad backfill patterns that disabled the project on the Free tier.

Current priority:
- Keep broad backfill off normal app paths.
- Monitor dashboard usage after the May 2026 mitigations.
- Only implement deeper optimizations when dashboard trends justify them.

## Current State

The original May 2026 Convex dashboard audit showed database bandwidth as the limiting resource. Function calls, action compute, database storage, file storage, file bandwidth, vector storage, and vector bandwidth were not the bottleneck.

May dashboard snapshot from the earlier audit:
- Function Calls: 21K / 1M.
- Action Compute: 0.055 / 20 GB-hours.
- Database Storage: 124.45 MB / 512 MB.
- Database Bandwidth: 3.74 GB / 1 GB.
- Database Bandwidth composition: 3.66 GB reads, 91.01 MB writes.

The largest historical offender was `shows.backfillUserShowTrackingAggregatesBatch` at 2.03 GB. That was not only a cron problem. It also fired from normal tracked show metadata refreshes when users opened tracked show detail pages.

Current mitigations already in code:
- `convex/crons.ts` no longer schedules `dailyReconcileProjections`.
- `refreshTrackedShowMetadata` no longer runs `rebuildUserShowTrackingAggregatesForUser` for the normal user-triggered metadata refresh path.
- Metadata refresh still runs `runRefreshProjectionsForShow`, which updates `feedProjections` for users tracking that show without scanning each user's whole watched history.
- `dailyReconcileProjections`, `rebuildUserShowTrackingAggregatesForUser`, and `backfillUserShowTrackingAggregatesBatch` still exist as manual repair/migration tools.

Recent CLI log sample after the normal backfill trigger was removed:
- Sample range: 2026-05-10T04:06:33Z through 2026-05-11T00:43:19Z.
- `shows.backfillUserShowTrackingAggregatesBatch`: 42 calls before the cutoff, about 104.68 MB reads and 4.22 MB writes in the sample.
- Last sampled backfill call: 2026-05-10T20:17:21Z.
- After 2026-05-10T21:30:00Z: zero sampled `backfill`, `rebuildUserShowTrackingAggregates`, or `dailyReconcile` executions.
- After the cutoff, the largest sampled read consumers were `schedule.getFutureUpcomingCountsForWatchlist`, `schedule.getUpcomingSchedule`, `shows.getHomeFeed`, and `shows.getAnimeRelationSyncCandidates`.

Latest sampled post-cutoff ranking:
- `schedule.getFutureUpcomingCountsForWatchlist`: biggest normal-app read, about 679 KB per uncached call.
- `schedule.getUpcomingSchedule`: about 636 KB per uncached call, but gated to the Schedule tab.
- `shows.getHomeFeed`: about 336 KB per uncached call on a high-frequency Home surface.
- `shows.getAnimeRelationSyncCandidates`: about 717 KB per uncached call, but low call count in sampled logs.

Historical but not visible in the latest sampled logs:
- `stats.getUserStats`: 174.42 MB in the May dashboard audit. It remains architecture debt because stats are computed at read time, but it is not currently the top active burn unless Profile traffic increases.

## Cost Reality

Convex pricing from the public pricing page lists database I/O at about $0.22 per GB after the included Free/Starter allowance. The May dashboard showed 3.74 GB of database bandwidth. Even if all 3.74 GB were billable, that is under $1 of database I/O. If only usage above the included 1 GB were billable, the variable database I/O cost would be roughly 2.74 GB * $0.22, or about $0.60.

This means the immediate issue was Free-tier disablement, not a large paid bill. With broad backfill disabled, the app should be comfortably under a rough $5/month variable database I/O target at current traffic. A $5 database I/O budget corresponds to roughly 23 GB/month of billable database I/O at $0.22/GB.

Do not optimize solely to stay on Free. Prioritize fixes that prevent accidental runaway usage, improve user-visible correctness, or reduce repeated high-traffic reads.

Usage budget interpretation:
- Safe: dashboard database bandwidth stays under about 5 GB/month after backfill removal.
- Watch: dashboard database bandwidth trends toward 10 GB/month or one query dominates normal use.
- Act: dashboard database bandwidth trends toward 20 GB/month, a query grows faster than active users, or any backfill function starts increasing without manual repair work.

## Current Big Problems

The three active Convex cost problems to watch first are:
- `schedule.getFutureUpcomingCountsForWatchlist`.
- `schedule.getUpcomingSchedule`.
- `shows.getHomeFeed`.

The following are not top-three current cost drivers but should remain on the plan:
- `stats.getUserStats`, because it was historically meaningful and is computed at read time.
- `shows.getAnimeRelationSyncCandidates`, because it is visible in logs and should be throttled before traffic grows.
- Broad tracking backfill, because it is mitigated now but dangerous if reintroduced.

## Issue 1: Broad Tracking Backfill Was Triggered By Normal App Usage

Status: mitigated, keep monitoring.

Historical offender:
- `shows.backfillUserShowTrackingAggregatesBatch`: 2.03 GB in the May dashboard audit.

Confirmed expensive paths:
- Scheduled cron path: `dailyReconcileProjections` ran as a daily repair/rebuild job.
- Normal app path: opening tracked show detail called `refreshTrackedShowMetadata`, which previously called `rebuildUserShowTrackingAggregatesForUser` for the current user.
- Internal repair path: `repairShowMetadataById` still calls the broad aggregate rebuild when used manually.

Why it was expensive:
- It scanned each tracked `userShows` row for a user.
- It read the matching `shows` document for each row.
- It collected all `watchedEpisodes` for each user/show pair.
- It recomputed watched counts, total watch events, runtime, last watched timestamp, and derived status.
- It patched `userShows` and upserted `feedProjections`.
- Under `dailyReconcileProjections`, it also deleted and recreated feed projections for each user.

Current decision:
- Do not run broad aggregate rebuilds from routine app behavior.
- Do not schedule `dailyReconcileProjections` in production.
- Keep broad repair functions internal and manual only.
- Prefer targeted repair by user/show when data drift is suspected.

Residual risks:
- Existing aggregate drift will not self-heal just because a user opens a show detail page.
- Manual broad repair can still burn bandwidth if invoked without limits.
- `dailyReconcileProjections` still deletes and recreates projections, so it should not be used as the default repair mechanism.

Follow-up plan:
- Add a targeted repair action for one user/show.
- Add a user-level repair action that can batch safely from Profile when explicitly requested.
- Add dry-run/count output before any broad repair.
- Add guardrails such as page limits, mutation batch limits, return summaries, and maybe admin-only/internal-only wrappers for broad repairs.

Related plan:
- `docs/TARGETED_TRACKING_REPAIR_PLAN.md`.

## Issue 2: Future Upcoming Counts Are The Biggest Normal Watchlist Read

Status: active problem and first future optimization if usage increases.

Current offender:
- `schedule.getFutureUpcomingCountsForWatchlist` is now the largest recurring normal read in recent logs.
- Recent sampled calls read about 694 KB each when uncached.

App usage:
- Called from Home -> Watchlist in `app/(tabs)/home/index.tsx`.
- Runs when `activeTab === "watchlist"`.
- Uses a 365-day lookahead from `WATCHLIST_FUTURE_LOOKAHEAD_DAYS`.
- Feeds `futureUpcomingCountByRoute`.
- The UI hides watchlist items when all remaining episodes are future scheduled episodes.

Backend behavior:
- Reads all TV/anime `feedProjections` for the user.
- Reads `scheduleCache` rows across the requested future date range.
- Parses schedule JSON strings.
- Matches schedule entries to tracked shows by external ids or normalized title.
- Counts future episodes per route id.

Why it is expensive:
- `scheduleCache` contains global TV/anime schedule data, not only tracked shows.
- A 365-day range can read many large schedule cache rows to produce a small per-user count map.
- The query is reactive and lives on a high-traffic surface.
- It can rerun with Home watchlist subscriptions even though the underlying future schedule usually changes slowly.

Open product tradeoff:
- The feature prevents false "episodes left" prompts when the only remaining episodes are future airings.
- Removing it outright would reduce bandwidth but could make the watchlist feel wrong for currently airing titles.

Fix directions to evaluate:
- Start with the smallest safe change: reduce the 365-day lookahead to something like 60-90 days.
- Run it only for items where future-only filtering can actually change visibility.
- Prefer provider-backed released episode counts where available and skip broad schedule scanning for those items.
- Defer the query so initial Watchlist render is not blocked by it.
- Precompute compact per-user future count projections when schedule cache is hydrated only if simpler reductions are not enough.
- Store per-user/per-route future counts or next-airing metadata only if dashboard trends justify the added complexity.

When to implement:
- Implement if this query remains the top dashboard consumer after backfill has been quiet for several days.
- Implement if Home Watchlist traffic increases and database bandwidth trends toward the Watch or Act thresholds in Cost Reality.
- Do not build a large projection system before trying a narrower lookahead and better gating.

Success criteria:
- Monthly database bandwidth from this query drops materially, target at least 70%.
- Watchlist still hides titles where all remaining episodes are future airings.
- Initial Watchlist render does not depend on scanning a 365-day schedule range.

## Issue 3: Upcoming Schedule Reads Broad Schedule Cache Rows

Status: active problem, secondary to Watchlist future counts, optimize only if Schedule tab usage grows.

Current offender:
- `schedule.getUpcomingSchedule` read about 8.07 MB across 13 sampled calls after the backfill cutoff window.

App usage:
- Called from Home -> Schedule tab.
- Reads a week-ish range on compact layouts and a wider month grid range on wide web layouts.
- Hydration is user-triggered from Home via `hydrateScheduleRange`.

Backend behavior:
- Reads the user's TV/anime `feedProjections`.
- Reads `scheduleCache` rows for the selected date range.
- Parses global cached JSON schedule entries.
- Filters the global rows down to tracked shows.

Why it is expensive:
- It reads global schedule payloads even when the user tracks only a small subset.
- Month layout can request a wider date range.
- Schedule hydration writes compacted global schedule buckets, but the read path still scans those global buckets.

Fix directions to evaluate:
- Keep the query gated to the Schedule tab.
- Consider a narrower default range on wide layouts if usage stays high.
- Precompute tracked-show schedule projections per user or per tracked external id.
- Split schedule cache into smaller per-show/per-date documents only if the global row model remains too expensive.

When to implement:
- Implement if Schedule tab usage becomes common and this query becomes a top dashboard consumer.
- Do not optimize aggressively while it is mostly gated behind explicit Schedule tab visits.
- Prefer range and layout changes before changing the storage model.

Success criteria:
- Schedule tab remains correct for TV and anime.
- Date navigation still works without repeatedly reading a large global range.
- Query read bytes per uncached call are reduced significantly.

## Issue 4: Home Feed Still Reads Many Projection Rows

Status: active problem, lower priority than schedule counts, likely fine at current traffic.

Current offender:
- `shows.getHomeFeed` read about 344 KB per uncached call in recent logs.

Backend behavior:
- Reads TV `feedProjections` for the user.
- Reads anime `feedProjections` for the user.
- Reads paused `userShows` for the user.
- Reads anime home settings.
- Reads up to 200 anime franchise settings.
- Sorts, groups, and filters in memory.

Why it is still notable:
- `feedProjections` removed N+1 show reads, but the query still collects broad TV/anime projection sets.
- It is on the Home surface and can rerun reactively.
- Large libraries make each Home read heavier.

Fix directions to evaluate:
- Add narrower projection indexes for active Home sections.
- Store section-ready home projection rows or computed section buckets.
- Avoid reading paused rows separately if the projection table can carry the needed pause metadata.
- Consider pagination or top-N server-side limits per section.

When to implement:
- Implement if Home Feed grows faster than active users or becomes a top dashboard consumer after schedule fixes.
- Leave it alone while database bandwidth remains comfortably under the paid budget target.
- Prefer projection/index improvements over client-side workarounds.

Success criteria:
- Home loads the same visible sections with fewer document reads.
- Large libraries do not cause Home to collect every TV/anime projection on each uncached read.

## Issue 5: Profile Stats Are Computed At Read Time

Status: architecture debt and historical cost driver, not an immediate fire unless Profile usage increases.

Historical offender:
- `stats.getUserStats`: 174.42 MB in the May dashboard audit.

App usage:
- Called from Profile in `app/(tabs)/profile.tsx`.
- Deferred behind `shouldLoadHeavySections`, but still broad when loaded.

Current backend behavior:
- Reads all `userShows` for the user.
- Reads every referenced `shows` document.
- Loops through all tracked shows to calculate media breakdowns, watch time, completed count, and rewatch totals.
- Reads up to 10,000 `watchedEpisodes` rows ordered by `watchedAt` for streaks.
- Reads profile and social rows.

Why it is expensive:
- Stats are derived at read time instead of write time.
- The expensive data changes mostly when watch state changes, not when Profile is viewed.
- Streak calculation does a broad watched episode sample.

Better model:
- Add a `userStats` table keyed by `userId`.
- Store denormalized counters and timestamps such as `tvEpisodes`, `animeEpisodes`, `movieCount`, `totalEpisodesWatched`, `totalRewatches`, `totalWatchTimeMinutes`, media-specific watch time, `completedShows`, `currentStreak`, `longestStreak`, and `lastWatchDate`.
- Update simple counters when watch state changes.
- For destructive or complex paths, run a focused user stats rebuild.

Mutation paths to integrate:
- `toggleEpisodeWatched`.
- `batchMarkEpisodesWatched`.
- `batchRewatchEpisodes`.
- `markSeasonWatched`.
- `unmarkSeasonWatched`.
- `clearShowWatched`.
- `clearRelatedAnimeWatched`.
- `toggleMovieWatched`.
- Import/reset paths.

Success criteria:
- Profile stats query becomes a one-row stats read plus profile/social reads.
- No broad `watchedEpisodes.take(10000)` scan during normal Profile load.
- Monthly database bandwidth from `stats.getUserStats` drops by at least 80%.

When to implement:
- Implement if Profile usage increases or `stats.getUserStats` reappears near the top of the dashboard.
- Implement as a staged materialization, not a rushed rewrite of every watch mutation.
- Start with cached/materialized stats plus focused rebuild for one user, then move simple counters to write-time updates.

## Issue 6: Anime Relation Sync Candidate Reads

Status: monitor and optimize if it remains high after schedule work.

Current offender:
- `shows.getAnimeRelationSyncCandidates` appeared in both the dashboard audit and recent logs.

Why it matters:
- It runs as a background anime relation sync helper from Home.
- Recent sampled usage was lower than schedule counts but still visible.
- It can be wasteful if called often and most franchises are already synced or recently checked.

Fix directions to evaluate:
- Ensure background relation sync has a meaningful freshness window.
- Read only candidates that have missing or stale relation sync metadata.
- Avoid repeated candidate scans on every Home mount.
- Store a per-user sync checkpoint or last scan timestamp.

When to implement:
- Implement lightweight throttling/checkpointing before traffic grows.
- Deeper optimization is only needed if it remains visible after schedule and Home fixes.

Success criteria:
- Background relation sync does not repeatedly scan unchanged libraries.
- Anime relation sync still discovers next seasons/relations when needed.

## Issue 7: Completed Shows With New Episodes Do Not Auto-Resume

Status: product/data correctness gap, not primarily a bandwidth problem.

Confirmed current behavior:
- `shouldResumeForNewContent` exists in `convex/shows.ts` but has no call site.
- `refreshTrackedShowMetadata` updates show metadata and refreshes projections, but no longer runs broad aggregate repair for normal app usage.
- Home Watchlist filters out `completed` entries.
- If provider metadata later increases `totalEpisodes`, a completed show can have new `remainingEpisodes` in projections but still remain hidden because status is still `completed`.

Why it matters to usage planning:
- The old broad backfill sometimes could incidentally recompute status, but relying on broad repair for this is too expensive.
- The correct fix should be targeted and event-like: when metadata refresh detects new released episodes for a completed tracked show, update only affected user-show rows.

Related plan:
- `docs/COMPLETED_SHOW_NEW_EPISODES_PLAN.md`.

## Priority Order

1. Keep backfill mitigations in place and monitor dashboard usage after the cutoff.
2. If usage rises, first optimize or defer `schedule.getFutureUpcomingCountsForWatchlist` with a narrower lookahead and better gating.
3. Add targeted tracking repair actions so manual fixes do not require broad backfill.
4. Plan and implement completed-show auto-resume for new released episodes as a correctness fix, not a cost fix.
5. Denormalize or materialize `stats.getUserStats` only when Profile usage makes it relevant again.
6. Continue with `schedule.getUpcomingSchedule`, `shows.getHomeFeed`, anime relation sync candidates, `shows.getTrackedIds`, and `shows.getLibrary` only if dashboard usage warrants it.

## Dashboard Follow-Up

CLI logs can show per-execution usage and recent function activity, but the dashboard remains the source of truth for monthly GB totals and budget impact.

Use the dashboard after enough post-mitigation traffic has accumulated to confirm:
- `shows.backfillUserShowTrackingAggregatesBatch` stops increasing except for manual repair work.
- `schedule.getFutureUpcomingCountsForWatchlist` becomes the dominant normal-app bandwidth consumer.
- `stats.getUserStats` and `shows.getHomeFeed` stay within acceptable budget until their planned optimizations are implemented.
- Database bandwidth trend is compatible with the configured Convex budget.

Dashboard review cadence:
- Check again after several days of normal usage on the paid plan.
- Check after any PR touching Home, Schedule, Profile stats, metadata refresh, relation sync, or repair/backfill paths.
- Check immediately if Convex budget alerts fire or database bandwidth slope changes sharply.
