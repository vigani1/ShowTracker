# ADR-0045: TV Time TV Catalog Priority

## Status

Accepted

## Context

TV Time exports anime and ordinary series through the same show records. The GDPR importer
previously searched anime and TV providers together and could choose AniList whenever TMDB marked a
candidate as animation. ShowTracker's regular TV records provide the preferred metadata and episode
shape for imported TV Time libraries.

## Current Behavior

Before this decision, TV Time records parsed as `tv` could be converted to an anime record even when
TMDB or TVMaze had resolved the exported TVDB identifier or title. This made imported titles differ
from the records users find through the app's regular Shows catalog.

## Decision

For TV Time records parsed as `tv`, resolution is ordered as follows:

1. TVDB-to-TMDB identity lookup.
2. TMDB TV title search.
3. TVDB-to-TVMaze lookup and its existing IMDb/TMDB bridge.
4. AniList, then Jikan/MAL, only when no regular TV candidate resolves.

A regular TV candidate is no longer displaced because its genres include animation. Records already
typed as `anime` by other legacy import formats retain their direct AniList/MAL resolution path.

## Reasoning

The exported object is a TV Time show, and the regular catalog is the product's preferred source for
that import path. Short-circuiting also avoids unnecessary anime API calls for successfully resolved
shows. Anime fallback still prevents a title from being lost when the regular catalog has no match.

## Provider/Data Assumptions

TV Time's numeric show identifier remains a TVDB candidate verified through existing provider
lookups. TMDB and TVMaze are authoritative for the regular Shows catalog. AniList and Jikan remain
useful fallback sources for titles absent from those catalogs.

## Edge Cases

An animated show present in TMDB remains a `tv` record. A title absent from TMDB but present in
TVMaze remains a `tv` record. A title absent from both can still resolve as anime. Unresolved GDPR
titles continue to be skipped rather than saved with guessed fallback metadata.

## Verification

Required checks:

```bash
npm run test:tv-time-import
npx tsc --noEmit --pretty false
npm run lint -- --no-cache
npx -y react-doctor@latest . --verbose --scope changed
git diff --check
npx convex deploy --dry-run --yes
```

Manual verification should confirm that a TV Time anime title available in the Shows catalog resolves
to the TMDB/TVMaze-backed TV record and that anime fallback remains available for an unmatched title.

## Rollback Notes

Rollback by restoring cross-provider score comparison for TV records. Do not change records already
imported without a separate identity migration and duplicate analysis.
