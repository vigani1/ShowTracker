# Schedule Confidence Agent Goal

## Mission

Make ShowTracker trustworthy for release state.

If a user tracks a show, the app should reliably know whether new content exists, when the next known content airs, and how confident it is in that answer. This must hold without requiring the user to search for the show, open the show detail page, or manually run a repair job.

This is not a plan for patching one missing title. It is a plan for removing the fragile pattern where Home, Watchlist, and Schedule can disagree because provider IDs, schedule feeds, and user projections are stitched together in different places.

## Product Promise

A tracked show should have one coherent release state that can answer:

- Has a new episode already aired?
- Is there a future episode scheduled?
- Which season and episode is latest or next?
- Which provider supplied or confirmed that fact?
- Was the match based on a direct provider ID, a bridged provider ID, or a weaker fallback?

Global release awareness is the default. If an episode airs in Japan, the UK, the US, or on a streaming/web schedule, ShowTracker should treat it as a real release event for the tracked show. Region-specific schedule filtering can exist later as a user setting, but it must not be the default source of truth.

## Problem To Solve

The current system mixes three responsibilities that should be separated:

- Catalog identity: what show this is.
- Release intelligence: when episodes or seasons exist, aired, or are scheduled.
- User projection state: what this user should see on Home, Watchlist, and Schedule.

Recent bugs came from those responsibilities being coupled too tightly. Shows have been missing from Watchlist until opened, missing from Schedule, shown in one surface but not another, or affected by cost-saving changes that reduced broad repair/backfill work.

The old broad repair/backfill behavior was acting as an accidental safety net. The replacement should be a deliberate reconciliation pipeline, not smaller patches for each visible symptom.

## Architecture Direction

Keep Convex for user-facing app state:

- Users and auth-linked state.
- Tracked shows and watch statuses.
- Watched episodes.
- Favorites and custom lists.
- Lightweight realtime reads for Home, Watchlist, Profile, and Schedule.
- Compact release facts and user-facing projections after reconciliation has already happened.

Add or design a dedicated self-hosted reconciliation backend that runs on a VPS or similar server. This backend should use server-side SQLite as its working store. SQLite is preferred because the workload is batch-heavy, auditable, low-concurrency, cheap to host, and easy to inspect/backup. This should not be client-local SQLite and should not be an ad hoc developer-only database file.

The reconciliation backend owns provider and release intelligence:

- Provider identity graph.
- TMDB external ID enrichment.
- TVMaze, IMDb, AniList, and MAL/Jikan link resolution.
- Optional TVDB alias preservation only when that ID already exists from imports or provider metadata.
- Global episode/release discovery.
- Full-library scheduled reconciliation.
- Change detection since the previous run.
- Low-confidence match and missing-provider audit output.

Convex should receive compact deltas or already-reconciled facts. Convex should not absorb the expensive provider scans, broad schedule searches, or repeated full-library repair work.

Preferred flow:

```text
Provider APIs
  -> VPS reconciliation backend
  -> server-side SQLite identity/release store
  -> compact changed facts or projection deltas
  -> Convex app database
  -> realtime app UI
```

Convex remains the source of truth for user-owned state. The VPS SQLite backend becomes the source of truth for provider intelligence and schedule confidence.

## Provider Policy

Use the current real providers:

- TMDB for movies and TV catalog data.
- TVMaze for TV schedule/episode data where it is useful.
- AniList for anime where it is useful.
- Jikan/MAL as anime fallback or enrichment where it is useful.

Do not treat TheTVDB as a provider in this plan. A TVDB ID may be preserved as an external alias/crosswalk if it is already present from imports or another provider's metadata, but the plan should not add TheTVDB as a direct data source.

Provider-qualified IDs should be the primary join surface. Bare numeric IDs must never be compared across providers. Title matching should be rare, explicitly low-confidence, and visible in audit output.

Loose example only:

```ts
type ProviderIdentityExample = {
  providers: {
    tmdb?: number;
    tvmaze?: number;
    imdb?: string;
    anilist?: number;
    mal?: number;
  };
  externalAliases?: {
    tvdb?: number;
  };
  matchConfidence?: "direct_id" | "bridged_id" | "verified_title" | "title_fallback";
};
```

This is not a required schema, API contract, or naming convention. It is only meant to show the intended separation between real providers, external aliases, and confidence. The implementation agent should inspect the current codebase and choose the actual storage/API shape that fits ShowTracker.

## Reconciliation Expectations

The default reconciliation model should be a complete library sweep.

It is acceptable if a full run takes tens of minutes for thousands of shows. Correct coverage matters more than clever prioritization. The system can chunk work, checkpoint progress, retry failures, and respect provider rate limits, but those are implementation details. They should not become a product-level tiering model where completed, paused, dropped, old, or low-traffic shows get weaker coverage.

The reconciliation run should refresh provider links, detect new episodes and seasons, compute latest released and next scheduled facts, and decide what changed since the last successful run. Its output to Convex should be small and change-based rather than a repeated full rewrite of app-facing data.

Near-instant freshness for every show is not required. A clear latest-reconciled timestamp and reliable full-library coverage are more important than minute-level freshness.

## Validation Expectations

The implementation agent must find a practical way to test the behavior, not just reason about the architecture.

Use real tracked or provider-backed shows where possible, especially cases that exercise the known failure modes: a globally airing show that is not in a US-only schedule, a show that becomes correct only after opening today, a completed show with newly released content, and an anime title with AniList/MAL/Jikan identity overlap.

When real provider data is hard to make deterministic, use simulated provider fixtures or seeded SQLite/Convex test data. The important requirement is that tests prove the intended behavior across Home, Watchlist, Schedule, reconciliation output, and audit output.

Validation should cover at least:

- Direct provider-ID match.
- Bridged provider-ID match.
- Global release event outside the default country.
- Future scheduled episode versus already released unwatched episode.
- Completed show re-entering attention because new content exists.
- Missing provider link appearing as an audit issue.
- Title fallback being marked low-confidence instead of silently trusted.

## App Behavior Goals

Home and Watchlist should not depend on opening a show detail page to become correct.

Schedule should show globally relevant tracked-show release events by default. A show should not disappear because the current schedule feed is US-only while the episode aired elsewhere.

Completed shows should re-enter attention when reliable evidence says new content exists. Plan-to-watch, paused, dropped, completed, and active states should use the same release facts rather than separate ad hoc logic.

Shows with future scheduled episodes should not be treated the same as shows with already released unwatched episodes. The app should distinguish "available now" from "upcoming".

## Audit And Failure Handling

Silent absence is not acceptable. If a tracked show cannot be linked to a schedule/release source, the system should record that as a health issue instead of simply showing nothing.

Audit output should make these cases inspectable:

- Missing provider links.
- Missing schedule or release source.
- Title-only matches.
- Conflicting provider IDs.
- Stale release facts or stale Convex projections.
- Reconciliation failures or skipped shows.

The goal is for these issues to be discovered by health checks before the user notices them manually.

## Non-Goals

This plan does not require a full migration away from Convex.

This plan does not replace SQLite with Postgres/MySQL unless server-side SQLite proves insufficient.

This plan does not add TheTVDB as a direct provider.

This plan does not require perfect coverage for every obscure title on day one.

This plan does not require the normal UI to expose provider-matching complexity to users.

This plan does not accept "less correct but cheaper" as the stable answer for release state. If correctness is too expensive inside Convex, move that work to the VPS reconciliation backend.

## Success Criteria

The goal is successful when:

- A tracked show can become correct on Home, Watchlist, and Schedule without being opened or searched first.
- Global release events are visible by default.
- Provider ID matches are the normal join path.
- Title-only matches are rare, low-confidence, and auditable.
- Missing provider links and missing release sources appear in health/audit output.
- Completed shows with new released content reliably re-enter attention.
- Future episodes and already released unwatched episodes are represented differently.
- Cost-saving changes no longer remove reconciliation coverage.
- The VPS backend can reconcile the full tracked library without making Convex absorb the full compute/read cost.
- Convex receives compact changed facts or deltas from reconciliation.
- Real or simulated validation proves the behavior against representative shows and failure cases.

## Implemented Workflow

The current implementation uses `scripts/schedule-confidence.mjs` as the local SQLite reconciler and `convex/scheduleConfidence.ts` as the compact Convex boundary.

Repeatable local/fixture validation:

```bash
npm run schedule-confidence:validate
```

Repeatable dev workflow after pushing Convex functions to the configured dev deployment:

```bash
npx convex dev --once --typecheck enable --tail-logs disable
npx convex env set SCHEDULE_CONFIDENCE_IMPORT_TOKEN <local-dev-token>
npm run schedule-confidence:dev:workflow
```

The dev workflow performs the full loop:

1. Seeds token-protected synthetic dev cases.
2. Snapshots synthetic rows from `shows`, `userShows`, `feedProjections`, and `scheduleCache`.
3. Resets local SQLite reconciliation tables.
4. Imports real dev `feedProjections` into SQLite through `scheduleConfidence:exportTrackedLibrary`.
5. Seeds deterministic synthetic provider events in SQLite.
6. Reconciles imported dev rows with real provider hydration enabled.
7. Exports compact delta JSON with no local-only projection simulation fields.
8. Applies deltas back to dev Convex through `scheduleConfidence:applyReleaseDeltas`.
9. Snapshots the same Convex tables again and asserts the synthetic edge cases.

The command writes local ignored evidence files under `.schedule-confidence/`:

- `dev-workflow-report.json`
- `dev-before-snapshot.json`
- `dev-after-snapshot.json`
- `dev-convex-deltas.json`
- `dev-audit-report.json`

## Dev Validation Evidence

Last verified on May 14, 2026 against dev deployment `dev:resolute-lion-293`; production was not used.

Convex push/env:

- `npx convex dev --once --typecheck enable --tail-logs disable` completed with Convex functions ready.
- `npx convex env set SCHEDULE_CONFIDENCE_IMPORT_TOKEN <local-dev-token>` completed successfully for dev.

Full dev workflow:

- `npm run schedule-confidence:dev:workflow`
- Imported tracked dev rows: `619`
- SQLite provider events seeded for synthetic cases: `8`
- Reconciled rows: `619`
- Changed release facts: `541`
- Exported compact Convex deltas: `541`
- Real provider fetch errors: `0`
- SQLite audit issues: `80`
- Delta apply batches: `22`
- Delta apply totals: `532` matched shows, `532` patched shows, `86` patched user shows, `532` patched feed projections, `28` schedule cache rows updated, `1` completed show resumed, `1` title fallback skipped.

The exported dev delta payload only contains compact release/projection inputs:

```text
canonicalKey, latestReleased, matchConfidence, mediaType, nextScheduled,
providerIds, reconciledAt, releaseState, releasedEpisodes, sourceProvider,
title, totalEpisodes
```

It does not contain the local-only `simulatedProjection` field.

SQLite audit output contained:

- `78` missing provider link issues.
- `1` title fallback match issue.
- `1` conflicting provider IDs issue.

Synthetic before/after checks covered:

- Direct provider ID match: `SC Synthetic Direct Provider Match` changed from `releasedEpisodes=4`, `remainingEpisodes=0`, no signal, to `releasedEpisodes=5`, `remainingEpisodes=1`, with `newEpisodeSignalAt`.
- Bridged provider ID match: `SC Synthetic Bridged Provider Match` gained `tvmazeId=992002`, `totalEpisodes=3`, and a `scheduleCache` entry for `2026-05-15` episode 3.
- Global non-US release: `SC Synthetic Global Web Release` changed to `releasedEpisodes=8`, `remainingEpisodes=1`, with `newEpisodeSignalAt`.
- Future upcoming versus available now: `SC Synthetic Future Anime` kept `releasedEpisodes=10`, no `newEpisodeSignalAt`, and gained a `scheduleCache` entry for `2026-05-20` episode 11.
- Completed/old show resurfacing: `SC Synthetic Completed Old Show Returns` changed from `status=completed`, `completedAt` set, `remainingEpisodes=0`, to `status=watching`, `completedAt=null`, `remainingEpisodes=1`, with `newEpisodeSignalAt`.
- Missing provider link audit: `SC Synthetic Missing Provider Link` stayed unchanged in Convex and was reported as `missing_provider_link`.
- Title-only fallback audit: `SC Synthetic Title Fallback Only` stayed unchanged in Convex, was reported as `title_fallback_match`, and was skipped by delta apply.
- Conflicting provider data audit: `SC Synthetic Conflicting Provider Audit` was reported as `conflicting_provider_ids`.
- Stale Convex projection repair: `SC Synthetic Stale Projection Repair` changed from `totalEpisodes=20`, `remainingEpisodes=0`, no signal, to `totalEpisodes=21`, `remainingEpisodes=1`, with `newEpisodeSignalAt`.

Manual Convex target checks:

- `npx convex run shows:refreshCompletedShowsForNewEpisodes "{}"` returned `scannedUserShows=45`, `candidateShows=7`, `attemptedRefreshes=7`, `skippedFresh=7`, `failedRefreshes=0`, confirming the old completed-show refresh did not need to redo provider work immediately after delta apply.
- `npx convex run schedule:runMonthlyHomeWatchlistScheduleSignalBackfill "{}"` returned `skipped=true`, `reason=already_completed`, `month=2026-04`, confirming the monthly Convex schedule sweep is no longer the primary reconciliation path.
- `npx convex run shows:dailyReconcileProjections "{}"` returned `usersRebuilt=1`, `backfillRounds=2`; the follow-up synthetic snapshot still preserved the delta-applied `shows`, `userShows`, `feedProjections`, and `scheduleCache` results.

Additional validation:

- `npm run schedule-confidence:validate` passed `9` fixture assertions with `7` library fixtures, `6` provider events, `6` compact deltas, and `2` audit issues.
- `npx expo lint` exited successfully.

## Decision Rule

When lower backend usage conflicts with release-state correctness, choose correctness first. If the correct answer is expensive inside Convex, move the work to the self-hosted reconciliation layer with predictable cost instead of weakening product behavior.

Use this document as the goal and guardrails. A capable implementation agent should still inspect the current codebase and choose integration details that fit the existing ShowTracker architecture.
