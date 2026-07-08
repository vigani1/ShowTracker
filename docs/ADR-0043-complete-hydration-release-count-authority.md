# ADR-0043: Complete Hydration Release Count Authority

## Status

Accepted

## Context

On July 8, 2026, production Home again showed `The Grim Adventures of Billy
and Mandy` as an active Watchlist row with `161/184 episodes` and `23 left`
after the nightly schedule-confidence job ran.

ADR-0042 hydrated all positive TMDB regular seasons for terminal backlog-risk
rows so detail and Home could agree on the watchable released denominator. That
fixed the immediate repair run, but the nightly job later reintroduced the
false backlog because the complete hydrated count still flowed into the older
summary-based absolute episode fallback. For Billy-and-Mandy-shaped data,
TMDB season summaries and the imported terminal catalog total both say `184`,
while complete season details expose `161` dated regular episodes. The
fallbacks raised the hydrated/provider-row `161` back to `184` and produced an
`available_now` delta.

## Current Behavior

Before this decision:

- Complete TMDB season detail counted dated regular episodes correctly.
- The same function then continued into the partial-hydration fallback.
- That fallback used prior season summary `episode_count` totals plus the
  current hydrated episode number to compute an absolute released count.
- The terminal-total rescue then treated the raw `total_episodes` value as a
  released count even when provider rows already supplied a dense positive
  released denominator.
- Terminal rows with larger summary totals could be reactivated every nightly
  run even after a manual repair had hidden them.

## Decision

When every positive TMDB regular season is hydrated and the hydrated dated
episode count is positive, that hydrated count is the released episode count.
The summary-based absolute fallback is skipped.

When a terminal row has dense released provider evidence, the raw terminal total
does not become the released count. The raw total rescue remains limited to
sparse terminal evidence, where it still protects real ended backlogs whose
provider rows collapsed to one old row.

The fallback remains available only when hydration is partial or produces no
positive dated episode evidence.

## Reasoning

Complete season detail is the closest provider shape to detail's watchable
episode list. Once every regular season is hydrated, season summary totals add
less information for Watchlist attention and can reintroduce specials,
alternate numbering, or stale catalog rows.

This keeps terminal backlog rescues for Ozark-shaped rows because sparse
terminal evidence can still use the raw total, and complete hydration/fresh
metadata still produce a positive unwatched released count when it is real. It
blocks Grim/Naruto-shaped false positives because their larger raw or summary
totals cannot override complete hydrated or dense provider-row release evidence.

## Provider/Data Assumptions

TMDB season detail responses for positive regular seasons are stronger than
TMDB show-level season summary `episode_count` values for computing watchable
released rows when all positive seasons hydrate successfully.

TMDB season `0` specials remain outside regular Watchlist progress under
ADR-0037.

Partial hydration can still use summary counts because complete row-level
authority is not available in that case.

## Edge Cases

If a fully hydrated terminal show really has unwatched released regular
episodes, the hydrated dated episode count remains above the user's watched
count and Home can surface it.

If a provider fetch fails before all regular seasons hydrate, the existing
partial-hydration and provider-row rules continue to apply.

If TMDB later moves regular episodes into specials or removes dates, the next
successful complete hydration can lower the released denominator and clear stale
Home attention.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
node --check scripts/schedule-confidence.mjs
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation covers a production-shaped terminal row where complete
hydrated season details count `161` dated episodes while summary totals would
inflate the count to `184`.

Fixture validation also covers a real-import-shaped terminal row where `161`
dense provider rows and no positive imported released count must remain
`caught_up` instead of using raw total `184` as released.

Production verification should run the VPS schedule-confidence job after merge
and confirm live Home no longer shows `The Grim Adventures of Billy and Mandy`
as an active Watchlist row while real unfinished rows such as `Ozark` remain.

## Rollback Notes

Rollback by allowing complete hydrated counts to flow into the summary-based
absolute fallback again.

If rollback is considered because a real terminal backlog disappeared, inspect
the complete hydrated dated row count and compare it to detail's watchable
progress before restoring summary-total authority.
