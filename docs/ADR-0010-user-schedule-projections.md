# ADR-0010: User-Specific Schedule Projections

## Context

The US Convex deployment showed that normal app usage is dominated by reactive schedule reads. The most expensive reads are not returning large payloads to the client; they are repeatedly scanning global `scheduleCache` rows, parsing provider episodes, matching them against the current user's tracked shows, and deduping the result for every subscribed client.

This is especially visible in:

- Home future watchlist counts.
- The Schedule tab upcoming view.
- The same-day Home scheduled-watchlist bridge.

Those paths are sensitive because they affect active, paused, completed, and not-started watchlist rows; future weekly schedule rows; same-day schedule attention; duplicate prevention; and provider identity matching.

## Current Behavior

Before this change, each reactive schedule query rebuilds user-specific answers from global facts:

- Home asks for future counts across a 90-day window.
- Convex reads the user's TV/anime feed projections.
- Convex reads global schedule-cache rows for the requested date range.
- Convex parses cached provider episode blobs.
- Convex matches provider rows to the user's tracked rows by provider IDs, then conservative title fallback.
- Convex dedupes same-day and cross-provider rows.
- The same-day Home bridge also reads watched episode rows for candidate shows so already-watched episodes do not surface.

The logic is correct but expensive because every client subscription repeats the global scan. The external schedule-confidence backend already runs on the private server, owns provider reconciliation, and applies compact deltas into Convex, so it is the right place to perform the repeated matching work once per user.

## Decision

Add compact, user-specific projection tables in Convex:

- `userScheduleEvents` stores per-user schedule rows for a bounded generated window.
- `watchlistFutureCountProjections` stores per-user Home future-count rows for the exact generated count window.
- `userScheduleProjectionWindows` records which schedule/count windows were generated, including zero-result coverage.

Production inspection on May 18, 2026 found empty existing tables named `userScheduleEvents`, `userScheduleProjectionWindows`, `watchlistFutureCountProjections`, and `userScheduleProjections`. This change adopts the first three names with explicit schema and indexes. The empty `userScheduleProjections` table is left untouched because it is not needed for this design and contains no production documents.

The private schedule-confidence backend generates those rows from imported `feedProjections` and the Convex `scheduleCache` window after release deltas are applied, then calls a token-protected Convex mutation to atomically replace one user's projection set.

Projection-only apply is blocked when local SQLite still has unapplied release deltas. The full `apply-convex` workflow applies release deltas first, which brings Convex `scheduleCache` forward, and then applies projections. This prevents a projection seed from showing newer backend provider rows while the old fallback path is still reading older Convex schedule-cache rows.

The `apply-convex` workflow stamps projection coverage after release deltas finish. This matters because release-delta mutations update `feedProjections.updatedAt`; using the older reconcile timestamp for the projection window would make freshly applied projection rows fail their own freshness guard and fall back immediately.

The backend deliberately projects from Convex `scheduleCache`, not directly from fresher local provider events, for production reads. Local provider events can contain richer episode names, timezone precision, and extra future rows that the current app has not previously shown. Keeping the projection source aligned with `scheduleCache` preserves day-to-day Schedule and Watchlist behavior while still moving the repeated per-user matching work off reactive Convex reads.

Convex schedule reads use projections only when coverage says the requested window is generated and the user's relevant feed projections have not changed since generation. If coverage is missing or stale, the reads fall back to the existing schedule-cache scan.

Upcoming Schedule and future-count reads verify projected rows still point at current feed projections before returning them. Today's Home scheduled-watchlist read also hydrates current feed projections and exact watched episode rows for the projected candidates so status/progress changes remain current.

Home future counts are computed from user-specific projected event rows at read time instead of trusting static count rows for same-day availability. This keeps "future before airtime" and "available after airtime" behavior aligned with the previous live query while still avoiding the global schedule-cache scan.

## Reasoning

This moves the expensive global scan and provider matching off the reactive read path while preserving the existing behavior as a fallback. The read-time cost becomes proportional to one user's projected rows, not the full schedule cache for the date range.

The coverage table is important. Without it, an empty projection read could mean either "no schedule rows for this user" or "backend has not generated this window yet." Treating those cases differently avoids both hidden schedule regressions and unnecessary fallback scans for users with no matching rows.

The freshness guard handles track, untrack, status, and progress changes between backend runs. If user tracking state is newer than the projection window, Convex uses the old live path until the backend regenerates projections.

Keeping exact watched-episode filtering in Convex for today's Home rows avoids stale attention cards. The backend projection can say an episode exists for a tracked show, but Convex must still check whether the current user already watched that exact season/episode before surfacing the row.

The old scan path remains intentionally present during rollout. It protects watchlist and schedule behavior if the external backend is delayed, if a user's projection window is not generated yet, or if a future provider edge case is found.

## Provider/Data Assumptions

Provider IDs remain the trusted match source. Anime prefers AniList, then MAL/Jikan. TV prefers TMDB, then TVMaze, then IMDb route fallback. Title fallback remains low-confidence and auditable; it is allowed for display projection rows because the existing Schedule/Home behavior already uses conservative title fallback, but release metadata mutation still skips title-fallback deltas.

The backend projection generator uses imported `feedProjections` as the user tracking source and the post-delta Convex `scheduleCache` window as the schedule source. It does not mutate watch status or episode progress. It only materializes display/read projections.

Schedule dates are UTC date keys. Provider timestamps are kept as `airtimeMs` for sorting and for same-day available/future count classification.

## Edge Cases

Completed shows with new releases keep relying on existing release-delta and projection refresh logic; this change does not decide whether a completed show reactivates. Today's Home scheduled bridge still checks current status and exact watched episodes before returning a row.

Paused, dropped, planned/not-started, and completed rows remain present in schedule/future-count projections because the current future-count query also computes counts independently of Home section filtering.

Long-running shows are bounded by the generated date window, not by full historical provider episode lists. Same-day duplicate episodes and cross-provider duplicates are deduped before projection rows are written.

Same-day future episodes are classified using the current read time from projected events, not from a stale nightly count snapshot.

Anime season aliases and title fallbacks are treated conservatively. Missing provider rows produce no projection events; if coverage is missing the old schedule-cache scan still runs.

Future weekly rows are covered by the generated schedule window. If the UI asks outside that window, Convex falls back to the old global scan.

## Verification

Required static checks:

- `npm run schedule-confidence:validate`
- `npx convex codegen`
- `npx tsc --noEmit`
- `npx expo lint`
- `npx convex deploy --dry-run --yes`
- `npx convex data --prod --limit 1`
- `npx convex data --prod userScheduleEvents --limit 3 --format json`
- `npx convex data --prod userScheduleProjectionWindows --limit 3 --format json`
- `npx convex data --prod watchlistFutureCountProjections --limit 3 --format json`
- `npx convex data --prod userScheduleProjections --limit 3 --format json`

Production rollout checks on May 18, 2026:

- `npx convex deploy --yes` deployed the schema, indexes, and functions to `https://harmless-shrimp-263.convex.cloud`.
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs import-convex --db .schedule-confidence/prod-us-projections.sqlite --convex-url https://harmless-shrimp-263.convex.cloud` imported 541 current tracked projection rows into an isolated local SQLite DB.
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs reconcile --db .schedule-confidence/prod-us-projections.sqlite --deltas .schedule-confidence/prod-us-convex-deltas.json --fetch-providers` reconciled those rows with no provider fetch errors.
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs compare-schedule-projections --db .schedule-confidence/prod-us-projections.sqlite` initially caught a parity gap: the projection generator was using per-item release-fact matching and missed provider rows that the old global schedule scan would include. The generator was changed to the legacy schedule-scan matching model.
- After that fix, the same compare command returned no missing/extra event or count keys for schedule dates `2026-05-04` through `2026-09-15` and count dates `2026-05-18` through `2026-08-16`.
- A direct production Convex-data comparison then showed the corrected projection rows did not match current production `scheduleCache`, because the 540 release deltas from the isolated reconcile had not been applied. This was a rollout-order problem, not a projection matching problem.
- The projection-only apply command now refuses to run while unapplied release deltas exist, unless an explicit `--allow-unapplied-deltas` override is passed for an intentional rollback/test.
- The one-off production projection seed was disabled with `scheduleConfidence.replaceUserScheduleProjectionWindow` using `generatedAt: 0`, deleting 243 `userScheduleEvents`, 48 `watchlistFutureCountProjections`, and replacing the coverage row with a stale marker. That makes production reads fall back to the old schedule-cache path until the full release-delta-plus-projection workflow runs.
- Follow-up `npx convex data --prod` spot checks confirmed `userScheduleEvents` and `watchlistFutureCountProjections` are empty and the coverage row has `projectionUpdatedAt: 0`.
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs apply-convex --db .schedule-confidence/prod-us-projections.sqlite --deltas .schedule-confidence/prod-us-convex-deltas.json --convex-url https://harmless-shrimp-263.convex.cloud --batch-size 1 --run-id prod-us-release-plus-projections-2026-05-18` applied the 540 direct-ID release deltas first and then inserted 243 projection events, 48 future-count rows, and one coverage row.
- That full apply exposed the timestamp ordering requirement above: release-delta patches made `feedProjections.updatedAt` newer than the original reconcile timestamp, so projection coverage must be stamped after release deltas complete.
- A second direct production Convex-data comparison showed provider-event projections still differed from the old `scheduleCache` read behavior after release deltas because local provider events had richer/fresher episode rows for some titles. Projection generation was changed to fetch the post-delta Convex `scheduleCache` window and project from that source.
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs apply-schedule-projections --db .schedule-confidence/prod-us-projections.sqlite --convex-url https://harmless-shrimp-263.convex.cloud --run-id prod-us-schedule-cache-projections-2026-05-18` then inserted 205 projection events, 50 static count rows, and one fresh coverage row from the schedule-cache source.
- The final production old-flow vs new-flow comparison returned 205 old schedule events and 205 projected schedule events with zero missing/extra keys for `2026-05-04` through `2026-09-15`. The read-time future-count comparison returned 25 old count rows and 25 projected count rows with zero missing/extra keys for `2026-05-18` through `2026-08-16`.
- The final freshness check showed max TV/anime `feedProjections.updatedAt` `1779076613502` and projection-window `projectionUpdatedAt` `1779077022059`, so the projection path is active rather than self-stale.

Known behavior checks:

- A fixture direct provider-ID match should generate schedule events and count rows.
- A fixture future anime episode should generate a future count without Home available attention.
- A title-fallback fixture should remain auditable and should not become a trusted release mutation.
- A user with projection coverage but zero matching rows should return an empty projection result without scanning global schedule cache.
- If a user tracks/untracks or changes progress after projection generation, the freshness/current-projection guard should keep the old live path or filter stale rows until the next backend run.

## Rollback Notes

Rollback can be done in two layers:

- Disable backend projection apply with the schedule-confidence apply flag if projection rows look wrong.
- If projection rows are accidentally applied before release deltas, call `scheduleConfidence.replaceUserScheduleProjectionWindow` with empty `events`, empty `counts`, and `generatedAt: 0` for the affected user/window. The stale coverage row forces reads back to the schedule-cache fallback path because current `feedProjections.updatedAt` is newer than `0`.
- Revert the projection read paths and schema/mutation if Home watchlist or Schedule behavior regresses.

During rollback, watch Home active rows, same-day scheduled rows, future watchlist counts, Schedule weekly/month rows, completed-show reactivation, paused/dropped rows, long-running shows, and anime season aliases.
