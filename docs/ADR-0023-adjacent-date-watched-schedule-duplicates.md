# ADR-0023: Adjacent-Date Watched Schedule Duplicates

## Status

Accepted

## Context

On June 4, 2026, Classroom of the Elite stayed in Home watchlist attention after the user marked the visible current episode as watched. The Schedule page also showed the same generic episode on two dates:

- June 3, 2026: `tmdb:tv:72517`, source `tvmaze`, direct tracked-source match, `S04E13`, `Obscured by the Rain`, date-only `2026-06-03`.
- June 4, 2026: `tmdb:tv:72517`, source `anilist`, title-fallback anime source, `S01E13`, `Episode 13`, `2026-06-04T12:30:00.000Z`.

The watched row matched the tracked TV episode shape, so the direct TVMaze `S04E13` row was recognized as watched. The AniList title-fallback `S01E13` row used anime season-local numbering and was one day later, so the watched filter did not recognize it. Because ADR-0020 only suppressed watched duplicates inside `tracked show + same date` groups, the adjacent-day AniList copy survived and continued to feed Schedule, same-day Home schedule attention, future watchlist counts, and cached Home schedule signals.

## Current Behavior

Before this change:

- Same-day duplicate suppression grouped by keys such as `routeId:date`, `watchlistId:date`, or `projectionId:date`.
- Existing projection rows in `userScheduleEvents` could contain both the direct TV row and the title-fallback anime row for adjacent days.
- `getTodayScheduledWatchlistFeed` and `getFutureUpcomingCountsForWatchlist` looked only at the requested day/window for current count candidates, so a watched row from the previous day could not suppress a stale same-episode copy today.
- The schedule-confidence projection generator deduped same-day aliases but materialized adjacent-day aliases as separate user schedule events.

## Decision

Schedule duplicate handling now recognizes a bounded adjacent-date duplicate window of one day for the same tracked route/show. A near-date pair collapses when it either has the same schedule episode dedupe key, has the same generic `Episode N` number, or has the same provider-local episode number with at least one generic/missing episode name. Same-day behavior remains delegated to ADR-0020's existing same-day predicate.

Convex read paths now apply this rule in both projection-backed and fallback cache-scan paths:

- Upcoming Schedule serialization dedupes existing projected rows before grouping them by date.
- Today scheduled watchlist reads include a one-day duplicate proof window around the selected day.
- Future watchlist counts include a one-day lookback for duplicate proof while counting only the requested window.
- Cached Home schedule signal matching suppresses adjacent-date watched duplicates before patching `newEpisodeSignalAt`.

The schedule-confidence projection generator applies the same adjacent-date rule before writing `userScheduleEvents`, so future projection windows do not preserve both copies. Candidate preference keeps direct/source-matching rows ahead of title-fallback rows; otherwise existing provider/source and airtime precision preferences still apply.

## Reasoning

The mistake was treating "duplicate release candidate" as date-local. That was enough for stale same-day provider rows, but not for provider date disagreements where one provider is a day later and also uses a different season model.

Broadly hiding all caught-up or watched shows from Schedule would be wrong because caught-up shows can still have real future releases. Reinterpreting AniList `S01E13` as TVMaze `S04E13` globally would also be too broad. A one-day duplicate proof window is narrow enough for timezone/date-provider drift and moved-date cache copies, while preserving real later releases.

Keeping source-matching preference matters for Classroom because the tracked row is a TV route and the TVMaze row is a direct tracked-source match. The AniList row is useful as schedule evidence only when it is not a duplicate of a better tracked-source row.

## Provider/Data Assumptions

Provider IDs remain the preferred match source. TVMaze/TMDB rows that match the tracked TV route are higher confidence than AniList title-fallback rows bridged into a TV route.

Generic names in the form `Episode N` are usable as duplicate evidence only inside the same tracked route/show and the one-day window. When one provider supplies a descriptive name and the other supplies only a generic/missing name, matching provider-local episode numbers are also treated as duplicate evidence inside that same narrow route/date boundary. This does not make title fallback more trusted for release mutation or provider identity.

Watched episode rows remain the source of truth for user progress. Adjacent-date suppression hides an unwatched-shaped duplicate only when it collapses with a watched candidate for the same tracked show/route.

Schedule dates remain UTC date keys. Provider `airDate` timestamps still drive sorting and availability classification after duplicate suppression.

## Edge Cases

Same-day Wistoria-style duplicates remain covered by ADR-0020. This change extends the same idea to one-day provider drift without removing the same-day guard.

Back-to-back different episodes are preserved because their generic episode numbers or episode dedupe keys differ.

Adjacent same-episode direct and title-fallback rows collapse, preferring the direct/source-matching row.

Rows more than one day apart are not collapsed by this rule.

Paused, dropped, completed, and planned/not-started status handling is unchanged. The rule only affects duplicate schedule candidates after they have already matched a tracked row.

Existing stale `userScheduleEvents` rows are guarded at read time; regenerated projection windows remove the duplicate source rows.

## Verification

Local checks for this change:

- `npm run schedule-confidence:validate`
- `node --check scripts/schedule-confidence.mjs`
- `npx tsc --noEmit --pretty false`
- `git diff --check`

The schedule-confidence fixture suite now includes an adjacent-date duplicate shaped like the Classroom regression: a direct TVMaze `S04E13` row with a descriptive episode name and an AniList title-fallback `S01E13` row with the generic `Episode 13` name on adjacent dates. Validation asserts that the projection keeps only the direct TVMaze row.

Production diagnosis used `npx convex data --prod userScheduleEvents --limit 20000 --format jsonl` filtered to Classroom of the Elite and confirmed the June 3 direct TVMaze row plus June 4 AniList title-fallback row described above.

## Rollback Notes

If valid adjacent-day releases disappear, inspect `shouldCollapseSameTrackedShowNearbyDate` in `convex/schedule.ts` and `shouldCollapseProjectedSameTrackedShowNearbyDate` in `scripts/schedule-confidence.mjs`.

The conservative rollback is to remove the adjacent-date predicate and its one-day proof windows while leaving ADR-0020 same-day watched duplicate suppression and ADR-0018 provider-numbering suppression intact.

If projection rows are already regenerated with this rule and need rollback, rerun schedule projections after disabling the generator-side adjacent-date collapse.
