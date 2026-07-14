# ADR-0046: TV Time Exported Runtime

## Status

Superseded in part by ADR-0047

## Context

TV Time's GDPR archive contains per-episode runtime values and cached total watch time. The importer
previously discarded per-episode runtime and used resolved provider runtime instead. Missing provider
runtime became zero, and provider catalog estimates can differ from TV Time's historical values,
causing imported watch-time statistics to be materially lower.

## Current Behavior

Before this decision, imported `watchedEpisodes.runtime` was always copied from the resolved show.
Re-importing could merge dates and rewatch counts but could not enrich an existing row with the
runtime present in the archive.

## Decision

Parse runtime from both approved tracking files and carry it through the import payload into each
watched episode. Current v2 values are seconds. Legacy values are mixed: values at or above 300 are
seconds, while smaller values are minutes. ADR-0047 later makes exact provider episode runtime and
provider show runtime authoritative. Archive runtime remains the final fallback when provider data
has no positive value.

Re-import updates runtime on existing episode rows, then the normal tracking aggregate and statistics
paths recalculate watch time. Watch history and counts retain their idempotent merge behavior.

## Reasoning

The exported runtime is the closest source to TV Time's own historical statistics. Persisting it on
the watched event avoids losing time when provider metadata is absent and avoids applying one modern
catalog estimate to every historical episode.

## Provider/Data Assumptions

`tracking-prod-records-v2.csv` runtime values are seconds. The legacy export contains common minute
values such as 23 and 25 as well as second values such as 300, 600, and 1500. TMDB/TVMaze runtime is
used only when neither export contains a positive value.

## Edge Cases

Records without runtime continue to use provider metadata. Invalid episode-zero records remain
unimportable because they lack a safe season/episode identity. Re-importing the same archive changes
runtime and aggregate statistics but does not add duplicate watches or rewatches.

## Verification

Required checks:

```bash
npm run test:tv-time-import
npx tsc --noEmit --pretty false
npm run lint -- --no-cache
git diff --check
npx convex deploy --dry-run --yes
```

The real archive's identifiable runtime should reconcile near its cached total, with the remaining
difference attributable to records without runtime and malformed episode identity.

## Rollback Notes

Rollback by removing episode runtime from the import payload and returning to provider runtime.
Existing imported runtime values can remain; clearing them requires a separate targeted repair.
