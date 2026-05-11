# Completed Show New Episodes Plan

Last updated: 2026-05-11

## Problem

Completed TV/anime entries may stay hidden from Home after new episodes are added by a provider.

Current confirmed behavior:
- `shouldResumeForNewContent` exists in `convex/shows.ts`, but no call site uses it.
- `refreshTrackedShowMetadata` refreshes provider metadata and then runs `runRefreshProjectionsForShow`.
- `runRefreshProjectionsForShow` updates projection fields such as `totalEpisodes` and `remainingEpisodes` for users tracking that show.
- It does not change `userShows.status` from `completed` back to `watching` or another active status.
- Home Watchlist filters out `completed` entries, so a completed show with newly available remaining episodes can stay hidden.

This should not be solved by re-enabling broad aggregate backfills. The fix should target only users tracking the updated show.

## Desired Behavior

When refreshed metadata shows that a completed tracked show now has newly released episodes:
- Affected completed `userShows` rows should move back to an active status.
- `completedAt` should be cleared.
- `statusChangedAt` should be updated.
- The feed projection should be refreshed so Home can show the title again.

Open product decision:
- Resume to `watching` when the user has previous progress and new released episodes exist.
- Consider `plan_to_watch` only for edge cases where the user has zero watched progress, though completed with zero progress should be rare.
- Do not resume if new episodes are only future scheduled episodes and not released yet.

## Detection Strategy

Use metadata refresh as the event source:
- Before patching a show, read the old `totalEpisodes`, `status`, and provider ids.
- Fetch latest normalized metadata.
- Determine whether released episode count increased, not just planned total episode count.
- For TMDB TV, prefer released episode count derived from `last_episode_to_air` and season data.
- For anime, be careful with provider totals that include announced but unreleased episodes.

Candidate rule:
- Old tracked show status is `completed`.
- `watchedEpisodesCount` is less than the refreshed released episode count.
- Refreshed show lifecycle is not terminal in a way that means no new content exists.
- The new episode is released or treated as released by provider metadata.

## Implementation Sketch

Backend:
- Add an internal mutation that accepts `showId`, old metadata, and refreshed metadata.
- Query `userShows` by `by_showId`.
- Filter to completed rows where `watchedEpisodesCount < releasedEpisodeCount`.
- Patch only those rows to `watching`, clear `completedAt`, clear `autoPausedAt`, and set `statusChangedAt`.
- Upsert feed projections for patched rows.
- Return counts for scanned, resumed, skipped future-only, and skipped unchanged.

Metadata refresh:
- Call the new internal mutation from `refreshShowMetadataAndRepairTracking` after `upsertShowByInternalId`.
- Keep this path targeted to the refreshed show only.
- Do not call `rebuildUserShowTrackingAggregatesForUser` from normal metadata refresh.

Manual repair:
- Add a repair mode for one show that can recompute this condition for all users tracking that show.
- Keep a user/show targeted repair for one user's one show as part of the tracking repair plan.

## Tests And QA

Backend checks:
- Completed show with watched count equal to old released count and refreshed released count greater than watched count resumes to `watching`.
- Completed show with only future/unreleased episodes does not resume.
- Completed show with no increase does not patch.
- Paused, dropped, and plan-to-watch rows are not changed by this path.
- Projection row is updated after status change.

Product QA:
- Mark a show completed.
- Simulate/provider-refresh a higher released episode count.
- Confirm Home Watchlist shows it again with remaining episodes.
- Confirm Library still shows correct status and counts.

## Success Criteria

- New released episodes bring completed shows back into an actionable state without broad backfill.
- No recurring full-user aggregate repair is needed for this behavior.
- The fix adds negligible database bandwidth compared with the removed backfill path.
