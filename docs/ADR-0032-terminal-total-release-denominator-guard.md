# ADR-0032: Terminal Totals Do Not Override Positive Released Counts

## Status

Accepted

## Context

On June 15, 2026, production Home showed fully watched terminal shows as active
Watchlist backlog:

- `The Grim Adventures of Billy and Mandy` appeared as `161/184` with `23 left`
  while detail showed `161/161`.
- `Naruto` appeared as `220/378` with `158 left` while detail showed
  `220/220`.

Production data showed no schedule-count rows for either route. Home was reading
positive `feedProjections.remainingEpisodes` values produced by server
projection math:

- Billy and Mandy: `watchedEpisodesCount = 161`, `totalEpisodes = 184`,
  `remainingEpisodes = 23`.
- Naruto: `watchedEpisodesCount = 220`, `totalEpisodes = 378`,
  `remainingEpisodes = 158`.

ADR-0030 fixed the opposite problem for Ozark by allowing terminal known totals
to rescue a collapsed `releasedEpisodes = 0` row. That rule was too broad: it
made terminal raw catalog totals override positive released/watchable counts.

## Current Behavior

Before this change:

- `getWatchableEpisodeCountForShow` returned
  `max(releasedEpisodes, totalEpisodes)` for terminal TV/anime rows.
- The schedule-confidence reconciler treated terminal known totals as released
  floors whenever no future events were known.
- A positive released/watchable count such as `161` could be replaced by a raw
  terminal total such as `184`.
- Home correctly showed any positive `remainingEpisodes` value, so bad
  projection math surfaced as false active Watchlist cards.

## Decision

Terminal totals are now a rescue path only when the released/watchable count is
missing, zero, or otherwise unusable. When a terminal TV/anime row has a
positive released count, Home and schedule-confidence projections use the
released/watchable denominator capped by the raw total, not the raw total as a
floor.

The schedule-confidence sparse-old guard remains active for terminal rows that
already have a positive released/watchable count. Ozark-shaped rows still get
the terminal rescue: terminal lifecycle, known total, no future events, and no
positive released/imported caught-up denominator.

A token-protected provider metadata repair action can force the existing
tracked metadata refresh path for a matched show. This lets production rows
that were already inflated by the old rule be repaired through the same
season-detail logic used by detail routes.

## Reasoning

ADR-0026 and ADR-0009 establish that Home and detail progress answer the same
question: "what can I watch now?" Raw provider totals are catalog facts, not
always watchable facts. Terminal lifecycle status makes a raw total useful when
release data has collapsed to zero, but it does not make every provider total
more reliable than a positive released/detail denominator.

Billy and Mandy and Naruto proved that terminal totals can include specials,
alternate provider numbering, or catalog rows that the detail route does not
count as watchable progress. Treating those totals as a released floor woke
fully watched shows.

The repair remains server-owned and targeted. We avoid client-side hiding
because Home should continue to trust positive released backlog when projection
math is correct.

## Provider/Data Assumptions

Positive released counts from Convex/provider detail payloads are stronger
watchable denominators than raw terminal totals.

Terminal raw totals are safe as a fallback only when no positive released count
exists and the row is not already known caught up by imported watchable
progress.

Sparse old provider histories, one old finale row, and no future schedule rows
should not wake hundreds of raw-total episodes unless release data has actually
collapsed to zero and needs ADR-0030 rescue.

## Edge Cases

Ozark-like terminal rows with `releasedEpisodes: 0`, `totalEpisodes: 44`, and
four watched episodes still project as `40` remaining.

Billy-and-Mandy-like rows with `releasedEpisodes: 161`, `totalEpisodes: 184`,
and `161` watched project as `0` remaining.

Naruto-like sparse terminal rows with one old provider event, `220` watched,
and raw `totalEpisodes: 378` stay caught up instead of projecting `158` left.

Real positive released backlog remains visible when `watchedEpisodesCount` is
less than the positive released/watchable count.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation must cover:

- Terminal positive released caught-up: `161 watched / 161 released / 184 total`
  produces `remainingEpisodes = 0`.
- Sparse old total trap marked terminal: `220 watched / 378 total` remains
  caught up.
- Terminal ended total: `4 watched / 0 released / 44 total` remains `40`
  remaining.

Production verification should repair and rebuild projections for
`tmdb:tv:897` and `tmdb:tv:46260`, then confirm Home no longer shows Billy and
Mandy or Naruto as active rows while Ozark still shows `40 left`.

## Rollback Notes

Rollback by restoring terminal `max(releasedEpisodes, totalEpisodes)` behavior
in Convex and schedule-confidence helpers, and by restoring terminal sparse-old
total rescue for rows with positive released counts.

If rollback is considered because Ozark disappears again, inspect whether the
row has a positive released/watchable denominator before reinstating the broad
terminal-total floor.
