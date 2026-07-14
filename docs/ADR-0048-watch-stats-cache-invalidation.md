# ADR-0048: Watch Statistics Cache Invalidation

## Context

Profile statistics may be served from a materialized `userStats` document. Episode imports and
normal tracking mutations update watched rows and `userShows` aggregates, but previously left that
document intact. An import could therefore replace episode runtimes correctly while Profile kept
showing the watch-time total calculated before the import.

## Current Behavior

Tracking aggregate refreshes now delete materialized statistics for the affected user. Profile then
falls back to its live calculation instead of returning stale totals. The TV Time importer suppresses
repeated invalidation inside a mutation batch and explicitly rebuilds materialized statistics once all
client-side batches complete.

## Decision

- The central show-tracking aggregate refresh invalidates `userStats` by default.
- Batch import refreshes aggregate rows without invalidating per show, then invalidates once per
  server mutation.
- After every import batch succeeds, the authenticated client calls `stats.rebuildUserStats` once.
- Invalidation and rebuilding are scoped to the authenticated user.

## Reasoning

Materialized statistics are derived state and must never outrank newer watched-episode or aggregate
data. Central invalidation covers ordinary watch, unwatch, completion, and rewatch paths. Delaying the
full rebuild until import completion avoids recalculating a large library after every show or chunk
while still leaving a correct live fallback if an import stops partway through.

## Provider And Data Assumptions

Runtime authority remains defined by ADR-0047. This decision does not choose a runtime source; it
only ensures that changes already persisted to watched episodes and `userShows.watchedRuntimeMinutes`
are reflected by Profile statistics.

## Edge Cases

- A failed partial import leaves no stale materialized cache; live statistics reflect completed
  batches.
- Re-imported episodes that only change runtime still invalidate statistics.
- Multiple old `userStats` rows are all removed before a later rebuild creates the canonical row.
- A tracking mutation with no matching `userShows` row does not invalidate unrelated statistics.

## Verification

- Import provider-enriched watched episodes and confirm `stats.rebuildUserStats` runs after the final
  batch.
- Confirm tracking mutations compile with central cache invalidation enabled.
- Run TV Time import tests, TypeScript, lint, and a Convex production dry run.
- On production, refresh or import and confirm Profile watch time changes without signing out.

## Rollback

Remove central invalidation and the post-import rebuild call. This restores the previous cache behavior
but also restores the risk that Profile serves watch time calculated before tracking changes.
