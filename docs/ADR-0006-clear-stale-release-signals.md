# ADR-0006: Clear Stale Release Signals From Server Reconciliation

## Context

Detective Conan exposed a second break-week failure after ADR-0005. The server-owned schedule-confidence run corrected the trusted release fact to `releasedEpisodes: 1201`, `totalEpisodes: 1202`, and `nextScheduled.airDate: 2026-05-30`, but the imported Convex feed projection still had an older `newEpisodeSignalAt` for May 16, 2026. Home treats `newEpisodeSignalAt > lastWatchedAt` as attention-worthy, so a stale signal can keep a caught-up show visible even when `remainingEpisodes` is `0`.

## Current Behavior

Before this change, `scripts/schedule-confidence.mjs` imported `remainingEpisodes` and `newEpisodeSignalAt` from `scheduleConfidence:exportTrackedLibrary`, but discarded them in SQLite. `convex/scheduleConfidence.ts::applyReleaseDeltas` only set `newEpisodeSignalAt` when the trusted release count showed an unwatched released episode. It did not clear an old signal when the trusted release count later showed the user was caught up.

That left a gap for already-correct release facts. A later nightly run could report `changedFacts: 0` and `deltas: 0`, while the stale projection signal remained in Convex.

## Decision

The external server reconciler now stores imported `remainingEpisodes` and `newEpisodeSignalAt` in `library_items`. During reconciliation, if a direct/bridged trusted fact says `watchedEpisodesCount >= releasedEpisodes` and the imported projection still has `newEpisodeSignalAt > lastWatchedAt`, the reconciler emits a targeted `clearStaleEpisodeSignal` delta.

Convex applies that delta by clearing `userShows.newEpisodeSignalAt`, then rebuilding the affected `feedProjections` row from the corrected show and user-show state. The existing future schedule-cache row remains in place.

## Reasoning

This keeps the expensive work on the server and avoids a broad Convex repair. Convex only receives compact deltas for rows with provider-backed facts and stale attention signals. It does not scan all watchlist rows and does not run on app open.

Clearing the source `userShows.newEpisodeSignalAt` is safer than only patching `feedProjections`, because future projection rebuilds copy that field from the user-show row. The server emits a maintenance delta even when the release fact checksum is unchanged, so stale signals from previous runs can be repaired without waiting for a provider fact to change again.

## Provider/Data Assumptions

Signal clearing is allowed only after a provider-qualified fact is built. Direct provider IDs and bridged IDs are trusted. Title-only fallback rows are still audited and skipped by Convex apply. Missing-provider rows are not used to clear watchlist attention.

For Detective Conan, the trusted server fact is TMDB ID `30983` with IMDb `tt0131179`: episode 1201 released on May 9, 2026, episode 1202 scheduled for May 30, 2026.

## Edge Cases

Completed shows with new releases still resume when `watchedEpisodesCount < releasedEpisodes`.

Paused, dropped, planned, and not-started rows do not get stale-signal clearing unless they already have trusted provider facts and a stale signal. Home filtering continues to exclude paused/dropped rows independently.

Long-running shows and sparse provider histories still use the existing conservative released-count logic before any signal clear is considered.

Anime season aliases and provider bridges remain ID-gated. Title fallback is intentionally blocked from Convex mutation.

Same-day duplicate episodes are unaffected because this change only clears old attention when the trusted released count says no released unwatched episode exists.

Future weekly rows remain in `scheduleCache`; only Home attention is cleared. This preserves Schedule for known future episodes such as Detective Conan episode 1202 on May 30, 2026.

Stale provider totals are handled by the existing reconciliation traps. This change does not trust a lower provider count unless the reconciler already accepted it as the current release fact.

## Verification

Ran `npm run schedule-confidence:validate`; fixture coverage now includes `Stale Signal Break`, which has a stale May 16 signal, `watchedEpisodesCount: 1201`, `releasedEpisodes: 1201`, and a future May 30 episode. The fixture asserts a targeted `clearStaleEpisodeSignal` delta with `remainingEpisodes: 0`.

Ran `npx tsc --noEmit --pretty false`.

On the production server before this fix, `scheduleConfidence:exportTrackedLibrary` showed Detective Conan with `remainingEpisodes: 0` but `newEpisodeSignalAt: 1778922000000`, confirming the stale attention signal was the remaining issue after ADR-0005.

## Rollback Notes

Rollback `convex/scheduleConfidence.ts` and `scripts/schedule-confidence.mjs` changes from this ADR if Home starts hiding genuinely available episodes. Watch `clearedStaleEpisodeSignals`, `patchedFeedProjections`, and manual checks for long-running shows with known break weeks. If rollback is needed, schedule freshness from ADR-0005 can remain deployed, but stale signals may need manual clearing.
