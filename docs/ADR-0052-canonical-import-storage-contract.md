# ADR-0052: Canonical Import Storage Contract

## Context

ADR-0051 stopped inserting unmatched TV Time episodes but temporarily retained the `historicalOnly`
schema field and read filters for records created under ADR-0050. The GDPR parser also exposes TV
Time's `is_special` classification, which is useful while reconciling source rows but redundant after
the row has been matched to a canonical provider episode.

## Current Behavior

Production was migrated across all watched episode documents. The migration removed 2,575 explicit
`historicalOnly: false` fields and found no `historicalOnly: true` or persisted `isSpecial` records.
Unmatched reconciliation results are sent to the import mutation with an import-only `unmatched`
instruction so legacy source-coordinate rows can be deleted without inserting a replacement.

## Decision

- Do not define or persist `historicalOnly` on watched episode documents.
- Do not persist TV Time's `isSpecial`; use it only while parsing and reconciling the import.
- Represent an unmatched result with the request-only `unmatched` flag and never insert that row.
- Persist canonical provider episode ID, original source ID and coordinates, and `exact` or `ordinal`
  match method for successfully reconciled imports.
- Remove all historical-only read filtering after the production cleanup.

## Reasoning

Every stored watched episode must correspond to a provider episode visible and editable in
ShowTracker. A hidden-history state therefore has no place in the durable model. Provider and source
identities remain useful for idempotent reruns, audits, and future ShowTracker exports. Source special
classification does not add information once canonical season, episode, and provider identity exist.

## Provider And Data Assumptions

TMDB or TVMaze episode identity is canonical for imported TV shows. TV Time episode IDs and source
coordinates are provenance only. AniList/Jikan imports still require a supported canonical episode
catalogue before episode history is stored.

## Edge Cases

- An unmatched source special is reported and omitted.
- An import-only unmatched instruction may delete an old source-coordinate row during a rerun.
- Legacy JSON imports without TV Time provenance continue to use their existing coordinate behavior.
- Native ShowTracker watches have canonical coordinates without TV Time source fields.

## Verification

- Audit production before schema removal and confirm no `historicalOnly: true` records exist.
- Run the bounded cleanup across every watched episode document.
- Test exact, ordinal, regular unmatched, and unmatched-special reconciliation.
- Run TypeScript, lint, import tests, and Convex production schema validation.

## Rollback

Restore the request and schema fields only after defining a user-visible product behavior for
unmatched records. A rollback cannot recreate omitted source rows without rerunning the source archive.
