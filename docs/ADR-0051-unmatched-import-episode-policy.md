# ADR-0051: Unmatched Import Episode Policy

## Context

ADR-0050 preserved TV Time rows that could not be reconciled to a canonical provider episode as
historical-only records. Those rows contributed to statistics but were intentionally invisible in the
provider episode UI. The product policy is now that account history should contain only episodes the
user can inspect and edit through ShowTracker's provider catalogue.

## Current Behavior

The client sends unresolved reconciliation results to Convex with the request-only `unmatched` flag so
an idempotent rerun can locate their TV Time provenance. Convex treats that marker as a deletion
instruction: it removes any legacy or previously preserved copy and does not insert a replacement. The
import result reports the number as `unmatchedEpisodes`. ADR-0052 removes the obsolete durable
`historicalOnly` field after production cleanup.

## Decision

- Persist only episodes reconciled to a canonical provider episode.
- Report unmatched TV Time rows as skipped rather than silently discarding them.
- On rerun, delete old coordinate-only or historical-only copies identified by source ID/coordinates.
- Exclude skipped rows from statistics, progress, status, Home, Watchlist, Schedule, and detail views.
- Remove the temporary `historicalOnly` schema field and read filters after the bounded production
  cleanup defined by ADR-0052.

## Reasoning

Invisible history cannot be reviewed or corrected by the user. Omitting uncertain rows keeps Convex,
statistics, and visible provider progress aligned. Users can manually mark a provider episode later if
they identify the correct match.

## Provider And Data Assumptions

Canonical matching remains defined by ADR-0050. TMDB and TVMaze catalogues are authoritative for rows
that pass exact or safe ordinal reconciliation. The TV Time internal episode ID remains provenance and
is not treated as a public provider ID.

## Edge Cases

- A provider catalogue outage may cause rows to be reported unmatched; rerunning later can resolve them.
- An unmatched row previously stored by ADR-0050 is removed on rerun.
- The deletion is scoped to the authenticated user and the source episode being processed.
- Canonical rows and their watch histories remain idempotent across reruns.

## Verification

- Confirm unmatched reconciliation results are counted but never inserted.
- Confirm a matching legacy or historical-only row is deleted during rerun.
- Run import tests, TypeScript, lint, React Doctor, and a Convex production dry run.
- Rerun a real archive and verify Bleach S00E99 is reported unmatched and absent from Convex.

## Rollback

Restore historical-only insertion from ADR-0050. Any skipped rows would require another archive import
to be recreated because this policy intentionally removes them from account data.
