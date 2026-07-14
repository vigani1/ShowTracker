# ADR-0047: Provider Episode Runtime Authority

## Status

Accepted

## Context

Show-level runtime is only an estimate. TMDB season details and TVMaze episode lists expose runtime
for individual episodes, including specials and episodes with nonstandard length. Imported history
previously used the archive runtime or one show-level provider runtime, which could accumulate large
watch-time error across a long library.

## Current Behavior

The detail screen already passes normalized episode runtime when a user marks one episode watched.
TV Time import resolved show metadata but did not hydrate the watched seasons before writing history,
so exact provider episode runtime was unavailable during bulk migration.

## Decision

During import, hydrate only seasons represented in watched history. For TMDB-backed TV records, fetch
each watched season with bounded concurrency and map normalized runtime by `(season, episode)`. For
TVMaze-backed records without TMDB identity, fetch the show's episode list once and build the same
map.

Runtime precedence is:

1. Exact provider episode runtime.
2. Provider show runtime.
3. Archived runtime when provider runtime is unavailable.

Re-importing updates existing watched episode runtime and recalculates aggregates without duplicating
watch events. Single episode, season, whole-show completion, and rewatch paths pass detail-provider
runtime and enrich an older stored row when an exact value becomes available.

## Reasoning

Provider episode details are durable and remain available after TV Time closes. Fetching watched
seasons once avoids one request per episode while preserving exact values where the provider exposes
them. The fallback chain keeps statistics usable when providers omit runtime.

## Provider/Data Assumptions

TMDB season detail runtime and TVMaze episode runtime are authoritative for records resolved to those
providers. AniList and Jikan commonly expose a series duration rather than complete episode-specific
runtime, so their normalized show runtime remains the fallback unless exact episode data is already
available through the detail flow.

## Edge Cases

Season zero is hydrated like any other watched season. Whole-show rewatch resolves provider episodes
before rebuilding watched keys, so it does not replace exact values with a show average. Failed
provider requests fall through without blocking import. Movies use their provider movie runtime.
Provider episodes with missing runtime use the provider show runtime. Archived runtime is retained
only when neither provider level has a value.

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

Real-archive verification confirms TMDB maps The Future Diary's 26 regular episodes to 24 minutes
and its watched special to 30 minutes.

## Rollback Notes

Rollback the import enrichment helper to restore show-level runtime. Existing exact runtime values
can remain because they are valid provider facts; removing them requires a targeted repair.
