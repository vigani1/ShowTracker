# Decision Map

ADRs are the durable memory for architectural and behavior decisions. This map groups them so agents can find the relevant history quickly.

For Home, Watchlist, Schedule, release availability, provider matching, duplicate collapse, route IDs, schedule cache, and user projections, ADRs are the long-term memory that prevents repeating old debugging loops. Do not delete, summarize away, or bypass them just because the implementation is now easier to inspect.

## Start Here For Risky Work

For Home, Watchlist, Schedule, release availability, provider matching, duplicate collapse, route IDs, schedule cache, user projections, or the SQLite reconciliation boundary, read the most recent relevant ADRs before editing code and add a new ADR for behavior changes.

When the user says a production issue happened before, search this map and the ADRs by symptom and title before designing a fix:

```bash
rg -n "same-day|duplicate|stale|future-only|remainingEpisodes|newEpisodeSignalAt|projection|provider|scheduleCache|watchlist|Home" docs/ADR-*.md
```

Use ADRs to recover the behavior contract and edge cases. Use current code and production data to confirm the present failure mode.

Most frequently relevant:

- [ADR-0010](ADR-0010-user-schedule-projections.md): user-specific schedule projections.
- [ADR-0017](ADR-0017-auto-paused-release-availability.md): auto-paused release availability.
- [ADR-0018](ADR-0018-provider-schedule-episode-numbering.md): provider episode numbering.
- [ADR-0019](ADR-0019-home-schedule-signal-recency.md): Home schedule signal recency.
- [ADR-0020](ADR-0020-same-day-watched-schedule-duplicates.md): same-day watched duplicates.
- [ADR-0021](ADR-0021-provider-cache-total-pruning.md): provider-verified cache total pruning.
- [ADR-0022](ADR-0022-home-feed-pagination-stability.md): Home feed pagination stability.
- [ADR-0023](ADR-0023-adjacent-date-watched-schedule-duplicates.md): adjacent-date watched duplicates.
- [ADR-0024](ADR-0024-home-watchlist-tab-return-stability.md): Home Watchlist tab return stability.
- [ADR-0025](ADR-0025-tmdb-auth-fallback-schedule-maintenance.md): TMDB auth fallback for schedule maintenance.
- [ADR-0026](ADR-0026-detail-watchable-progress.md): detail watchable progress denominator.
- [ADR-0027](ADR-0027-home-caught-up-schedule-signal-guard.md): Home caught-up schedule signal guard.
- [ADR-0028](ADR-0028-detail-rail-performance-windowing.md): detail rail performance windowing.
- [ADR-0029](ADR-0029-positive-backlog-release-freshness.md): positive released backlog and provider freshness stamps.
- [ADR-0030](ADR-0030-terminal-total-watchlist-backlog.md): terminal totals preserve watchlist backlog.
- [ADR-0031](ADR-0031-watched-anchor-schedule-counts.md): watched anchors suppress stale schedule counts.
- [ADR-0032](ADR-0032-terminal-total-release-denominator-guard.md): terminal totals do not override positive released counts.
- [ADR-0033](ADR-0033-tmdb-upcoming-date-conflicts.md): TMDB upcoming date conflicts prune stale schedule rows.
- [ADR-0034](ADR-0034-same-day-multi-episode-schedule.md): same-day multi-episode drops preserve adjacent episodes and display top-down.
- [ADR-0035](ADR-0035-schedule-confidence-run-resilience.md): schedule-confidence run resilience keeps daily refreshes moving through git/provider stalls.
- [ADR-0036](ADR-0036-terminal-imported-backlog-metadata.md): terminal imported backlog needs provider metadata confirmation before defeating sparse-old capping.
- [ADR-0037](ADR-0037-provider-disappeared-episode-pruning.md): provider rows that disappear upstream are pruned from SQLite and schedule cache.
- [ADR-0038](ADR-0038-provider-backed-returning-season-drops.md): provider-backed returning season drops defeat sparse-old release capping.
- [ADR-0039](ADR-0039-recent-home-schedule-count-evidence.md): recent Home schedule-count evidence backs cached schedule signals after day rollover.

## Navigation

| ADR | Decision |
| --- | --- |
| [ADR-0001](ADR-0001-overlay-detail-routes.md) | Show details use overlay detail routes for in-app navigation while preserving direct URL support. |

## Convex Cost And Projection Shape

| ADR | Decision |
| --- | --- |
| [ADR-0003](ADR-0003-tracked-metadata-refresh-cost-gate.md) | Tracked metadata refresh skips broad user-library aggregate repair while preserving show-level projection refresh. |
| [ADR-0004](ADR-0004-tracked-ids-projection-read.md) | Discover and Recommendations read tracked identity state from feed projections instead of N+1 show hydration. |
| [ADR-0010](ADR-0010-user-schedule-projections.md) | Schedule reads use compact user-specific projections with guarded fallback behavior. |
| [ADR-0011](ADR-0011-schedule-projection-fallback-diagnostics.md) | Projection fallback diagnostics make missing/stale projection coverage visible. |
| [ADR-0013](ADR-0013-server-owned-watchable-count-repair.md) | Watchable count repair remains server-owned and bounded. |
| [ADR-0014](ADR-0014-narrow-projection-repair-trigger.md) | Projection repair triggers stay narrow instead of broad reactive rebuilds. |

## Schedule, Release, And Provider Matching

| ADR | Decision |
| --- | --- |
| [ADR-0002](ADR-0002-watchlist-schedule-cache-bridge.md) | Home can use same-day schedule-cache facts as watchlist attention while provider matching stays conservative. |
| [ADR-0005](ADR-0005-server-owned-schedule-refresh.md) | Server-owned schedule refresh owns freshness and prunes moved cache rows. |
| [ADR-0006](ADR-0006-clear-stale-release-signals.md) | Server reconciliation clears stale release signals when trusted facts say the user is caught up. |
| [ADR-0007](ADR-0007-prune-stale-title-schedule-rows.md) | Provider-backed break-week moves prune stale same-title schedule rows. |
| [ADR-0008](ADR-0008-utc-overnight-scheduler-window.md) | Scheduled maintenance runs after UTC day rollover. |
| [ADR-0009](ADR-0009-home-watchlist-released-progress.md) | Home watchlist released progress counts use released, not merely total, episode facts. |
| [ADR-0012](ADR-0012-tmdb-bearer-and-autopause-fully-watched-guard.md) | TMDB bearer auth and fully watched auto-pause guards preserve release/status correctness. |
| [ADR-0015](ADR-0015-preserve-imported-remaining-release-floor.md) | Imported remaining release floors are preserved until trusted facts replace them. |
| [ADR-0016](ADR-0016-provider-date-conflict-release-authority.md) | Provider date conflicts use release-authority rules instead of broad fallback. |
| [ADR-0017](ADR-0017-auto-paused-release-availability.md) | Auto-paused titles can surface again when reliable released content exists. |
| [ADR-0018](ADR-0018-provider-schedule-episode-numbering.md) | Schedule rows preserve trusted provider episode numbering. |
| [ADR-0019](ADR-0019-home-schedule-signal-recency.md) | Home schedule signals use recency rules to avoid stale attention rows. |
| [ADR-0020](ADR-0020-same-day-watched-schedule-duplicates.md) | Same-day watched schedule duplicates collapse without hiding real unwatched content. |
| [ADR-0021](ADR-0021-provider-cache-total-pruning.md) | Provider-verified totals can prune stale cache rows safely. |
| [ADR-0022](ADR-0022-home-feed-pagination-stability.md) | Home holds resolved feed pages during pagination refetches so section expansion does not collapse. |
| [ADR-0023](ADR-0023-adjacent-date-watched-schedule-duplicates.md) | Adjacent-date watched schedule duplicates collapse when providers disagree by one day. |
| [ADR-0024](ADR-0024-home-watchlist-tab-return-stability.md) | Home keeps the last Watchlist view stable while users visit Schedule and return. |
| [ADR-0025](ADR-0025-tmdb-auth-fallback-schedule-maintenance.md) | TMDB auth fallback keeps provider facts flowing for schedule maintenance. |
| [ADR-0026](ADR-0026-detail-watchable-progress.md) | Detail progress uses released/watchable denominators while catalog totals and upcoming rows remain visible. |
| [ADR-0027](ADR-0027-home-caught-up-schedule-signal-guard.md) | Home hides caught-up active rows when schedule counts prove the remaining episodes are future-only. |
| [ADR-0028](ADR-0028-detail-rail-performance-windowing.md) | Detail quick rails render a fixed-width virtual window while status labels update optimistically. |
| [ADR-0029](ADR-0029-positive-backlog-release-freshness.md) | Home treats fresh positive released backlog as actionable and client payloads without release facts do not freshen provider metadata. |
| [ADR-0030](ADR-0030-terminal-total-watchlist-backlog.md) | Terminal TV/anime totals preserve Home backlog when stale released counts collapse to zero. |
| [ADR-0031](ADR-0031-watched-anchor-schedule-counts.md) | Watched episode anchors suppress stale Home schedule counts and widened totals repair affected aggregates. |
| [ADR-0032](ADR-0032-terminal-total-release-denominator-guard.md) | Terminal raw totals rescue missing release counts but do not override positive released/watchable denominators. |
| [ADR-0033](ADR-0033-tmdb-upcoming-date-conflicts.md) | TMDB-tracked future date conflicts prefer TMDB's same-number next date so stale schedule rows can be pruned. |
| [ADR-0034](ADR-0034-same-day-multi-episode-schedule.md) | Same-day multi-episode drops preserve adjacent provider episodes and display grouped top-down. |
| [ADR-0035](ADR-0035-schedule-confidence-run-resilience.md) | Schedule-confidence runs continue on a valid checkout when git update fails and provider requests time out instead of hanging the full run. |
| [ADR-0036](ADR-0036-terminal-imported-backlog-metadata.md) | Terminal imported backlog needs provider metadata confirmation before sparse-old capping can collapse it. |
| [ADR-0037](ADR-0037-provider-disappeared-episode-pruning.md) | Provider rows that disappear upstream are pruned from SQLite and schedule cache. |
| [ADR-0038](ADR-0038-provider-backed-returning-season-drops.md) | Provider-backed returning season drops defeat sparse-old release capping. |
| [ADR-0039](ADR-0039-recent-home-schedule-count-evidence.md) | Home's schedule-count guard includes recent schedule evidence matching cached signal lookback. |

## Rule For New ADRs

Watchlist/schedule/release/provider/projection ADRs must include:

- Context.
- Current behavior.
- Decision.
- Reasoning.
- Provider/data assumptions.
- Edge cases.
- Verification.
- Rollback notes.

Keep the ADR concrete enough that a future agent can understand why a behavior exists without reading old chat history.
