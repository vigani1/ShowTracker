# ADR-0050: TV Time Episode Reconciliation

## Context

The TV Time GDPR export contains an internal episode ID, season/episode coordinates, watch dates,
rewatches, and runtime, but no public TVDB episode ID, episode title, or air date. TMDB, TVMaze, and
TV Time can group the same series into different seasons. Copying TV Time coordinates into canonical
progress therefore mislabels some episodes, while guessing a provider episode can corrupt completion
and release projections.

## Current Behavior

The importer fetches a complete provider episode catalogue once per resolved show. TMDB-backed shows
hydrate every declared season with bounded concurrency. TVMaze-backed shows fetch one complete episode
list including specials. Reconciliation runs locally for the whole imported show before Convex writes
bounded batches.

Every imported row preserves its TV Time source ID and source coordinates. Canonical rows also store a
provider episode ID and match method. Rows that cannot be reconciled confidently are stored as
historical-only: they remain part of watch statistics but are excluded from provider progress, status,
Home, Watchlist, Schedule, and detail watched-state calculations.

## Decision

- Use direct `(season, episode)` matching only when every regular imported coordinate represented in
  the watched history exists in the provider catalogue.
- When structures differ, map by canonical provider order only if the TV Time regular history is a
  contiguous prefix starting at S01E01 and does not exceed the provider catalogue.
- Match specials directly; never infer a special by ordinal position.
- Preserve unmatched rows without guessing and mark them `historicalOnly`.
- During reruns, identify imported rows by TV Time source ID/coordinates before provider ID. Legacy
  coordinate-only rows are migrated in place, and duplicate legacy rows are merged and removed.

## Reasoning

Whole-show catalogue loading avoids one request per watched episode. Direct matching is reliable when
the represented structures agree. A contiguous watched prefix has an unambiguous airing-order mapping
even when season boundaries differ, which covers completed and caught-up long-running shows such as
Bleach. Noncontiguous histories cannot be mapped safely without titles, dates, or public episode IDs,
so preserving them as history is more correct than manufacturing canonical progress.

## Provider And Data Assumptions

TMDB is the canonical episode catalogue for TMDB-backed show records. TVMaze is the fallback catalogue
when a show has no TMDB identity and may be resolved through the exported TVDB show ID. AniList and
Jikan do not expose a sufficiently detailed episode catalogue for this migration, so unresolved anime
episode coordinates remain historical-only unless the resolved show also has a supported TV catalogue.

The TV Time `ep_id` is treated as provenance only; it is not assumed to be a TVDB episode ID.

## Edge Cases

- A missing provider catalogue preserves every row as historical-only and can be retried later.
- Specials with no direct provider coordinate remain historical-only.
- A partial history with holes remains historical-only when provider season structure differs.
- Coordinate swaps during migration are resolved by source provenance, not current coordinates.
- Re-import unions timestamps and rewatch counts idempotently rather than duplicating events.
- Historical-only rows continue contributing exact, show-level, or archived fallback runtime to stats.

## Verification

- Test direct matching, contiguous ordinal mapping, noncontiguous fallback, specials, and provenance.
- Run the real GDPR archive through the parser and confirm Bleach has a contiguous 406-episode regular
  prefix plus three specials before provider reconciliation.
- Run import tests, TypeScript, lint, React Doctor, and a Convex production dry run.
- In production, rerun the archive and confirm canonical/historical-only counts are reported, history
  totals remain stable, and Home/detail progress uses canonical rows only.

## Rollback

Stop writing provenance and match fields and restore runtime-only enrichment. Existing provenance may
remain safely in Convex. Do not remove `historicalOnly` filtering without first converting or deleting
those rows, because doing so would reintroduce uncertain coordinates into provider progress.
