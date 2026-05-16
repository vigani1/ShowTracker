# ADR 0005: Server-Owned Schedule Refresh and Moved Episode Pruning

## Status

Accepted

## Context

The Schedule tab can show stale schedule-cache rows when a provider changes a date after an earlier weekly prediction. The motivating example is Detective Conan episode 1202: the app showed it on Saturday, May 16, 2026, while the show detail episode list showed May 30, 2026. The likely provider story is a broadcast break: May 16 was a normal weekly expectation, but the current provider schedule moved the episode to May 30.

The product can tolerate up to one day of schedule staleness for rare break/postponement cases. The app should not spend Convex action compute, provider calls, and schedule-cache write I/O on user-triggered refreshes just to correct those rare cases immediately.

This is high-risk schedule behavior under the project rule because it changes how stale schedule-cache rows are corrected for the Schedule calendar, selected-day rows, same-day Home attention, and future watchlist counts.

## Current Behavior

Before this change:

- `scripts/ops/run-schedule-confidence.sh` ran the external nightly schedule-confidence workflow:
  - `npm run schedule-confidence:import`
  - `npm run schedule-confidence:reconcile:providers`
  - `npm run schedule-confidence:audit`
  - `npm run schedule-confidence:apply`
- The external reconciler could fetch current provider schedule facts and apply compact deltas to Convex.
- `scheduleConfidence.applyReleaseDeltas` could add the corrected future schedule row, such as Detective Conan episode 1202 on May 30.
- `scheduleConfidence.applyReleaseDeltas` only pruned stale entries on the same date being written.
- If a provider moved the same episode from May 16 to May 30, the nightly run could add May 30 while leaving the stale May 16 row behind.
- Home and Schedule app queries only read existing Convex schedule cache/projection data.

## Decision

Keep routine schedule freshness owned by the external nightly backend job, not by user-triggered Convex actions.

The app should not hydrate schedule provider data when Home or Schedule opens. Convex app queries remain read-only against existing schedule cache/projection state, accepting that rare break/postponement corrections may be stale until the next nightly run.

The fix is in `scheduleConfidence.applyReleaseDeltas`: when the nightly server applies a provider delta for a show, it now prunes moved schedule-cache entries for the same durable provider identity and same episode across nearby dates. If the current provider fact says episode 1202 is on May 30, stale cache entries for that same provider identity and episode 1202 on nearby dates such as May 16 are removed during the apply step.

The pruning window is intentionally bounded. It scans nearby schedule-cache buckets for the same media type and same durable show identity, not the whole schedule cache.

## Reasoning

User-triggered hydration would reduce staleness faster, but it pushes provider fetching and cache writes into normal app usage. That is the wrong cost shape for a rare problem when one day of staleness is acceptable.

The nightly server workflow is already the correct owner of provider reconciliation. It can fetch providers once in a controlled batch, audit the result, and apply compact deltas to Convex. Fixing moved-episode pruning at the apply boundary makes that nightly workflow complete: it adds the corrected date and removes the stale old date.

Pruning by same durable show identity and same episode is safer than deleting all future rows for the show. Long-running shows can have multiple nearby future episodes, and schedule providers can be incomplete. The moved-row rule only removes entries that conflict with the provider's current date for the same episode number or same episode name. Title-only rows are intentionally not used for cross-date pruning because two unrelated shows can normalize to the same title.

## Provider And Data Assumptions

- AniList is trusted for anime next-airing facts when a current schedule fact is available.
- TVMaze is trusted for TV episode schedule facts when a current episode list is available.
- TMDB remains the main TV/movie detail source when a TMDB route is available.
- Show detail episode dates can be fresher than stale `scheduleCache` rows because detail metadata is fetched through a separate path.
- Title fallback remains lower confidence than provider IDs and is not expanded by this change. It is intentionally blocked from moved-row pruning.
- When provider data moves an episode because of a break, the nightly provider delta should replace stale schedule-cache rows for that same episode.

## Edge Cases

- Completed shows with new releases can still reappear after nightly deltas update released counts and `newEpisodeSignalAt`.
- Paused and dropped shows remain subject to existing Schedule visibility and Home attention rules; this change does not promote them.
- Planned/not-started shows are not promoted to active Home attention just because the schedule cache refreshed.
- Long-running shows such as Detective Conan can have provider totals and episode dates that move independently; moved-episode pruning uses episode identity, not total counts.
- Anime season aliases remain handled by the existing conservative AniList/anime fallback logic.
- Missing providers still fall back only through existing matching rules.
- Title fallback is intentionally blocked from broad TV/anime cross-matching and from cross-date moved-row pruning.
- Same-day duplicate episodes still pass through the existing same-date collapse logic.
- Future weekly rows are corrected by the nightly apply step, not by app opens.
- Stale provider totals are still possible; this change repairs schedule-cache facts, not every show detail total-episode model.

## Verification

Provider checks performed on May 16, 2026:

- AniList search for Detective Conan returned `nextAiringEpisode.episode = 1202` and `airingAt = 1780131600`, which is May 30, 2026 at 09:00 UTC.
- AniList airing schedule for May 16, 2026 did not include Detective Conan.
- AniList airing schedule for May 30, 2026 included Detective Conan episode 1202.
- TVMaze's Meitantei Conan episode list showed the latest listed 2026 row as May 2, 2026, so the May 16 app row was not supported by TVMaze either.

Code verification for this change:

```powershell
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npx expo lint
git diff --check
npx convex deploy --dry-run --yes
```

No local Expo or Convex dev server was started.

## Rollback Notes

If nightly apply starts removing valid schedule rows, revert the moved-episode pruning helper in `convex/scheduleConfidence.ts`. The nightly workflow will still add corrected rows, but stale moved rows may remain until manually repaired.

If stale moved rows return, inspect `scheduleConfidence.applyReleaseDeltas`, `upsertScheduleCacheEntry`, and the external `schedule-confidence:reconcile:providers` provider fetches before changing app Schedule queries.

If duplicate rows appear after nightly apply, inspect the existing `findTrackedScheduleMatch`, `shouldCollapseSameTrackedShowDay`, and `shouldPreferSameTrackedShowDayEpisode` logic. Do not broaden title matching as a rollback.
