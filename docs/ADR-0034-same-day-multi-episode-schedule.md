# ADR-0034: Same-Day Multi-Episode Schedule Drops

## Status

Accepted

## Context

On June 17, 2026, the production Schedule tab showed `X-Men '97`
(`tmdb:tv:138502`) on July 1, 2026 with episode 1 and episode 3, but episode 2
was missing. The detail page correctly showed season 2 episodes 1, 2, and 3 all
airing on July 1, 2026.

Production data showed:

- The VPS provider-event cache had TMDB season 2 episodes 1, 2, and 3 on
  `2026-07-01`.
- TVMaze had only season 2 episode 1 on `2026-07-01T12:00:00Z`.
- The release delta and Convex `scheduleCache` kept TVMaze episode 1 and TMDB
  episode 3, but dropped TMDB episode 2.
- The Schedule UI also allowed other shows to split a same-day drop, so a
  multi-episode release did not read from top to bottom as episode 1, episode 2,
  episode 3.

## Current Behavior

ADR-0020 introduced same-day duplicate collapse so stale cross-provider rows do
not keep Home and Schedule active after a user has already watched the real
episode. That collapse intentionally handles provider rows that describe the
same release with different numbering.

The rule was too broad for adjacent same-day premieres. When one provider had a
timed episode 1 and another provider had date-only episodes 1, 2, and 3, the
cross-provider generic same-day rule could treat episode 2 as a duplicate of the
timed episode 1. The schedule-cache maintenance delta then never sent episode 2
to Convex, and user schedule projections copied the incomplete cache.

Schedule display sorting was also flat by airtime and title. That could split a
same-show multi-episode drop around other shows on the same day.

## Decision

Cross-provider same-day generic duplicate collapse now preserves adjacent
same-season episode numbers. Rows such as `S02E01`, `S02E02`, and `S02E03` on
the same date are treated as distinct episodes even when another provider has a
timed row for one of them.

Large same-day numbering aliases remain collapsible. This keeps the ADR-0020
shape for stale season-local/cumulative rows such as `S02E09` versus `S02E21`.

The schedule-confidence reconciler now orders one show's future schedule rows by
date, season number, and episode number before choosing `nextScheduled` and
emitting `upcomingEpisodes`.

Convex Schedule display now sorts each day by show group. A group's earliest
known airtime determines where it sits relative to other shows, and episodes
inside the group are ordered by season and episode number ascending.

## Reasoning

Adjacent episode numbers are a strong signal for a real multi-episode drop. A
provider missing one of those adjacent rows should not cause the other provider's
middle episode to disappear.

The existing duplicate guard is still useful for stale provider aliases, but
those aliases are characterized by larger numbering jumps or same episode
identity, not by neighboring episode numbers in the same season.

Grouping display rows by show keeps the user's scanning model intact: if a show
drops multiple episodes on the same date, the selected-day list reads from the
first available episode downward.

## Provider/Data Assumptions

TMDB season detail rows may include full same-day drops before TVMaze has every
future episode. TVMaze may still provide better airtime precision for the first
episode and should remain preferred for that exact same-number row.

Provider IDs remain the primary match path. This decision does not broaden title
fallback, provider bridging, status mutation, or release availability rules.

Generic names such as `Episode 1` and `Episode 2` are distinct when their
season-local episode numbers are adjacent. Large numbering gaps can still be
treated as aliases when the existing duplicate rules say they collapse.

## Edge Cases

Two-part premieres and finales on the same date should show all adjacent
episodes.

Same-day rows from different providers with the same season and episode number
still collapse to the preferred provider row.

Long-running shows with cumulative/year numbering remain protected by ADR-0018
and ADR-0020 because large numbering deltas can still collapse when provider
evidence says they are aliases.

Schedule groups with no known airtime continue to sort by show title. Groups
with an airtime sort ahead of groups without one, then their internal episodes
sort by episode number.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation includes a `Same Day Multi Drop` show where TMDB has episodes
1, 2, and 3 on the same date, while TVMaze has only a timed episode 1. The
release delta must keep `upcomingEpisodes` as `1,2,3`, choose episode 1 as
`nextScheduled`, and generate three user schedule projection events/counts.

Production verification should confirm `X-Men '97` on July 1, 2026 shows
episodes 1, 2, and 3 in Schedule and that the detail page remains consistent.

## Rollback Notes

Rollback by removing the adjacent-episode guard from
`scripts/schedule-confidence.mjs` and `convex/schedule.ts`, restoring timestamp
sorting for one-show future events, and restoring the previous flat Schedule
episode sort.

If rollback is considered because stale duplicate rows reappear, inspect whether
the conflicting rows have adjacent same-season episode numbers. Non-adjacent
large-number aliases should still be handled by the existing ADR-0020 and
ADR-0018 duplicate logic.
