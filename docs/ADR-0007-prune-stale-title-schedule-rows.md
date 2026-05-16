# ADR-0007: Prune Stale Same-Title Schedule Rows After Provider Date Moves

## Context

After ADR-0006 cleared Detective Conan's stale Home release signal, the production schedule still showed episode 1202 on May 16, 2026. That stale schedule-cache row was enough for Home's same-day schedule attention to re-surface the show, even though the trusted release fact said episode 1202 moved to May 30, 2026.

The remaining issue is schedule-cache identity. Some schedule rows come from provider-specific schedule sources such as TVMaze, while the tracked show can be keyed by TMDB. If a row does not share a durable provider ID with the reconciled show, the ADR-0005 prune path can leave it in place even when title and episode number clearly identify the moved episode.

## Current Behavior

`convex/scheduleConfidence.ts` prunes moved schedule rows only when the cached row's `showId` matches a durable provider route ID from the trusted release fact. That avoids broad title fallback deletion, but it misses stale same-title rows from another schedule source.

For Detective Conan, the trusted fact is TMDB-backed and says:

- Episode 1201 aired on May 9, 2026.
- Episode 1202 is upcoming on May 30, 2026.

The stale May 16 row still matched the user's tracked show through schedule title matching, so Schedule and Home continued to show the episode.

## Decision

When a direct or bridged provider fact supplies desired episode dates, schedule-cache pruning now removes entries within the bounded move window if either:

- the cached row has a durable provider route ID for the reconciled show, or
- the cached row has the exact same normalized title and the same episode number or episode name, but sits on a date not present in the trusted fact.

The change also treats legacy TMDB cache IDs like `tmdb:30983` as durable aliases of `tmdb:tv:30983` for pruning.

Exact-title pruning checks both TV and anime schedule buckets because Schedule intentionally bridges tracked TV/anime aliases by title. It also removes exact-title future rows whose episode number is above the trusted `totalEpisodes`, which catches stale provider sequences such as episode 1203/1204 rows after a break-week correction says the next valid episode is 1202.

For already-clean release facts, the server exporter can emit a one-time `scheduleCacheMaintenance` delta for caught-up shows with a trusted future episode. Convex applies that delta only to the schedule-cache path unless show metadata changed or a stale Home signal also needs clearing.

## Reasoning

This is narrower than general title fallback. It does not delete arbitrary same-title rows; it requires the same media bucket, exact normalized title, and the same episode identity. That directly targets break-week stale rows while keeping low-confidence provider matching blocked for show/projection mutation.

Keeping the cleanup in the server-owned schedule-confidence path preserves the cost decision from ADR-0005 and ADR-0006. Convex only mutates rows when the nightly server sends compact provider-backed deltas.

The one-time maintenance checksum prevents the same unchanged fact from being resent every nightly run. If the trusted future date changes again, or the schedule maintenance version is bumped after a pruning algorithm fix, the checksum changes and the server emits a new compact delta.

The server ops script applies deltas with batch size `1` because a single schedule-maintenance delta can scan and patch many schedule-cache buckets. Smaller mutation batches avoid Convex function timeouts while keeping the heavy provider reconciliation work on the external server.

Applied schedule-maintenance delta markers are retained in the local SQLite store so the same unchanged fact is not resent on every nightly run.

Reconciliation summaries count only unapplied deltas; retained applied markers are local bookkeeping, not pending Convex work.

## Provider/Data Assumptions

Direct provider IDs and bridged IDs remain the authority for release facts. Title-only facts are still audited and skipped by Convex apply.

Exact same-title schedule pruning is allowed only after a trusted release fact exists for the tracked show and only for the same episode number or same normalized episode name. It is not used to create show identity, patch show metadata, resume completed shows, or mutate watch progress.

## Edge Cases

Completed shows with real new releases still re-enter Home when `watchedEpisodesCount < releasedEpisodes`.

Paused, dropped, planned, and not-started shows are unaffected except that their stale schedule-cache rows may be removed if the trusted episode date moved.

Long-running shows benefit from this because episode numbers are high and provider date moves are common. The pruning window remains bounded to avoid broad cache churn.

Anime season aliases keep the existing anime title variant behavior; this ADR only adds exact normalized title pruning in the schedule-confidence cleanup path.

Same-day duplicate episodes are preserved unless they have the same title and same episode identity on a date the trusted provider fact no longer allows.

Future weekly rows remain preserved on the trusted future date, such as Detective Conan episode 1202 on May 30, 2026.

## Verification

Added synthetic coverage for stale cross-provider schedule rows: `SC Synthetic Stale Future Signal Clear` seeds stale anime-bucket rows for episode 1202 on May 16 and over-total episode 1203 on May 23 while the trusted provider fact schedules episode 1202 for May 30. The dev workflow assertion verifies the stale rows are removed and May 30 remains.

Planned production check: run the server schedule-confidence job from this change and verify Detective Conan no longer appears on the May 16 schedule while remaining scheduled for May 30.

## Rollback Notes

Rollback `convex/scheduleConfidence.ts` if unrelated same-title schedule rows disappear. Watch Schedule selected-day rows, Home same-day attention, and long-running TV/anime shows with cross-provider schedule sources. If rollback is needed, stale rows can be manually repaired by schedule-cache refresh until a narrower alias map is introduced.
