# ADR-0014: Narrow Projection Repair Trigger

## Context

After PR 71 moved stale Home count repair into the external schedule-confidence job, the May 20, 2026 production run emitted `projectionRepair` deltas for rows that were not small one-episode drift cases. The broad deltas used provider metadata as if it were always safe watchable progress.

The visible regressions were inflated Home progress/remaining counts for long-running or multi-season rows, including One Piece, Naruto, Naruto Shippuden, Hunter x Hunter, Hell's Paradise, and Fleabag. Two completed rows, Naruto Shippuden and Hunter x Hunter, were also resumed to `watching` because the inflated released count made Convex believe new unwatched episodes existed.

## Current Behavior

Before this ADR, `buildProjectionRepairFromFact` could fall back from provider metadata to the general release fact and it accepted large jumps. The Convex apply path treated `projectionRepair` as permission to visit all tracking rows for that show, patch the `shows` released/total counts from the delta, rebuild `feedProjections`, and resume completed rows when the inflated released count exceeded watched progress.

This was too broad for:

- completed rows already fully watched;
- paused rows that should not get a new released backlog signal from this repair;
- planned/not-started rows with zero imported watchable progress;
- long-running shows where provider season/episode numbering can disagree with the user's imported watchable count by hundreds of episodes.

## Decision

Keep the server-owned count repair, but restrict `projectionRepair` to small, metadata-backed watchable-count drift only.

The repair trigger now requires:

- status is `watching` or `completed`;
- imported watchable count is positive;
- provider metadata released count is present;
- provider metadata released count is ahead of imported watchable count by at most three episodes;
- schedule-derived release facts alone do not trigger `projectionRepair`.

The applied repair total is `max(importedTotalEpisodes, providerReleasedEpisodes)`. Provider catalogue total remains diagnostic for this repair path and cannot make Home jump to a future season or unrelated provider total.

## Reasoning

The motivating bug was a small "today's episode is missing from Home until detail is opened" drift. A small bounded delta is enough to repair that case for Euphoria, The Boys, The Beginning After the End, Dorohedoro, Classroom of the Elite, Family Guy, and similar current shows.

Large jumps are a different problem. They may indicate provider numbering mismatch, season-local numbering, merged anime/TV identities, future schedule totals, or a stale imported total. Treating those as automatic watchable progress can create false backlog, incorrectly resume completed shows, and make Home less trustworthy.

This approach keeps Convex minimal: Convex still receives compact deltas and never fetches providers in this path. The expensive provider interpretation remains on the server, but the server only grants Convex repair permission for the narrow case that matches the original product bug.

## Provider/Data Assumptions

TMDB, TVMaze, and AniList metadata can be used to confirm small current-release drift when the show already has trusted provider IDs. Title fallback remains blocked from Convex apply.

Provider metadata is not trusted for large watchable-count jumps. Large differences must be investigated or repaired intentionally, not folded into the nightly projection repair.

When provider totals disagree with imported progress, released count is the only repair gate. Provider catalogue total is not used to expand Home progress unless the released count also passes the small-drift guard.

## Edge Cases

Completed shows with a genuine one-episode release can still re-enter attention through the bounded repair. Completed shows with hundreds of apparent new episodes are blocked.

Paused and dropped rows are not projection-repair candidates. Planned/not-started rows with zero watchable progress are not projection-repair candidates.

Long-running shows, anime season aliases, same-day duplicate episodes, future weekly rows, and stale provider totals continue through existing provider matching and schedule-cache logic, but large count disagreement is not applied as Home backlog.

## Verification

Verification commands:

- `npm run schedule-confidence:validate`
- `node --check scripts/schedule-confidence.mjs`
- `npx tsc --noEmit --pretty false`
- `npx expo lint`
- `git diff --check`

The fixture validation now covers:

- metadata-backed one-episode drift emits a repair;
- schedule fact fallback alone does not emit a repair;
- large jumps do not emit a repair;
- paused rows do not emit a repair;
- planned rows with zero watchable progress do not emit a repair.

Production data correction should use the May 20 server SQLite audit trail and only target rows whose previous applied `projectionRepair.providerReleasedEpisodes - importedWatchableEpisodes` exceeded three episodes. The known affected rows are One Piece, Naruto, Naruto Shippuden, Hunter x Hunter, Hell's Paradise, and Fleabag. Family Guy and Hot Ones are one-episode drift rows and should not be rolled back by this correction.

## Rollback Notes

If today's episode stops appearing on Home after the nightly server job, inspect whether the provider metadata released count is present and within the three-episode window before widening the trigger.

If large false backlogs return, revert any change that relaxes `maxProjectionRepairEpisodeDelta`, restores fact fallback, or allows paused/planned rows into `projectionRepair`.

If production data was already inflated by the May 20 run, roll forward with a targeted correction delta and targeted tracking repair for completed rows rather than restoring broad Convex aggregate repair or asking users to open detail pages.
