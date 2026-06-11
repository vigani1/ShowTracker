# Schedule Confidence

## Goal

ShowTracker should reliably know whether tracked titles have released content, future scheduled content, and provider/link confidence without requiring the user to open a detail page or run broad repairs.

This is the durable replacement for old schedule-confidence implementation plans. Behavior-level decisions belong in ADRs; this doc keeps the goal and current workflow visible.

## Product Promise

A tracked show should have coherent release state across Home, Watchlist, Schedule, and detail pages:

- Has a new episode already aired?
- Is a future episode scheduled?
- Which season/episode is latest or next?
- Which provider supplied or confirmed the fact?
- Was the match direct, bridged, verified-title, or low-confidence fallback?

Global release awareness is the default. Region-specific filtering can exist later, but the default should not hide real release events simply because one country schedule missed them.

## Architecture

Convex owns user-facing app state. The schedule-confidence reconciler owns heavyweight provider/release intelligence.

```text
Provider APIs
  -> scripts/schedule-confidence.mjs
  -> local/server-side SQLite working store
  -> compact release facts and schedule projections
  -> convex/scheduleConfidence.ts
  -> Convex app tables
  -> realtime UI
```

The reconciler imports tracked library/projection state, refreshes provider links and release facts, audits uncertainty, and applies compact deltas back to Convex. Convex should not repeatedly do broad provider or schedule scans in reactive UI queries.

## Provider Policy

- TMDB for TV/movie catalog and TV release metadata.
- TVMaze for TV schedule/episode facts where useful.
- AniList for anime identity, relations, and airing facts.
- Jikan/MAL for anime fallback/enrichment.
- IMDb as a bridge identifier.
- TVDB only as an alias if already present.

Provider IDs are trusted before titles. Title fallback is intentionally narrow, low-confidence, and auditable.

## Current Commands

```bash
npm run schedule-confidence:validate
npm run schedule-confidence:import
npm run schedule-confidence:reconcile
npm run schedule-confidence:audit
npm run schedule-confidence:apply
npm run schedule-confidence:apply-projections
npm run schedule-confidence:compare-projections
npm run schedule-confidence:diagnose-projections
```

Dev workflow, when the configured Convex dev deployment and token are available:

```bash
npx convex dev --once --typecheck enable --tail-logs disable
npm run schedule-confidence:dev:workflow
```

Evidence files are written under `.schedule-confidence/`.

## VPS Runtime

The private schedule-confidence runtime is reachable with:

```bash
ssh showtracker-vps
```

Its repo checkout is `/opt/showtracker`. The systemd timer is
`showtracker-schedule-confidence.timer`, and the service runs
`scripts/ops/run-schedule-confidence.sh`, which fetches and hard-resets the
checkout to `origin/main` before importing, reconciling, auditing, and applying
provider deltas.

## Audits Should Surface

- Missing provider links.
- Missing schedule or release sources.
- Title-only matches.
- Conflicting provider IDs.
- Stale release facts or stale Convex projections.
- Reconciliation failures or skipped shows.

Silent absence is not acceptable for tracked-title release health.

## Success Criteria

- Home, Watchlist, and Schedule can become correct without opening a show detail page.
- Completed or auto-paused shows with reliable newly released content can re-enter attention.
- Future scheduled episodes are distinct from already released unwatched episodes.
- Missing or low-confidence provider links are visible in audit output.
- Convex receives compact changed facts/projections instead of absorbing full-library provider scans.

## Related ADRs

Start with `docs/DECISIONS.md`, especially ADR-0010 and ADR-0017 through ADR-0021.
