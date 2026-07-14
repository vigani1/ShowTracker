# ADR-0044: TV Time GDPR Archive Import

## Status

Accepted

## Context

TV Time's service closure makes browser-extension extraction unreliable. Its official GDPR
archive contains useful tracking CSVs alongside credentials, sessions, IP history, and other
private data that ShowTracker must not ingest. The tracking records include episode watch dates,
rewatch counts, followed dates, favorites, paused/for-later state, and TVDB-shaped identifiers.

## Current Behavior

The previous importer accepted loosely structured JSON, resolved titles against providers, and
inserted only episodes that did not already exist. It could not open the official ZIP, omitted
favorites and followed dates, and could not enrich an existing episode with historical dates or
rewatches. Unresolved titles were saved with fallback metadata.

## Decision

ShowTracker accepts the official GDPR ZIP on web and native. It extracts only these six basenames
in memory: `tracking-prod-records-v2.csv`, `tracking-prod-records.csv`, `followed_tv_show.csv`,
`user_tv_show_data.csv`, `rewatched_episode.csv`, and `user_show_special_status.csv`. All other
entries are ignored. Archive size, entry count, extracted size, row count, paths, duplicate names,
and required headers are validated before import.

Parsed TV records carry the export identifier as a TVDB candidate and use the existing conservative
provider resolver. Unresolved GDPR titles are reported and skipped instead of creating uncertain
fallback records. Resolved records are written only for the authenticated Convex user.

Episode history is merged by unique timestamp and watch count is the maximum of existing count,
imported count, and known history length. Re-importing the same archive is idempotent. Favorites
are additive, followed dates become `addedAt` for new rows, and existing paused, dropped, or
completed choices are preserved. Tracking aggregate refresh and feed projection updates remain in
the existing Convex path.

## Reasoning

Local allowlisted extraction prevents credentials and unrelated personal data from reaching the
backend. TVDB-first identity gives the strongest available match, while skipping unresolved titles
avoids corrupting a library with title-only guesses. Max-and-union merging preserves known rewatch
facts without doubling counts on retries or chunk boundaries.

## Provider/Data Assumptions

The numeric `s_id` in the current TV Time export is treated as a TVDB candidate and is verified by
the existing TMDB/TVMaze lookup path. TV Time can label anime as TV, so the existing AniList-first
comparison remains active when TV and anime candidates compete. CSV column names may change; a
changed required shape fails closed instead of silently dropping fields.

## Edge Cases

Episodes without dates still import with a server timestamp, but a repeat import does not turn that
timestamp into a rewatch. Separate rows for the same episode union their dates and use the strongest
reported rewatch count. Existing user status is not downgraded. Missing optional CSVs reduce detail
but do not block the required v2 tracking file. Unsafe paths and duplicate approved filenames reject
the archive.

## Verification

Required checks:

```bash
npm run test:tv-time-import
npx tsc --noEmit --pretty false
npm run lint -- --no-cache
npx -y react-doctor@latest . --verbose --diff
git diff --check
npx convex deploy --dry-run --yes
```

Synthetic fixtures cover dates, rewatches, favorites, ignored sensitive entries, missing required
files, and changed headers. UI verification covers ZIP selection and preview on desktop and mobile
viewports.

## Rollback Notes

Rollback the archive UI, parser dependencies, and optional import arguments together. The Convex
merge behavior is backward-compatible with the legacy JSON importer and can remain independently;
do not roll back imported user history or favorites.
