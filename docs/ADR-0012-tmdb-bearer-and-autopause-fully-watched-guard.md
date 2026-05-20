# ADR-0012: TMDB Bearer Auth and Fully Watched Auto-Pause Guard

## Context

On May 20, 2026, production checks showed three connected regressions:

- The `autoPauseInactiveShows` cron moved four fully watched watchlist rows into the Paused queue: The Amazing Digital Circus, The Grim Adventures of Billy and Mandy, Aoashi, and Dark Matter.
- TMDB detail routes such as `/show/tmdb:tv:76479`, `/show/tmdb:tv:274671`, `/show/tmdb:tv:117465`, and `/show/tmdb:tv:82684` failed with the generic show-detail error.
- The private schedule-confidence backend reported many `provider_fetch_failed` warnings with gzip bytes being parsed as JSON.

The product risk is that normal watchlist usage looks broken even though Convex projection/fallback usage is healthy.

## Current Behavior

Before this change, the browser TMDB client preferred `api_key` query authentication when both TMDB credentials were available. TMDB returned `200` responses for the affected IDs, but the response body was still gzip-compressed when `response.json()` read it. The same auth preference existed in `scripts/schedule-confidence.mjs`, so the server reconciler saw the same compressed bytes and logged provider warnings.

The Convex auto-pause cron queried stale `watching` rows by last-watched time and skipped fully watched shows only when the provider lifecycle was not terminal. That meant a fully watched row for an ended or finished show could still be auto-paused if the user row was `watching` instead of `completed`.

## Decision

Prefer TMDB bearer-token authentication over `api_key` query authentication when a bearer token is configured. Keep `api_key` as a fallback for environments that only have that credential.

Make the server schedule-confidence fetch helper tolerate gzip bytes defensively before parsing JSON. This keeps provider reconciliation from failing if an upstream response arrives compressed.

Change auto-pause so it skips any non-movie user show that has watched episodes greater than or equal to a known positive episode total. The cron now returns `skippedFullyWatchedCount` for observability.

## Reasoning

Bearer authentication fixed all four affected TMDB route examples in browser verification while keeping requests outside Convex. That is safer for Convex usage than moving show-detail loading into Convex actions or queries.

The gzip-tolerant server parsing is a defensive backstop for the private backend. It does not move work back into Convex and should reduce noisy provider warnings on nightly runs.

Auto-pause should represent inactive unfinished watching, not a fully consumed title. Fully watched known-total rows are already a terminal-or-caught-up state from a user perspective. Pausing them creates a misleading queue and can make completed/caught-up titles look like chores.

## Provider/Data Assumptions

TMDB bearer tokens are trusted for TV/movie detail and search requests when present. TMDB API keys remain valid fallback credentials but are not preferred because the observed `api_key` path returned undecoded gzip bodies.

Provider IDs remain unchanged: TV/movie detail routes still prefer TMDB route IDs, TVMaze remains a fallback only where the existing detail flow already uses it, and IMDb route bridging remains unchanged.

The auto-pause guard trusts the stored `shows.totalEpisodes` as a bounded known total only when it is a positive number. If the total is missing, the existing inactivity behavior remains.

## Edge Cases

Completed shows with new releases are still handled by release deltas and completed-show reactivation logic. This change only prevents the inactivity cron from pausing a fully watched known-total row.

Paused or dropped shows are unchanged because the cron only scans `watching` rows.

Planned/not-started shows are unchanged because they are not scanned by the cron.

Long-running shows with partial progress, such as Gintama or JoJo's Bizarre Adventure, can still be auto-paused when they have watched less than the known total.

Anime season aliases and related anime behavior are unchanged. TMDB-backed anime rows still open through TMDB TV routes when that is the stored route identity.

Same-day duplicate episodes, future weekly rows, stale provider totals, title fallback, and schedule-cache merges are unchanged.

## Verification

Before the patch, a browser-context fetch using TMDB `api_key` auth returned `200` but failed JSON parsing for:

- `tmdb:tv:76479` The Boys
- `tmdb:tv:274671` The Beginning After the End
- `tmdb:tv:117465` Hell's Paradise
- `tmdb:tv:82684` That Time I Got Reincarnated as a Slime

The same browser-context check using bearer auth returned `200` JSON with the expected titles for all four IDs.

Production Home feed inspection with the user's identity showed the four newly auto-paused rows had `autoPausedAt: 1779237900020`, `remainingEpisodes: 0`, and `progressPercent: 100`.

Required local checks:

- `npx tsc --noEmit`
- `npx convex deploy --dry-run --yes`
- A server-side TMDB probe using bearer auth for the four affected route IDs.

Operational checks after deployment:

- Open the four TMDB detail routes from the watchlist and verify the detail panel loads.
- Check the next `autoPauseInactiveShows` cron result for a nonzero `skippedFullyWatchedCount` if stale fully watched `watching` rows exist.
- Check the next schedule-confidence audit for a large drop in TMDB `provider_fetch_failed` gzip warnings.

## Rollback Notes

If TMDB bearer auth causes CORS or rate-limit issues, revert the auth preference in `lib/api/tmdb.ts` and `scripts/schedule-confidence.mjs`, then consider a non-Convex Netlify/VPS proxy that handles gzip decoding.

If auto-pause stops pausing genuinely unfinished inactive rows, revert only the `hasWatchedKnownEpisodeTotal` guard and watch the Paused queue for fully watched rows reappearing.

During rollback, watch Home active rows, Paused queue rows, completed/caught-up rows, route IDs, and nightly schedule-confidence provider warning counts.
