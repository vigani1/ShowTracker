# ADR-0033: TMDB Upcoming Date Conflicts Prune Stale Schedule Rows

## Status

Accepted

## Context

On June 17, 2026, production `/show/tmdb:tv:274671` for `The Beginning After the End`
showed the detail page's TMDB-backed next episode date as June 24, 2026. Home and
Schedule still treated season 2 episode 12 as available on June 17, 2026 because
the server-owned schedule projection copied a TVMaze schedule-cache row for the
same episode on that earlier date.

Production data showed:

- `shows.releasedEpisodes = 23` and `shows.totalEpisodes = 24`.
- The tracked user had watched 23 episodes.
- `scheduleCache` contained TVMaze S02E12 on `2026-06-17`.
- `userScheduleEvents` and `watchlistFutureCountProjections` copied that row,
  making the route count as available.
- TMDB currently exposes S02E12 with `air_date = 2026-06-24`, while TVMaze still
  exposes S02E12 on `2026-06-17`.
- The VPS SQLite provider-event cache also retained an older TMDB S02E12 row on
  `2026-06-17`, because provider event IDs included `airDate` and fresh fetches
  inserted the new moved row without deleting the old same-provider same-episode
  row.

## Current Behavior

ADR-0016 added release-specific conflict authority for same-number provider rows
when one provider says released and another says future. That did not cover this
case because both provider rows were future rows at projection generation time.

For future-only same-number conflicts, schedule-confidence fell back to the
general schedule priority where TVMaze wins over TMDB. That let an earlier TVMaze
future row become the trusted `nextScheduled` fact, so the existing schedule-cache
move pruning never saw the later TMDB date and could not remove the stale TVMaze
row.

Even when the fresh TMDB fetch included the new June 24 row, the local SQLite
cache could still contain the previous June 17 TMDB row. Because that old row had
a different date-keyed event ID, `upsertProviderEvent` did not replace it. The
release fact could then treat the stale TMDB row as released and leave the stale
schedule projection alive.

## Decision

For TMDB-tracked TV rows, release fact dedupe now prefers a direct TMDB row when
the same numbered future episode has conflicting provider dates. Same-date
future rows keep the existing schedule priority, so TVMaze can still provide
better time precision and naming when it agrees with TMDB's date.

Fresh provider-event upserts now replace older rows for the same provider,
provider show, media type, season number, and episode number when the event ID
differs. This removes stale moved-date rows from the local SQLite cache before
release facts and schedule projections are rebuilt.

This rule only changes the release fact used by the server-owned reconciler. It
does not change client matching, provider ID matching, title fallback, status
mutation semantics, or schedule duplicate collapse.

## Reasoning

The detail route uses TMDB season detail data for TMDB routes, so Home and
Schedule should not contradict the detail page for a same-number future episode
on a TMDB-tracked show. Once the reconciler chooses TMDB's later future date, the
existing ADR-0005 and ADR-0007 cache-pruning path can remove stale TVMaze rows by
durable provider ID or exact title plus episode identity.

Provider date moves should replace the previous provider fact, not accumulate as
multiple possible realities for the same provider episode. Keeping one current
row per provider/show/season/episode lets old move dates disappear without a
broad SQLite reset.

Keeping the rule limited to future same-number date disagreements avoids
reversing ADR-0016. If a provider says an episode is already released while
another says future, the existing release-availability rule still decides that
shape. If providers agree on the date, TVMaze's schedule metadata remains useful.

## Provider/Data Assumptions

TMDB season detail rows are the authority for the date displayed on TMDB-tracked
detail pages.

TVMaze remains a good schedule source when it agrees on the episode date, when no
direct TMDB future row exists, or for non-TMDB-tracked rows.

Direct provider IDs remain required. Title fallback is not allowed to mutate
show metadata or schedule-cache rows.

## Edge Cases

A same-number TMDB/TVMaze row on the same future date keeps the existing
TVMaze-first precision behavior.

A released-vs-future provider conflict keeps ADR-0016 behavior and can still
surface available backlog when the released row is trusted.

Future-only provider count drift without a direct TMDB row remains protected by
ADR-0016 and ADR-0032; it cannot create a projection repair by itself.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation includes a TMDB-tracked TV row with watched count 23, TMDB
S02E12 on June 24, 2026, and TVMaze S02E12 on June 17, 2026. The release fact
must remain `upcoming`, keep `releasedEpisodes = 23`, and choose the June 24
TMDB row as `nextScheduled`.

Fixture validation also writes a stale TMDB S02E12 row on June 17 followed by a
fresh TMDB S02E12 row on June 24 into an in-memory provider-event cache. Only the
June 24 row may remain.

Production verification should run the VPS schedule-confidence job after deploy,
then confirm `/show/tmdb:tv:274671`, Home, and Schedule no longer show S02E12 as
available on June 17 while preserving the June 24 upcoming row.

## Rollback Notes

Rollback by removing the TMDB future-date preference and same-provider
same-episode provider-event replacement in `scripts/schedule-confidence.mjs`,
then re-running schedule-confidence projections.

If rollback is considered because a real TVMaze-only future schedule row
disappears, first inspect whether a direct same-number TMDB row exists with a
different date. The rule should not affect rows without that direct TMDB evidence.
