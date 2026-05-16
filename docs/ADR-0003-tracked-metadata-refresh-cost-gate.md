# ADR 0003: Tracked Metadata Refresh Cost Gate

## Status

Accepted

## Context

The US production Convex usage audit showed an abnormal read-heavy path:

- `shows.backfillUserShowTrackingAggregatesBatch`: 103.53 MB across 42 calls.

The trigger was normal tracked show detail navigation. The frontend show detail screen calls `shows.refreshTrackedShowMetadata` after tracking state loads for a tracked title. Before this decision, that action called `refreshShowMetadataAndRepairTracking` with `repairUserId`. That option caused the helper to run `rebuildUserShowTrackingAggregatesForUser` for the current user.

That broad repair path paginates the user's full library. For each `userShows` row, it reads the linked `shows` row, reads matching `watchedEpisodes`, patches aggregate counts on `userShows`, and upserts `feedProjections`. Opening one tracked show detail page could therefore repair the current user's whole tracking library and rewrite projection rows unrelated to the opened show.

This is a watchlist/projection change, so it falls under the watchlist and schedule ADR rule in `AGENTS.md`.

## Current Behavior Before This Change

Before this change:

- `app/show/[id].tsx` could call `refreshTrackedShowMetadata` when a tracked detail page opened.
- `refreshTrackedShowMetadata` found the existing `shows` document by external lookup.
- It passed `repairUserId` into `refreshShowMetadataAndRepairTracking`.
- The helper refreshed provider metadata for the show, then rebuilt tracking aggregates for the current user's whole library.
- That rebuild could patch many `userShows` rows and upsert many `feedProjections` rows.
- Completed-show reactivation and show-level projection refresh also ran when the metadata refresh detected newly released episodes.

The result was operationally expensive and surprising: a detail-page metadata refresh behaved like a broad user-library maintenance job.

## Decision

`refreshTrackedShowMetadata` now separates detail-page metadata refresh from broad aggregate repair.

The action now:

- Confirms the current user actually tracks the target show with `findUserShowByUserAndShowId`.
- Returns `not_tracked` when the show exists globally but is not tracked by the current user.
- Calls `refreshShowMetadataAndRepairTracking` with `skipBroadAggregateRepair: true` instead of `repairUserId`.

The helper still:

- Fetches latest provider metadata for the existing show.
- Upserts the refreshed `shows` document.
- Resumes completed user shows when the released episode count increases.
- Runs `runRefreshProjectionsForShow` so projections for that show can reflect refreshed metadata.

The helper no longer:

- Rebuilds the current user's entire tracking aggregate library as a side effect of opening one tracked detail page.

Explicit internal maintenance paths can still run broad aggregate repair when that is the intended operation.

## Reasoning

The detail page needs fresh metadata for the opened show. It does not need to recalculate every watched aggregate for every show in the user's library.

The previous behavior was probably acting as an accidental safety net after imports or stale projection states, but it made regular navigation cost scale with total library size. It also created a confusing write surface: opening a detail page could patch unrelated watchlist rows.

The chosen approach preserves the parts tied to the opened show:

- Provider metadata refresh.
- Show-level projection refresh.
- Completed-show reactivation when released episode counts increase.

It removes the unrelated user-wide aggregate repair from the normal navigation path. If import or migration data needs a broad repair, that should be an explicit maintenance/backfill operation, not hidden inside page open.

This is safer than leaving the broad repair in place because the Convex usage spike proved the broad path is expensive in normal app usage. It is also safer than removing metadata refresh entirely because stale show metadata and new-release detection still matter for watchlist correctness.

## Provider And Data Assumptions

This decision does not change provider matching or route identity rules.

- TMDB remains the main TV/movie catalog source when a TMDB ID exists.
- AniList remains the preferred anime identity when an AniList ID exists.
- Jikan/MAL remains an anime fallback identity.
- TVMaze and IMDb remain bridge/fallback identities where existing route and schedule code already supports them.
- No title fallback behavior is added or broadened by this change.
- Existing `shows` lookup and metadata refresh helpers continue to decide which provider source can refresh a show.

The only changed assumption is operational: user-wide tracking aggregate repair is not part of the detail-page metadata refresh contract.

## Edge Cases Covered

- Completed shows with newly released episodes: still handled by `runResumeCompletedUserShowsForNewReleasedEpisodes` when the refreshed show's released episode count increases.
- Paused and dropped shows: no longer get broad unrelated aggregate recalculation just because another tracked detail page opened.
- Planned/not-started shows: still get show-level metadata/projection refresh when their own show is refreshed.
- Long-running shows: refreshed provider episode totals still update the `shows` document; the user-wide library backfill is not triggered by navigation.
- Anime season aliases and provider bridge IDs: unchanged because route/provider matching was not modified.
- Missing providers or unsupported show sources: still return the existing unsupported refresh result from the helper.
- Untracked global show record: now returns `not_tracked` before doing a metadata refresh for the current user's tracked-detail path.
- Future weekly rows and same-day schedule dedupe: not directly affected because schedule cache matching was not changed.
- Stale provider totals: still possible if providers lag; the change avoids using page navigation as a broad repair workaround.

## Verification

Commands run after the code change:

```bash
npx expo lint
npx tsc --noEmit --pretty false
```

Both passed.

Code inspection confirmed the normal `refreshTrackedShowMetadata` path now calls:

```ts
refreshShowMetadataAndRepairTracking(ctx, show._id, {
  skipBroadAggregateRepair: true,
});
```

and no longer passes:

```ts
repairUserId: userId
```

Expected production verification after deploy:

- Opening tracked show detail pages should still call `shows.refreshTrackedShowMetadata`.
- `shows.backfillUserShowTrackingAggregatesBatch` should not increase as a direct result of detail-page opens.
- Detail pages should still reflect refreshed metadata after the refresh throttle allows a provider refresh.
- Completed shows with genuinely increased released episode counts should still be eligible for reactivation.

## Consequences

- Normal detail-page opens no longer cause full-library aggregate repair.
- Convex DB I/O from `shows.backfillUserShowTrackingAggregatesBatch` should drop sharply for navigation-driven usage.
- `repairedUsers` is expected to be `0` for normal detail-page metadata refreshes.
- Import or migration aggregate inconsistencies need explicit maintenance/backfill repair instead of relying on page navigation.
- If stale watched aggregates are discovered after imports, the fix should be a targeted repair/backfill workflow, not reintroducing broad repair into `refreshTrackedShowMetadata`.

## Alternatives Considered

- Keep `repairUserId` in the detail refresh path: rejected because it makes one detail-page open scan and patch the user's whole library.
- Only throttle the refresh harder: rejected because throttling reduces frequency but leaves each uncached call expensive and surprising.
- Remove detail-page metadata refresh entirely: rejected because show metadata and released-episode updates still need a lightweight refresh path.
- Rebuild only the opened `userShows` row during detail refresh: possible future option, but not required for the immediate I/O fix because show-level projection refresh already runs.
- Skip metadata refresh without checking tracking state: rejected because the tracked-detail path should preserve the existing `not_tracked` semantics for the current user.

## Rollback Notes

If detail pages stop reflecting refreshed metadata, inspect `runRefreshProjectionsForShow` and the show metadata upsert path before restoring broad repair.

If completed shows fail to re-enter attention after new released episodes, inspect `runResumeCompletedUserShowsForNewReleasedEpisodes` and released episode count changes before restoring broad repair.

If imported libraries show stale watched aggregates, run or build an explicit maintenance repair for the affected user or import batch. Reverting to `repairUserId` inside `refreshTrackedShowMetadata` should be a last resort because it reintroduces the navigation-driven Convex I/O spike.
