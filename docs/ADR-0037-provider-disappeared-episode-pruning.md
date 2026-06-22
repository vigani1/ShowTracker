# ADR-0037: Provider Disappeared Episode Pruning

## Status

Accepted

## Context

On June 22, 2026, production Schedule still showed `Lord of Mysteries`
(`tmdb:tv:232230`) as `S02E01` on June 20, 2026. The detail page showed the
current TMDB state: one regular season, thirteen regular episodes, no next
regular episode, and no season 2.

Current provider checks showed:

- TMDB `/tv/232230` exposes only regular season 1 and a season 0 `Specials`
  summary.
- TMDB `/tv/232230/season/0` includes the June 20, June 27, and June 28 rows as
  specials.
- TMDB `/tv/232230/season/2` returns 404.
- TVMaze currently exposes no June 2026 rows for show `70766`.
- The VPS SQLite provider-event cache still had older TMDB `S02E01`, `S02E02`,
  and `S02E03` rows from before TMDB reclassified those entries.

ADR-0033 handled provider date moves for the same provider/show/season/episode.
This case is different: the old provider episode identity disappeared from the
regular-season source rather than moving to another date.

## Current Behavior

The schedule-confidence reconciler fetches provider data and upserts current
events, but only removes old provider rows when a fresh row for the same
provider, show, season, and episode has a different event ID.

When a provider removes a future or recent row entirely, the old row can remain
in SQLite. Release facts and schedule projections can then continue to treat it
as real. Convex `scheduleCache` can also retain the stale row unless a later
schedule-cache maintenance delta has a current fact for the same episode/date
shape.

The detail page can therefore be correct while Schedule contradicts it.

## Decision

Fresh provider fetches now prune stale provider-event rows within the active
schedule window when the provider response is complete enough to prove the row
is no longer valid.

For TMDB TV routes, the reconciler uses current regular-season summaries as the
trusted season bounds. Cached TMDB rows are stale when their season no longer
exists in the current positive-season summaries, or their episode number exceeds
the current episode count for that season, unless the row is part of the fresh
event set.

For TVMaze, the normal show episodes endpoint is treated as a complete regular
episode set for that TVMaze show. Cached TVMaze rows in the active schedule
window that are absent from the fresh endpoint response are stale.

AniList's current reconciler path only fetches the next airing episode, so it is
not used for broad disappeared-row pruning.

When stale provider rows are pruned from SQLite, the release delta carries the
removed season/episode identities into Convex. The authenticated apply step then
removes matching entries from `scheduleCache` for durable provider route IDs in
the same bounded recent/future schedule window before user schedule projections
are regenerated.

When the same fresh provider pass also confirms a lower complete current total
with no future rows, that provider total can cap a stale larger imported total.
This prevents a removed provider row from continuing to appear as a phantom
remaining episode after the schedule row itself is gone.

This does not add specials to Schedule or progress counts. TMDB specials remain
a separate season-0 detail-display decision.

## Reasoning

The fix must be systematic because provider reclassification and row deletion
can happen after rows have already entered the VPS cache. Manual deletion would
fix only one show and leave the same stale-cache shape available for the next
break week or metadata correction.

Provider-scoped pruning keeps the cleanup narrow. TMDB's regular-season
summaries are enough to know that `S02E01` is stale when season 2 no longer
exists. TVMaze's episodes endpoint is enough to know when a TVMaze row has been
removed. AniList is deliberately excluded because a single next-airing response
does not prove the rest of the schedule.

The Convex cache prune is exact by episode identity and bounded by the schedule
window, so it removes rows that can affect Home/Schedule without rewriting old
history.

The stale imported-total cap is limited to fresh complete metadata where the
provider-released count reaches the provider total, there are no future rows,
and the provider total is at least the user's watched count. This avoids using a
sparse provider response to hide actual unwatched backlog.

## Provider/Data Assumptions

TMDB season `0` represents specials and is not part of regular-season progress
or regular Schedule rows under this decision.

TMDB positive season summaries are current enough to invalidate future/recent
regular-season rows for seasons that no longer exist.

TVMaze `/shows/:id/episodes` is a complete regular-episode set for the resolved
TVMaze show. The reconciler does not pass `specials=1` in this path.

AniList next-airing data is not complete enough to delete missing cached rows.

## Edge Cases

Same-provider date moves for the same season/episode remain covered by
ADR-0033.

Same-day multi-episode drops remain covered by ADR-0034 because adjacent current
episode rows are preserved when they still appear in the fresh provider data.

If a provider temporarily omits an entire future season and later restores it,
the next provider fetch can reinsert current rows and schedule-cache maintenance
can project them again.

Season 0 specials are not scheduled by this ADR. A future specials feature
should decide separately whether specials are display-only or trackable.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation includes a TMDB show whose cached provider rows contain stale
season 2 episodes while fresh TMDB season bounds only include season 1. The stale
season 2 rows must be deleted from SQLite, and the resulting release delta must
carry the stale episode identities for Convex schedule-cache pruning.

Fixture validation also covers the paired stale-total shape: imported progress
says `13/14`, fresh provider metadata says `13/13`, and no future rows remain.
The release fact must become `caught_up` with `releasedEpisodes = 13` and
`totalEpisodes = 13`.

Production verification should run the VPS schedule-confidence job after merge,
then confirm `Lord of Mysteries` no longer appears as `S02E01` on June 20, 2026
in Schedule or user schedule projections.

## Rollback Notes

Rollback by removing provider-event disappeared-row pruning from
`scripts/schedule-confidence.mjs`, removing `scheduleCacheProviderPrunes` from
the release delta schema, and removing the Convex schedule-cache prune call in
`convex/scheduleConfidence.ts`.

If rollback is needed because a valid future row disappeared, inspect whether
the fresh provider response truly omitted the row and whether the row belonged
to a regular season or a season-0 special.
