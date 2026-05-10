# Convex Usage Audit Plan

Last updated: 2026-05-10

## Dashboard Findings

Convex dashboard range: May 01, 2026 - May 31, 2026.

Team/project state:
- Projects are disabled because the team exceeded Free plan limits.
- The exceeded resource is database bandwidth.
- Function calls, action compute, database storage, file storage, file bandwidth, vector storage, and vector bandwidth are not the current bottleneck.

Resource usage:
- Function Calls: 21K / 1M.
- Action Compute: 0.055 / 20 GB-hours.
- Database Storage: 124.45 MB / 512 MB.
- Database Bandwidth: 3.74 GB / 1 GB.
- File Storage: 0 B / 1 GB.
- File Bandwidth: 0 B / 1 GB.
- Vector Storage: 0 B / 512 MB.
- Vector Bandwidth: 0 B / 512 MB.

Database bandwidth composition:
- Reads: 3.66 GB, 97.6%.
- Writes: 91.01 MB, 2.4%.

Top database bandwidth consumers:
1. `shows.backfillUserShowTrackingAggregatesBatch` prod: 2.03 GB.
2. `schedule.getFutureUpcomingCountsForWatchlist` prod: 681.73 MB.
3. `shows.getHomeFeed` prod: 287.95 MB.
4. `stats.getUserStats` prod: 174.42 MB.
5. `shows.getAnimeRelationSyncCandidates` prod: 87.2 MB.
6. `schedule.getUpcomingSchedule` prod: 68.89 MB.
7. `shows.getTrackedIds` prod: 47.72 MB.
8. `shows.getLibrary` prod: 41.23 MB.

Daily trend:
- Biggest spike is May 1 at roughly 1.12 GB.
- Additional non-trivial usage appears May 3-7 and May 9.
- The shape matches a full aggregate/projection rebuild plus normal reactive app reads.

## Issue 1: Daily Backfill/Reconcile Is Too Expensive

Primary offender:
- `shows.backfillUserShowTrackingAggregatesBatch`: 2.03 GB this month.

Code path:
- `convex/crons.ts` scheduled `dailyReconcileProjections` every day at 03:00 UTC.
- `dailyReconcileProjections` calls:
  - `backfillUserShowsMediaType`
  - `getDistinctTrackedUserIds`
  - `rebuildUserShowTrackingAggregatesForUser`
  - `backfillUserShowTrackingAggregatesBatch`
  - `rebuildFeedProjectionsForUser`

What it does:
- Scans tracked users and tracked shows.
- For each tracked show, reads the `userShows` row.
- Reads the matching `shows` row.
- Reads all `watchedEpisodes` for that user/show.
- Recomputes watched counts, total watch events, runtime, last watched timestamp, and derived status.
- Patches `userShows`.
- Upserts `feedProjections`.
- Deletes and recreates feed projections for the user.

Why it is expensive:
- It is a full repair/rebuild flow, not an incremental runtime path.
- It repeatedly reads episode history and projection data.
- It runs even when no migration or data repair is needed.
- It alone used more than twice the free monthly database bandwidth allowance.

Decision:
- Do not run `dailyReconcileProjections` as a scheduled cron.
- Keep the function available as a manual repair/migration tool.
- Run it only after schema migrations, known data drift, imports, or targeted repair work.

Immediate mitigation:
- `dailyReconcileProjections` has been removed from the scheduled cron list in `convex/crons.ts`.

Follow-up:
- Add a cheaper targeted repair command that accepts a user id, show id, or changed date range.
- Add a dry-run/count mode before any full rebuild.
- Avoid delete/recreate projection rebuilds when row-level patching is enough.

## Issue 2: Future Upcoming Counts Are Heavy Normal App Usage

Primary offender:
- `schedule.getFutureUpcomingCountsForWatchlist`: 681.73 MB this month.

App usage:
- Called from Home -> Watchlist in `app/(tabs)/home/index.tsx`.
- Runs only when `activeTab === "watchlist"`.
- Feeds `futureUpcomingCountByRoute`.
- The UI uses it to hide watchlist items when all remaining episodes are future airings.

User-visible behavior:
- Home Watchlist should show titles the user can continue watching now.
- If a show has remaining episodes but all of them are future scheduled episodes, the card is hidden from active Watchlist.
- This prevents misleading "episodes left" badges for episodes that have not aired yet.

Backend behavior:
- Reads all TV/anime `feedProjections` for the user.
- Reads `scheduleCache` rows across the requested future date range.
- Parses schedule JSON strings.
- Matches schedule entries to tracked shows by external ids or normalized title.
- Counts future episodes per route id.

Why it is expensive:
- `scheduleCache` rows contain global TV/anime schedule data, not only tracked shows.
- It scans and parses broad date ranges to produce a small per-user count map.
- It is a realtime query, so changes can trigger re-runs.
- It runs on a high-traffic surface: Home -> Watchlist.

Fix plan:
1. Gate or defer the query so initial Watchlist render does not depend on it.
2. Reduce the date range to the minimum needed for hiding false positives.
3. Precompute per-user future counts when schedule cache is hydrated or on a lightweight background action.
4. Store compact per-user route-count projections instead of repeatedly parsing global schedule cache.
5. Consider a cheaper fallback: hide only when provider-backed released episode counts are known, and skip future-count scan otherwise.

Success criteria:
- Home Watchlist behavior stays correct for future-only remaining episodes.
- Monthly database bandwidth from this query drops by at least 70%.
- Watchlist first render does not block on this query.

## Issue 3: Profile Stats Are Computed Read-Time

Primary offender:
- `stats.getUserStats`: 174.42 MB this month.

App usage:
- Called from Profile in `app/(tabs)/profile.tsx`.
- It is deferred behind `shouldLoadHeavySections`, but still recomputes from broad source tables when loaded.

Current backend behavior:
- Reads all `userShows` for the user.
- Reads every referenced `shows` document.
- Loops through all tracked shows to calculate media breakdowns, watch time, completed count, and rewatch totals.
- Reads up to 10,000 `watchedEpisodes` rows ordered by `watchedAt`.
- Calculates current and longest streak from episode history.
- Reads profile and social rows.

Why it is expensive:
- Stats are derived at read time instead of write time.
- Streak calculation performs a broad watched episode scan.
- Every profile visit redoes work that mostly changes only when tracking changes.
- The data returned is small, but the database reads needed to compute it are large.

Better model:
- Add a `userStats` table keyed by `userId`.
- Store denormalized counters and timestamps:
  - `tvEpisodes`
  - `animeEpisodes`
  - `movieCount`
  - `totalEpisodesWatched`
  - `totalRewatches`
  - `totalWatchTimeMinutes`
  - `tvWatchTimeMinutes`
  - `animeWatchTimeMinutes`
  - `movieWatchTimeMinutes`
  - `completedShows`
  - `currentStreak`
  - `longestStreak`
  - `lastWatchDate`
  - optional top rewatched summaries
- Update stats when watch state changes.

Mutation paths to integrate:
- `toggleEpisodeWatched`
- `batchMarkEpisodesWatched`
- `batchRewatchEpisodes`
- `markSeasonWatched`
- `unmarkSeasonWatched`
- `clearShowWatched`
- `toggleMovieWatched`
- import/reset paths

Implementation approach:
1. Add `userStats` schema and query.
2. Add a manual rebuild function to initialize and repair `userStats`.
3. Update simple counters incrementally for normal mark-watch and rewatch flows.
4. For destructive paths such as unwatch, clear, import reset, and bulk repair, run a focused user stats rebuild.
5. Change `getUserStats` to read the `userStats` row and profile/social rows only.

Success criteria:
- Profile stats query becomes a one-row stats read plus profile/social reads.
- No broad `watchedEpisodes.take(10000)` scan during normal Profile load.
- Monthly database bandwidth from `stats.getUserStats` drops by at least 80%.

## Priority Order

1. Deploy the cron removal for `dailyReconcileProjections`.
2. Optimize `schedule.getFutureUpcomingCountsForWatchlist`.
3. Denormalize `stats.getUserStats` into `userStats`.
4. Continue with secondary offenders: `shows.getHomeFeed`, `shows.getTrackedIds`, `shows.getLibrary`, and recommendation seed reads.

## Expected Impact

Removing scheduled backfill/reconcile should eliminate the single largest waste source.

Approximate May 2026 dashboard impact:
- Current database bandwidth: 3.74 GB.
- Remove backfill/reconcile offender: minus 2.03 GB.
- Remaining estimated bandwidth: about 1.71 GB.

That is still above the 1 GB free tier, so backfill removal is necessary but not sufficient. The next required optimization for staying on Free is reducing future upcoming count reads, followed by profile stats denormalization.
