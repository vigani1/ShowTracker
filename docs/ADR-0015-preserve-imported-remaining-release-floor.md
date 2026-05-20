# ADR-0015: Preserve Imported Remaining Release Floor

## Context

After ADR-0014 narrowed `projectionRepair`, the May 20, 2026 verification run no longer emitted broad repair deltas. That part worked. A second issue appeared in the normal release-fact path: for a show whose latest release aired before the user's `lastWatchedAt`, the server could cap `releasedEpisodes` down to `watchedEpisodesCount`.

That cap was meant to avoid stale attention when a user had already watched the latest known release. It is not safe when the imported `feedProjections` row already says there is remaining watchable progress. Family Guy was the concrete example: Convex had `456 watched / 457 total / 1 remaining`, but the server run emitted a normal fact with `releasedEpisodes = 456`, which rebuilt the projection back to `0 remaining`.

## Current Behavior

Before this change:

- The external server imported `watchedEpisodesCount`, `totalEpisodes`, `remainingEpisodes`, and schedule signals from `feedProjections`.
- `buildReleaseFact` used provider events plus timestamps to calculate released counts.
- If the latest provider event aired before `lastWatchedAt` and the provider count was at most one ahead of watched count, the server capped `releasedEpisodes` to watched count.
- That cap ignored imported `remainingEpisodes`, so it could erase a one-episode Home backlog that Convex already knew about.

## Decision

When imported `remainingEpisodes` is positive and provider evidence supports at least `watchedEpisodesCount + remainingEpisodes`, the release fact must not cap below that imported watchable count.

The timestamp-only cap still applies when imported remaining progress is missing or zero. This keeps the stale-signal guard for rows that do not already have a concrete watchable backlog.

## Reasoning

`lastWatchedAt` is not episode-specific. A user can watch an older episode after the latest release aired, leaving the latest release unwatched. Using that timestamp alone to infer "latest release is watched" is too coarse for Home progress.

`remainingEpisodes` in the imported projection is a stronger user-specific signal. It is already the compact state Convex uses to render Home. Preserving it keeps the server from making a destructive downgrade while still allowing provider data to repair missing or newly released episodes.

This is narrower than removing timestamp capping entirely. Rows with no imported remaining progress keep the old cap, so stale signals are still cleared conservatively.

## Provider/Data Assumptions

Provider event counts can only preserve imported remaining progress when the raw provider-derived released count is at least the imported watchable count. Future-only rows should not be turned into current backlog by imported totals alone.

Title fallback remains blocked from Convex apply. This change only affects direct or otherwise accepted release facts after provider matching has already succeeded.

## Edge Cases

Completed shows with no remaining progress still cap normally and should not resume from timestamp-only ambiguity.

Paused and dropped rows can preserve their displayed remaining denominator if Convex already has one, but this does not promote them out of their section.

Long-running shows and anime season aliases still depend on the bounded `projectionRepair` rule from ADR-0014 for upward repair. This ADR only prevents a normal release fact from lowering a known imported remaining count.

Same-day duplicate episodes and future weekly rows keep existing schedule dedupe behavior. Future rows do not become watchable unless provider-derived released count supports the imported watchable floor.

## Verification

Verification commands:

- `npm run schedule-confidence:validate`
- `node --check scripts/schedule-confidence.mjs`
- `npx tsc --noEmit --pretty false`
- `npx expo lint`
- `git diff --check`

Fixture validation now includes a post-air `lastWatchedAt` case where `456 watched + 1 remaining` must produce `releasedEpisodes = 457`, plus a matching zero-remaining case that still caps to `456`.

Production verification should check Family Guy after the VPS run: it should remain `456 watched / 457 total / 1 remaining`, and the exported deltas should still contain no `projectionRepair` records.

## Rollback Notes

If stale Home backlogs start sticking around after this change, inspect rows where imported `remainingEpisodes > 0` but provider raw released count also supports that imported watchable count. Reverting this ADR restores timestamp-only capping, but can reintroduce false `0 left` regressions for shows like Family Guy.
