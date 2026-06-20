# ADR-0035: Schedule Confidence Run Resilience

## Status

Accepted

## Context

On June 20, 2026, production `Lord of Mysteries` (`tmdb:tv:232230`) showed a
new season/special episode on the detail page after the user opened it, but the
Schedule tab had no matching row and the title had not appeared in the Watchlist
until detail refreshed tracked metadata.

Production inspection showed two operational failures in the server-owned
schedule-confidence path:

- `showtracker-schedule-confidence.timer` fired on June 18, June 19, and
  June 20, 2026, but the service failed before importing or reconciling because
  `git fetch` could not write root-owned objects under `/opt/showtracker/.git`.
- After ownership was repaired and the service was started manually, the
  provider reconcile phase could hang on an HTTPS provider request because the
  reconciler's shared `fetchJson` helper had no timeout.

This meant Home, Watchlist, Schedule, and future-count projections could all
remain stale even though provider/detail data had changed.

## Current Behavior

The VPS service script hard-resets `/opt/showtracker` to `origin/main` before
each run. With `set -e`, any git update failure exits the service before
`schedule-confidence:import`, `schedule-confidence:reconcile:providers`, and
`schedule-confidence:apply` run.

Provider fetches are made sequentially for imported library items. A single hung
TMDB, TVMaze, or AniList request can block the entire reconcile command instead
of becoming a per-show `provider_fetch_failed` audit issue.

## Decision

The VPS runner now treats git update failure as a warning by default. When
`git fetch` or `git reset` fails, the service logs the failure, verifies that the
current checkout has a valid `HEAD`, and continues the provider reconciliation on
that checkout. Operators can restore fail-fast behavior by setting
`SHOWTRACKER_RECONCILER_REQUIRE_GIT_UPDATE=1`.

The schedule-confidence provider fetch helper now applies a bounded timeout to
all provider HTTP requests. A timed-out provider call throws a redacted
provider-fetch error, which the existing per-item error handling records as an
audit issue while the reconciler continues scanning the rest of the library.

The production VPS ownership is repaired so the `showtracker` service user owns
the checkout again.

## Reasoning

The primary user promise is fresh release awareness. Running yesterday's
checkout is better than skipping the entire daily provider refresh because a
repo update step failed. The timer should still surface the git problem in
journals, but provider reconciliation should continue whenever the existing
checkout is usable.

Provider availability should be isolated by show/request. A single stuck network
request must not prevent the run from updating unrelated titles and schedule
projections. The existing audit mechanism is already the right place to record
provider failures.

Keeping the fallback in the runner, rather than adding broad app-open provider
refresh, preserves the architecture from ADR-0005 and ADR-0010: routine release
freshness remains server-owned and writes compact Convex deltas.

## Provider/Data Assumptions

TMDB, TVMaze, and AniList can temporarily fail or stall. A timeout means
"provider unavailable for this request," not "the show has no release data."

Continuing on the existing checkout is acceptable only when the checkout has a
valid git `HEAD`. The service still runs the same import, reconcile, audit, and
apply commands.

Provider API keys and bearer credentials must never be printed in timeout
messages.

## Edge Cases

If the repo checkout is corrupt and `git rev-parse --verify HEAD` fails, the
service still exits instead of running from an unknown state.

If operators need a deploy gate where the latest `origin/main` is mandatory,
`SHOWTRACKER_RECONCILER_REQUIRE_GIT_UPDATE=1` restores the old fail-fast result.

Timed-out provider requests can leave one title stale for that run, but they no
longer block all other titles or projection regeneration.

The provider timeout does not change provider matching, title fallback, duplicate
collapse, release authority, schedule-cache pruning, or user status mutation
rules.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation includes a provider timeout assertion that aborts a hanging
fetch, verifies the timeout error is raised, and verifies API-key query
parameters are redacted.

Production verification should:

- confirm the VPS checkout is owned by `showtracker`;
- run `showtracker-schedule-confidence.service` successfully;
- confirm the latest reconciler run is June 20, 2026 or later;
- confirm `Lord of Mysteries` has refreshed release/projection state without
  requiring another detail-page open;
- confirm the live Home/Schedule app reflects the repaired production data.

## Rollback Notes

Rollback by restoring the runner's fail-fast `git fetch && git reset` behavior
and removing the provider timeout wrapper from `scripts/schedule-confidence.mjs`.

If rollback is considered because provider errors increase, inspect the audit
rows first. Timeout errors indicate provider slowness that previously would have
blocked the full run.
