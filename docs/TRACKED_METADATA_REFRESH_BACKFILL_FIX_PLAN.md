# Tracked Metadata Refresh Backfill Fix Plan

Last updated: 2026-05-16

## Problem

The new `ShowTrackerUS` production deployment shows abnormal database I/O from:

- `shows.backfillUserShowTrackingAggregatesBatch`: 103.53 MB.
- `shows.rebuildUserShowTrackingAggregatesForUser`: visible in compute breakdown.
- `shows.refreshTrackedShowMetadata`: visible in compute breakdown.

This points to the tracked-show metadata refresh path still triggering broad tracking aggregate rebuilds during normal app usage.

The current app automatically refreshes metadata when a user opens a tracked show detail page. That normal route should refresh show metadata and feed projections only. It should not rebuild the current user's entire tracking aggregate state.

## Why This Happens

The frontend show detail screen calls `refreshTrackedShowMetadata` after tracking state loads and the title is already in the user's watchlist:

- `app/show/[id].tsx`
- effect around `refreshTrackedShowMetadata(showLookupArgs)`

The backend action resolves the show and calls `refreshShowMetadataAndRepairTracking` with `repairUserId`:

- `convex/shows.ts`
- `refreshTrackedShowMetadata`

Inside `refreshShowMetadataAndRepairTracking`, a provided `repairUserId` causes the action to call:

- `internal.shows.rebuildUserShowTrackingAggregatesForUser`

That action paginates every `userShows` row for the current user and calls:

- `internal.shows.backfillUserShowTrackingAggregatesBatch`

The batch mutation loops through the page and, for every tracked show, reads the `userShows` document, reads the linked `shows` document, collects all matching `watchedEpisodes`, recomputes aggregates, patches `userShows`, and upserts `feedProjections`.

So the runtime shape is:

1. User opens one tracked show detail page.
2. Background metadata refresh runs if the show is not throttled.
3. The refresh action refreshes metadata for that one show.
4. The same action rebuilds tracking aggregates for the user's whole library.
5. The rebuild emits expensive `backfillUserShowTrackingAggregatesBatch` database I/O.

This is especially likely after importing a database because imported show records may have old `lastUpdated` values, so the one-hour metadata throttle may not skip the refresh.

## Desired Behavior

Normal tracked show detail navigation should:

- Optionally refresh the one show's provider metadata.
- Refresh feed projections for users tracking that show.
- Resume completed user shows only when released episode count increases.
- Avoid whole-user aggregate repair.
- Avoid scanning unrelated `userShows` and `watchedEpisodes`.

Tracking aggregate repair should be:

- Explicitly user-triggered.
- Narrow by default: one user/show.
- Bounded when user-wide: cursor/page based.
- Internal/admin-only for all-user or broad repair jobs.

## Fix Strategy

### 1. Split Metadata Refresh From Aggregate Repair

Change `refreshTrackedShowMetadata` so routine show detail refresh does not pass `repairUserId` into `refreshShowMetadataAndRepairTracking`.

Recommended backend shape:

```ts
return refreshShowMetadataAndRepairTracking(ctx, show._id, {
  skipBroadAggregateRepair: true,
});
```

The existing helper already supports `skipBroadAggregateRepair`, and the completed-show refresh path already uses it. The show-detail refresh should follow the same rule.

This preserves metadata refresh and `runRefreshProjectionsForShow`, while preventing `rebuildUserShowTrackingAggregatesForUser` from running as a side effect of page navigation.

### 2. Keep Targeted Tracking Repair Explicit

Do not delete targeted repair behavior. Keep:

- `repairTrackingForShow` for one current user/show.
- `repairMyShowsTrackingBatch` for current-user batch repair from Profile settings.

Those paths are explicit and bounded. They are the right place to repair stale counts/statuses.

Show detail should continue to expose the manual repair action, but it should be a user action, not a hidden background effect.

### 3. Rename Or Tighten Helper Semantics

The helper name `refreshShowMetadataAndRepairTracking` encourages accidental coupling. After the behavior is corrected, either:

- Rename it to `refreshShowMetadataAndProjections`, or
- Add a loud comment and stricter options shape.

Recommended option shape:

```ts
type MetadataRefreshRepairMode =
  | { repairMode: "none" }
  | { repairMode: "one_user"; userId: Id<"users"> }
  | { repairMode: "all_tracking_users"; allowBroadRepair: true };
```

The important part is to make broad repair opt-in and visually hard to call by mistake.

### 4. Guard Broad Repair Functions

Keep these internal, but add safeguards:

- `rebuildUserShowTrackingAggregatesForUser`
- `backfillUserShowTrackingAggregatesBatch`
- `dailyReconcileProjections`

Recommended guardrails:

- Require an explicit `reason` string for manual repair calls.
- Return scanned/patched/read-shape summaries.
- Add page-size limits that are hard to override.
- Add comments saying these are not for normal app paths.

Optional stronger guard:

- Add a `manualRepairToken` or admin-only wrapper before any broad repair function is reachable from a dashboard/manual run.

### 5. Fix Outdated Documentation After Code Lands

`docs/CONVEX_USAGE_AUDIT_PLAN.md` currently says `refreshTrackedShowMetadata` no longer runs `rebuildUserShowTrackingAggregatesForUser` for normal user-triggered metadata refresh. The current code contradicts that.

After the code change is implemented and verified, update that doc to say:

- The US deployment exposed that the mitigation was incomplete.
- Routine `refreshTrackedShowMetadata` now uses `skipBroadAggregateRepair: true`.
- Broad aggregate rebuild remains manual repair only.

## Implementation Steps

1. Update `refreshTrackedShowMetadata`
   - Remove the `repairUserId` option from its call into `refreshShowMetadataAndRepairTracking`.
   - Pass `skipBroadAggregateRepair: true`.
   - Keep auth lookup only if still needed for future targeted behavior; otherwise remove unused `userId`.

2. Add a focused regression test or diagnostic
   - Exercise `refreshTrackedShowMetadata` for a tracked show.
   - Assert it does not call `rebuildUserShowTrackingAggregatesForUser`.
   - If direct mocking is difficult, assert logs/dashboard traces after manual run show no `backfillUserShowTrackingAggregatesBatch`.

3. Verify manual repair still works
   - `repairTrackingForShow` should recompute one user/show.
   - `repairMyShowsTrackingBatch` should process only bounded pages.

4. Verify metadata refresh still updates projections
   - Existing `runRefreshProjectionsForShow` should still run after a successful provider metadata refresh.
   - Confirm Home/Library detail metadata still reflects refreshed totals/status/posters.

5. Monitor the US production dashboard after deploy
   - Open several tracked show detail pages.
   - Confirm no new `shows.backfillUserShowTrackingAggregatesBatch` usage appears.
   - Confirm `shows.refreshTrackedShowMetadata` may still appear, but with tiny DB I/O compared with the current spike.

## Success Criteria

- Opening a tracked show detail page never triggers `shows.backfillUserShowTrackingAggregatesBatch`.
- `shows.rebuildUserShowTrackingAggregatesForUser` does not appear after normal browsing.
- `shows.refreshTrackedShowMetadata` remains bounded to the target show plus projection refresh.
- Manual repair still fixes stale tracking counts.
- Convex database I/O for normal detail-page browsing drops materially.

## Non-Goals

- Do not optimize `schedule.getFutureUpcomingCountsForWatchlist` in this fix. That is a separate recurring I/O issue.
- Do not delete broad repair functions yet. Keep them for controlled migration/repair.
- Do not rewrite the schedule cache model as part of this change.

## Risk Notes

The tradeoff is that opening a show detail page will no longer silently fix stale watched aggregate data for the whole library. That is intentional. Silent full-library repair is the cost bug.

If aggregate drift is found, use the explicit repair actions:

- Show detail: repair one show.
- Profile settings: repair current user's shows in bounded batches.
- Internal dashboard/manual job: broad repair only with clear intent.
