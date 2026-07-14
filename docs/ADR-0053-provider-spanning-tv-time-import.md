# ADR-0053: Provider-Spanning TV Time Import

## Context

The initial canonical importer treated a source show as all-or-nothing: exact coordinates were used
only when every regular source coordinate existed, and ordinal mapping required a perfectly contiguous
source prefix. One numbering difference could therefore omit an entire watched show. TV Time also
groups some provider entries together, including Justice League with Justice League Unlimited and
Elite with its Short Stories.

## Current Behavior

The importer resolves the GDPR source locally, compares full TMDB and TVMaze catalogues, and measures
actual episode coverage. It maps direct coordinates per episode, flattens regular season groups into
provider order up to catalogue capacity, and handles contiguous specials separately. Verified named
extensions and small movie bundles become separate import plans. Convex uses source episode identity
across shows so reruns move an existing record instead of duplicating it.

The provider-backed audit maps 17,481 of 17,502 source episode rows. The remaining 21 are isolated
provider-count extras across eight shows, including Bleach S00E99; no complete regular show is omitted.

## Decision

- Never reject all episodes in a show because one coordinate differs.
- Score candidate shows by canonical episode coverage and title/year confidence.
- Treat same-title TMDB and TVMaze records as alternative catalogues, not separate destination shows.
- Flatten regular episodes across season boundaries and consume each catalogue up to capacity.
- Split remaining history only into explicitly named companion entries such as `Unlimited`, `Short
  Stories`, `OVA`, `Case`, or a film bundle.
- Match sparse specials directly; use ordinal special mapping only for contiguous S00 numbering.
- Index imported rows by authenticated user and source episode ID so cross-show reruns migrate rows.

## Reasoning

Provider season boundaries are presentation choices, not reliable identity boundaries. Overall episode
order is the strongest available signal when the GDPR export has no episode title or public episode
ID. Coverage scoring avoids accepting a bad external-ID lookup such as a 13-episode title for a
161-episode source. Named-extension rules allow genuine combined histories without using unrelated
same-word titles to manufacture full coverage.

## Provider And Data Assumptions

TMDB and TVMaze are regular TV catalogues and are compared as alternatives. TMDB movie search is used
for source film bundles. TV Time episode IDs remain source provenance only. AniList/Jikan are not used
to fill a regular TV source when a TV catalogue exists.

## Edge Cases

- A source longer than one provider catalogue maps through that catalogue and leaves only its tail for
  a verified companion entry.
- Same-title provider alternatives cannot both receive parts of one source history.
- Sparse S00 numbering such as Bleach S00E99 is not ordinally relabeled.
- A provider request failure cannot be interpreted as a zero-episode catalogue; bounded retries run
  before the candidate is rejected.
- Cross-show migration refreshes aggregates for both the old and new show.

## Verification

- Unit-test exact, flattened ordinal, partial-capacity, contiguous-special, and sparse-special cases.
- Run the provider-backed audit against all 17,502 episode rows in the real GDPR archive.
- Verify known splits: Justice League 52 + Unlimited 39, Elite 32 + four Short Stories, and the
  Psycho-Pass three-film bundle.
- Run TypeScript, lint, React Doctor, importer tests, and Convex production dry-run validation.
- After deployment and rerun, export production and compare source IDs, events, runtimes, duplicates,
  obsolete fields, and statistics aggregates.

## Rollback

Restore single-candidate reconciliation and remove the cross-show source index. Records already moved
to verified companion shows remain valid canonical history and do not need to be collapsed.
