# Convex Bandwidth and Feed Reliability Plan

## Why This Exists

ShowTracker consumed very high Convex reads in a short testing window (single-user and agent testing). This plan defines how to reduce read bandwidth aggressively while preserving all current Home, Upcoming, Library, and tracking behavior.

This document is the execution contract for implementation.

## Ownership Mode (Mandatory)

The implementation agent is in full ownership mode for this initiative.

That means the agent must:
- Plan, implement, verify, debug, and close the work end-to-end.
- Proactively investigate failures/regressions without waiting for handoff.
- Run targeted tests and browser checks to validate behavior parity.
- Iterate until all acceptance criteria are met or a true external blocker exists.

The work is not done at partial optimization. The work is done only when behavior parity + bandwidth targets are both satisfied.

## Primary Goals

1. Cut Convex read usage significantly for heavy user scenarios (large libraries, frequent tab navigation).
2. Preserve Home and Upcoming functional correctness exactly (including relation and release-date nuances).
3. Preserve Library filtering/status counters/total counts with pagination.
4. Keep data freshness for new episodes/seasons/relations without requiring users to manually refresh everything.

## Non-Goals

- Building a full episode warehouse database for every show immediately.
- Rewriting product behavior or changing UX rules for Home/Upcoming.
- Sacrificing correctness for read reduction.

## Functional Contracts to Preserve

### Home -> Watchlist contract

Keep all existing logic semantics:
- Show only TV and anime cards (no movies).
- Exclude paused/dropped/completed entries from watchlist rail (paused should not render in Home watchlist).
- Exclude entries without meaningful progress where applicable.
- Only show entries with released and unwatched episodes (not just future episodes that exist in metadata).
- Keep anime relation progression behavior:
  - prioritize the currently active relation entry,
  - when finished, advance to the next eligible related entry,
  - newly discovered relations/seasons must become eligible after sync.

### Upcoming contract

Keep all existing logic semantics:
- Include tracked TV/anime regardless of status (watching, paused, dropped, completed, plan_to_watch).
- Exclude movies.
- Support date range expansion (past/future windows) and grouping by date.
- Correctly reflect new episodes, additional episodes in same season, and newly released seasons/relations.

### Library contract

When adding pagination:
- Preserve correct counts for status tabs and totals.
- Preserve filter correctness (media type, status, and any other active filters).
- Do not rely on frontend-only guessed totals; backend must provide authoritative counts.

## Architecture Decision

### Decision: optimize with shared global freshness + per-user projections

Use a hybrid model:
- Keep `shows` and `scheduleCache` as shared global sources of truth.
- Add per-user projection data for Home/Upcoming inputs to avoid re-hydrating full user library on every page load.
- Move heavy repeated computation from read-time to controlled refresh/invalidation paths.
- Deduplicate external freshness checks by unique show identifiers (for example, one check per unique TV/anime root), then fan out updates to affected users.

### Decision: do not build a full custom episode warehouse now

Reason:
- Large complexity and sync burden.
- Current bottleneck is repeated per-user hydration and repeated broad reads, not absence of global episode storage.
- Existing shared cache model already gives cross-user reuse.

## Refresh and Invalidation Strategy

### Immediate invalidation (user-driven)

Any mutation that changes user tracking state must invalidate/rebuild affected projection(s), including:
- add/remove watchlist
- status changes
- episode watched/unwatched toggles
- season batch operations
- movie watch toggles
- imports/resets
- auto-tracked relation insertions/updates

### Scheduled refresh (system-driven)

Use scheduled jobs to keep external freshness in sync:
- 12-hour refresh cadence for active feed freshness where appropriate.
- Daily deep reconciliation for new episodes/seasons/relations across tracked content.
- Anime relation synchronization remains active and integrated with projection refreshes.
- Scheduler work should run against unique global show/root sets first, then update impacted user projections, to avoid duplicated checks for the same show across many users.

### Freshness outcomes required

- User-driven changes should reflect quickly after mutation.
- External catalog changes (new episode, new season, new relation) should appear without manual intervention within defined schedule windows.

## Implementation Phases

### Phase 0 - Baseline and guardrails

Deliverables:
- Establish baseline read costs per critical page flow.
- Define target reduction thresholds and parity checks.
- Add temporary diagnostics for comparing old/new query outputs during migration.

Exit criteria:
- Baseline captured for Home, Upcoming, Library, Profile, Discover, Recommendations.
- Target metrics recorded.

### Phase 1 - Library query split and pagination foundation

Deliverables:
- Replace monolithic library read with paginated query surface.
- Add authoritative backend count endpoints/fields for totals and statuses.
- Add lightweight tracked-key query for pages that only need tracking presence (Discover/Recommendations).

Exit criteria:
- Library UX keeps correct counters and filters.
- Discover/Recommendations no longer pull full library payload.

### Phase 2 - Projection model for feed inputs

Deliverables:
- Introduce per-user feed projection storage (Home/Upcoming inputs and metadata).
- Add rebuild helpers and targeted invalidation hooks.
- Add indexes needed for efficient updates and lookups.

Exit criteria:
- Projection lifecycle works under create/update/delete tracking actions.

### Phase 3 - Home migration with parity

Deliverables:
- Move Home watchlist data path to projection-backed flow.
- Preserve release-date filtering, status gating, and anime relation progression behavior.
- Eliminate redundant heavy helper reads used only for frontend filtering.

Exit criteria:
- Home output parity validated against previous behavior on representative test accounts.

### Phase 4 - Upcoming migration with parity

Deliverables:
- Keep date-range hydration UX while using optimized matching path.
- Avoid broad per-request re-hydration of all user shows.
- Preserve all-status inclusion and date grouping behavior.

Exit criteria:
- Upcoming parity validated for near-term and extended date windows.

### Phase 5 - Scheduled freshness and external updates

Deliverables:
- Add/adjust cron workflows for 12-hour and daily reconciliation cycles.
- Ensure new episodes/seasons/relations trigger downstream projection refresh.
- Keep anime relation sync aligned with Home/Upcoming freshness.

Exit criteria:
- External content freshness is visible within expected windows.

### Phase 6 - Cleanup and hardening

Deliverables:
- Remove deprecated heavy paths after parity confidence.
- Keep fallback/rollback path available until stable.
- Finalize docs and operational notes.

Exit criteria:
- No known parity regressions.
- Read targets met or exceeded.

## Verification and Testing Plan

### Automated checks

- Run lint/type checks and targeted query validation.
- Add/update tests for projection logic and filter/count correctness.
- Add regression coverage for relation progression and release-date gating rules.

### Browser/behavior validation

Use browser-based validation on key user flows:
- Home watchlist correctness under mixed statuses.
- Upcoming correctness across scrolling date windows.
- Library counters and filters under pagination.
- Discover/Recommendations tracked-state behavior.

### High-scale simulation

Validate with large-account assumptions (hundreds to ~1000 tracked items):
- Page responsiveness.
- Convex read profile.
- Correctness under frequent status/watch mutations.

## Acceptance Criteria (Definition of Done)

All must be true:
- Home behavior matches current functional contract.
- Upcoming behavior matches current functional contract.
- Library pagination is active and counts remain correct.
- Read bandwidth materially reduced in measured flows.
- External freshness for new episodes/seasons/relations works on scheduled cadence.
- No open critical regressions in core tracking flows.

## Troubleshooting Playbook (Agent Responsibility)

If issues appear, the agent must:
- Identify whether failure is data freshness, invalidation, projection drift, or query mismatch.
- Add focused diagnostics to isolate root cause.
- Patch and re-verify affected flows immediately.
- Re-run parity checks and bandwidth checks after each fix.
- Continue iterating until acceptance criteria are met.

No handoff-style "partially done" state is acceptable for this initiative.

## Rollout and Safety

- Use staged rollout/feature flags where needed.
- Keep temporary dual-read comparison during migration.
- Provide rollback switch to prior path until confidence is high.
- Remove old paths only after parity + performance confirmation.

## Deliverable Summary

At completion, the project should have:
- Lower Convex reads for heavy navigation and large libraries.
- Preserved Home/Upcoming correctness including nuanced anime relation behavior.
- Backend-authoritative library pagination + counts.
- A reliable freshness pipeline for user-driven and external-content-driven changes.
