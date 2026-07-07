# ADR-0042: Terminal Hydrated Season Watchable Counts

## Status

Accepted

## Context

On July 7, 2026, production Home showed `The Grim Adventures of Billy and
Mandy` as an active Watchlist row with `161/184 episodes` and `23 left`, while
the detail page showed `161/161 episodes` and 100% watched progress.

Earlier ADRs already covered this family:

- ADR-0030 allowed terminal raw totals to rescue collapsed released counts, so
  ended shows such as `Ozark` could stay visible when real unwatched episodes
  remained.
- ADR-0032 narrowed that rescue because terminal raw totals can include catalog
  rows that are not part of detail's watchable denominator.
- ADR-0036 required provider metadata confirmation before preserving imported
  terminal backlog.

The new failure escaped those guards because TMDB hydration cached the whole
final season for Billy and Mandy. The sparse-old guard only handled one old
provider row. With twenty-one old final-season rows, the generic release-count
fallback promoted the imported raw total `184` to `releasedEpisodes`, even
though the user had exact watched anchors through the final regular season and
detail still computed only `161` watchable released episodes.

## Current Behavior

Before this change:

- TMDB metadata release counts started from `last_episode_to_air` plus prior
  season summary `episode_count` values.
- For terminal backlog-risk rows, only the last and next TMDB seasons were
  hydrated, so prior season summaries could remain stronger than real hydrated
  episode lists.
- Terminal rows still contributed `item.total_episodes` to the generic
  `rawReleasedEpisodes` maximum when imported remaining progress existed.
- Billy-and-Mandy-shaped rows with more than one old provider event could
  become `184 released / 184 total` and stay active in Home.

## Decision

Terminal TV rows that have backlog risk now hydrate all positive TMDB regular
seasons. When all regular seasons are hydrated, the reconciler uses the count of
hydrated dated episodes as the TMDB released metadata count instead of allowing
summary counts to inflate the watchable denominator.

Terminal raw totals no longer participate in the generic released-count maximum.
They only affect release facts through the explicit terminal rescue branches:

- zero or missing released counts with a known terminal total,
- imported remaining backlog that is backed by fresh provider metadata,
- fresh provider metadata that can cap a stale larger imported total.

## Reasoning

Home and detail must agree on "what can be watched now." TMDB summary totals are
useful catalog facts, but detail's watchable progress is based on released
regular episode rows. When an ended show's summary total is larger than the
hydrated released-row count, the hydrated count is safer for Watchlist
attention.

This keeps the Ozark rescue intact because fresh all-season metadata confirms
the imported `44` watchable count. It blocks Billy-and-Mandy and Naruto-shaped
false positives because a raw terminal total cannot wake Home without matching
released metadata.

The fix is provider-side and projection-side, not a client hide. If a terminal
show genuinely has unwatched released episodes, fresh metadata can still produce
positive remaining progress.

## Provider/Data Assumptions

TMDB season detail responses are stronger than TMDB season summary
`episode_count` values for computing released watchable rows when all positive
regular seasons have been hydrated successfully.

TMDB season `0` specials remain outside regular Watchlist progress under
ADR-0037.

Terminal raw totals can include specials, alternate provider numbering, or other
catalog rows that detail does not count as watchable progress.

## Edge Cases

Ozark-shaped rows with a terminal total, real imported remaining backlog, and
fresh provider metadata confirming that backlog stay active.

Billy-and-Mandy-shaped rows with old final-season provider events, exact watched
anchors, and a larger raw total stay caught up.

If a TMDB season hydration fails, the provider fetch fails for that show rather
than partially lowering counts from incomplete season data.

Ongoing and returning shows continue to use existing released, future, watched
anchor, and same-day rules.

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

Fixture validation covers:

- complete hydrated TMDB seasons lowering a summary-based released count;
- a Billy-and-Mandy-shaped terminal row with twenty-one old final-season rows
  producing `161 released` and `caught_up`;
- the Ozark-shaped terminal metadata-backed backlog still producing available
  Home attention.

Production verification should run the VPS schedule-confidence job after merge
and confirm live Home no longer shows `The Grim Adventures of Billy and Mandy`
as an active Watchlist row while `Ozark` remains visible.

## Rollback Notes

Rollback by removing all-season TMDB hydration for terminal backlog-risk rows,
restoring summary-based released metadata for fully hydrated terminal rows, and
allowing terminal `item.total_episodes` back into the generic release-count
fallback.

If rollback is considered because real terminal backlog disappears, inspect
whether provider metadata actually confirms the imported watched-plus-remaining
count before restoring raw-total promotion.
