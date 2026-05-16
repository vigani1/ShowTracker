# ADR-0008: UTC Overnight Scheduler Window

## Context

The schedule confidence reconciler is the source of truth for pruning stale external SQLite rows before they reach Convex schedule and watchlist projections. It is intentionally run on the private server instead of Convex because it reads and writes local SQLite data, calls provider APIs, and can do enough IO that running it inside Convex would be wasteful.

Schedule day buckets and release comparisons are UTC-oriented in the backend paths. Running the reconciler at 1 AM Kosovo local time can happen before midnight UTC during daylight saving time, which risks reconciling the previous UTC day instead of the just-started schedule day. The operational window should therefore be anchored after UTC midnight, not to a local wall-clock time.

## Current Behavior

Before this change:

- `showtracker-schedule-confidence.timer` used `OnCalendar=*-*-* 03:20:00 UTC`, and was briefly changed to 1 AM local server time.
- `convex/crons.ts` scheduled `autoPauseInactiveShows` with `45 1 * * *` UTC, and was briefly changed toward Kosovo-local 1 AM.

The VPS has no active root or `showtracker` user crontab entries. The schedule-confidence systemd timer is the only active ShowTracker VPS timer found.

## Decision

Run the external schedule-confidence reconciler at `00:15 UTC`, with the existing `RandomizedDelaySec=10m`. Keep the timer explicitly UTC-based even if the host timezone changes.

Run the Convex `autoPauseInactiveShows` cron at `00:45 UTC`, after the UTC schedule day has rolled over and after the private-server reconciler has started.

Keep the expensive schedule confidence work on the private server, not in Convex. Accept that the Kosovo local maintenance window is roughly 1:15-2:55 AM depending on daylight saving time.

## Reasoning

Anchoring the maintenance window after UTC midnight matches the way schedule day buckets and release comparisons are calculated. It avoids the daylight-saving case where 1 AM Kosovo local time is still the previous UTC day.

The timer remains daily rather than hourly because one day of staleness is acceptable for rare provider break corrections. Running just after UTC rollover keeps cost and provider API pressure low while still letting overnight runs repair rows such as Detective Conan episode 1202 when TMDB schedule data moves.

Using a systemd timer on the private server keeps provider reconciliation, SQLite reads/writes, and batch apply IO off Convex. Convex only keeps the lightweight auto-pause maintenance cron and manual repair entry points.

## Provider/Data Assumptions

No provider identity or release matching behavior changes. This only changes when maintenance runs.

The schedule-confidence server job remains the owner of routine schedule/release freshness. Convex remains limited to compact cron work and manual repair paths.

TMDB date-only air dates are preserved as provider date keys, but release-state comparisons parse them as UTC dates. AniList schedule timestamps are epoch-based and therefore naturally UTC. TVMaze `airstamp` values are timestamped; `airdate` fallback is date-only and should be treated carefully.

## Edge Cases

Completed shows with new releases, paused shows, dropped shows, planned/not-started shows, long-running shows, anime season aliases, missing providers, title fallback, same-day duplicate episodes, future weekly rows, and stale provider totals keep the same matching and projection behavior. Only the daily maintenance time changes.

Persistent systemd timer behavior remains enabled, so a missed VPS run will execute when the server comes back online. The existing `RandomizedDelaySec=10m` remains, so the reconciler can run a few minutes after `00:15 UTC`.

## Verification

Inventory found one active ShowTracker systemd timer and no active root/showtracker crontabs on the VPS.

After deploy, verify:

- `systemd-analyze calendar "*-*-* 00:15:00 UTC"` shows the next run after UTC day rollover.
- `systemctl list-timers showtracker-schedule-confidence.timer` shows the next run around `00:15 UTC`, plus randomized delay.
- `npx convex deploy --yes` succeeds with the updated `00:45 UTC` cron definition.

## Rollback Notes

Revert `scripts/ops/showtracker-schedule-confidence.timer` and `convex/crons.ts` if the UTC overnight window causes provider rate-limit or freshness problems.

Watch the Home watchlist and Schedule screens for Detective Conan, Daemons of the Shadow Realm, One Piece, long-running anime, paused shows, and completed shows with new releases after the next daily run.
