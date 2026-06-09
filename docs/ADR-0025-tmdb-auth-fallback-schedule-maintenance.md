# ADR-0025: TMDB Auth Fallback Keeps Schedule Maintenance Running

## Context

On June 9, 2026, production Schedule showed Detective Conan `S01E1204` on June 8, 2026, and Home/Watchlist kept Detective Conan active even though the user was caught up at `1203/1203`.

Production `scheduleCache` contained stale TMDB rows for Detective Conan:

- `S01E1203` on June 6, 2026.
- `S01E1204` on June 8, 2026.
- later predicted rows through June 2026.

Current TMDB data for `tmdb:tv:30983` said the latest aired episode was `S01E1202` on May 30, 2026, the next episode was `S01E1203` on June 13, 2026, and the season contained 1203 episodes. The existing ADR-0005/ADR-0007 pruning path should have moved or removed the stale rows.

The schedule-confidence job did not emit those deltas when `EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN` was present but rejected by TMDB. The same environment also had a working `EXPO_PUBLIC_TMDB_API_KEY`, but the script selected the bearer token first and treated its auth failure as a provider failure.

## Current Behavior

Before this change:

- TMDB provider fetches used the bearer token whenever it was non-placeholder.
- The API key was used only when no bearer token was configured.
- A rejected bearer token caused every TMDB-backed tracked row to miss provider facts in that run.
- Without provider facts, no `clearStaleEpisodeSignal` or `scheduleCacheMaintenance` delta was emitted for Detective Conan.
- Stale `scheduleCache` rows were then projected and read by Home/Schedule.

## Decision

The schedule-confidence TMDB fetcher now builds ordered auth candidates instead of a single auth choice.

When both TMDB credentials are configured:

- try bearer auth first;
- if the response is a retryable auth failure (`401` or `403`), retry the same TMDB request flow with the API-key candidate;
- preserve non-auth provider errors as real failures.

The validation fixtures include a fake TMDB flow where bearer auth returns `401` and API-key auth succeeds, proving that release metadata and next-episode facts still load.

## Reasoning

This keeps ADR-0012's bearer support without letting one stale credential disable the external reconciliation layer.

The existing cache-maintenance logic was already sufficient for Detective Conan once TMDB facts loaded. The correct fix is to keep trusted provider facts flowing, not to add title-specific exceptions or hide caught-up schedule rows in the app.

Retrying only auth failures avoids masking real TMDB outages, malformed responses, or provider-data conflicts. Those should still be visible as provider fetch failures in the audit report.

## Provider/Data Assumptions

TMDB bearer auth and API-key auth are equivalent sources for the same TMDB API data. Falling back between them changes access credentials, not provider authority.

The API-key fallback is attempted only when it is configured and non-placeholder.

TMDB facts remain scoped to TMDB provider IDs such as `tmdb:tv:30983`. This does not broaden title matching or allow TMDB facts to prune unrelated provider rows.

## Edge Cases

If both TMDB credentials fail with auth errors, the run still records provider failures and emits no TMDB facts.

If bearer auth succeeds, the API key is not used.

If bearer auth returns a non-auth error, the script does not retry with API-key auth because the issue may be provider availability or response shape rather than credentials.

Long-running shows still rely on provider-backed latest/next episode facts. This change only ensures the reconciler can fetch those facts when one credential is stale.

## Verification

Production diagnosis before the change:

- `scheduleCache` for June 2026 contained Detective Conan `S01E1204` on June 8, 2026.
- `feedProjections` for Detective Conan had `watchedEpisodesCount: 1203`, `totalEpisodes: 1203`, `remainingEpisodes: 0`, and `newEpisodeSignalAt: 2026-06-08T00:00:00.000Z`.
- Direct TMDB API-key fetch for `tv/30983` returned latest `S01E1202` on May 30, 2026, next `S01E1203` on June 13, 2026, and no `S01E1204`.
- A provider reconcile with the bearer credential selected produced 540 provider fetch failures and zero deltas.
- A provider reconcile with the bearer skipped and API key used emitted a Detective Conan delta with `clearStaleEpisodeSignal: true` and `scheduleCacheMaintenance: true`.

Local checks:

- `node --check scripts/schedule-confidence.mjs`
- `npm run schedule-confidence:validate`
- `node --no-warnings=ExperimentalWarning scripts/schedule-confidence.mjs reconcile --fetch-providers --now-ms 1780977600000` against production import now emits TMDB facts with the configured fallback path.

Production rollout checks:

- Apply the release deltas and schedule-cache maintenance before regenerating user schedule projections.
- Verify Schedule no longer shows Detective Conan `S01E1204` on June 8, 2026.
- Verify Home/Watchlist no longer keeps Detective Conan active from the stale June 8 signal.

## Rollback Notes

If TMDB fallback causes unexpected provider data, remove the fallback retry and restore single-candidate auth selection.

If stale schedule rows remain after rollback, rerun schedule-confidence with a known-good TMDB credential and inspect `scheduleCacheMaintenanceVersion`, `scheduleConfidence.applyReleaseDeltas`, and projection regeneration before changing app read filters.
