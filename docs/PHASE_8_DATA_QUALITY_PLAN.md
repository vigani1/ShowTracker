# Phase 8 Plan: Data Quality + Anime Auto-Follow

## End Goal (User Intent)

When I add one anime, the app should automatically keep me aware of the franchise over time.

Specifically:

1. Adding one anime should also add its related anime entries.
2. If I am watching or fully watched one anime and new related seasons/titles appear later, they should automatically show up.
3. These related/new entries must appear in both:
   - Watchlist
   - Upcoming
4. Whether they appear as "seasons" or "relations" in detail UI is less important than reliable tracking and surfacing.

## Success Criteria

The implementation is complete when all are true:

- Tracking one anime causes related anime entries to be tracked automatically.
- Newly discovered sequel/prequel anime entries are auto-added later through sync.
- Watchlist includes auto-followed relation entries (not only manually started entries).
- Upcoming includes episodes from auto-followed relation entries.
- Core metadata quality (air date + runtime + identity fields) is consistent for TV/anime/movie.
- Lint, typecheck, audits, and agent-browser smoke validations pass.

## Scope

### In Scope

- API/data quality hardening for required metadata fields.
- AniList relation graph usage for auto-follow behavior.
- Convex model/query/mutation updates to support relation-tracked anime.
- Home/Watchlist behavior updates so relation entries actually surface.
- Ongoing sync mechanism to capture newly added future seasons.
- Validation tooling and browser automation checks.

### Out of Scope (This Pass)

- Full global canonical one-card dedupe in Search/Discover.
- Existing user migration/backfill (single-user testing environment).
- Broad UX redesign unrelated to this goal.

## Design Decisions

1. Source of truth for anime relation graph: AniList relations.
2. Include only anime nodes in auto-follow graph.
3. Default relation inclusion for auto-follow:
   - Include: prequel/sequel anime chain entries.
   - Optional include (feature flag or config): side story/spin-off/special.
4. New relation entries default status:
   - `plan_to_watch` (tracked and visible), unless user explicitly starts watching.
5. Upcoming matching should use tracked external IDs first, then title fallback.

## Required Data Contract (P1)

Each normalized show should aim to have:

- `title`
- `mediaType`
- primary source external id (tmdb/anilist/tvmaze)
- `firstAired` (or release date)
- `episodeRuntime` (movie runtime or anime/TV runtime)
- `status`

Per media type expectations:

- TV: first air date + runtime + episode/season counts when available
- Anime: first air date + runtime + episode count + AniList ID (+ MAL ID linkage where possible)
- Movie: release date + runtime

## Implementation Workstreams

## A) API + Normalization Quality Hardening

### A1. TMDB completeness

- Update TMDB details typing so movie runtime is available.
- Fix normalization so movie runtime does not depend only on `episode_run_time`.

### A2. AniList completeness

- Extend AniList media shape to include:
  - `idMal`
  - `format`
  - `season`, `seasonYear`
  - `relations { edges { relationType } nodes { ... } }`
- Add dedicated relation-fetch helper for a given AniList ID.

### A3. Jikan completeness

- Add/expand Jikan endpoints used by detail + patching:
  - anime details
  - anime episodes
  - anime relations (fallback/validation)
- Parse duration strings like `"24 min per ep"` to numeric minutes.
- Parse episode-level `aired` timestamps for accurate anime episode dates.

### A4. Fallback patching

- Use Jikan to patch missing AniList-required fields when possible (via MAL mapping).
- Restrict patching to required fields only (avoid noisy non-essential enrichment).

## B) Relation Graph + Auto-Follow Backend

### B1. Schema extensions (shows)

Add relation-awareness fields to `shows` so linkage is durable, for example:

- canonical/root AniList id for franchise grouping
- relation ids array (anime AniList ids)
- metadata for relation sync timestamp

### B2. Auto-follow mutation

Add a mutation (or mutation flow) that:

1. Upserts root anime show.
2. Fetches AniList relation graph.
3. Resolves included anime relation nodes.
4. Upserts each related show in `shows`.
5. Inserts `userShows` rows for missing related shows with `plan_to_watch`.

This mutation replaces/augments existing add-to-watchlist flow for anime.

### B3. Sync action for new seasons

Add a sync action to re-check relations for tracked anime franchises:

- input: tracked anime roots/user context
- output: newly discovered relation entries inserted to `shows` + `userShows`
- safe dedupe guarantees (idempotent upserts)

Trigger opportunities:

- right after anime add
- on Home load with throttle window
- optional periodic explicit trigger path

## C) Watchlist and Upcoming Integration

### C1. Watchlist query behavior

Current watchlist is tightly tied to `watching` status. Update behavior so relation-tracked items are visible even when not yet started.

Implementation options (pick one and keep consistent):

1. Include `plan_to_watch` anime entries for relation-managed shows.
2. Introduce a dedicated relation-follow flag and include those entries regardless of status.

### C2. Watchlist UI behavior

Handle both started and not-yet-started relation entries:

- If progress exists: show normal progress card.
- If not started / unknown counts: show `Upcoming`, `Not started`, or `TBA` metadata state.

### C3. Upcoming matching behavior

Ensure schedule matching considers the full tracked relation set.

- Match by AniList external ID first.
- Keep normalized-title fallback.
- Ensure route IDs remain resolvable for linked cards.

## D) Detail Page (Secondary)

Add relation visibility for clarity:

- Franchise timeline or related section on anime detail page.
- This is secondary to auto-follow behavior; tracking correctness is primary.

## E) Validation + QA

### E1. Data audits

Create scripts:

- `scripts/data-quality-audit.mjs`
  - validates required metadata coverage across media types.
- `scripts/anime-relations-audit.mjs`
  - validates relation graph extraction and inclusion behavior.

Suggested quality thresholds:

- Movie runtime coverage >= 98%
- TV required metadata coverage >= 95%
- Anime required metadata coverage >= 95%

### E2. Static checks

- `npx expo lint`
- `npx tsc --noEmit`

### E3. Agent-browser smoke flow

Automate and verify:

1. Search/open an anime with sequels.
2. Add to watchlist.
3. Confirm related entries appear in watchlist.
4. Navigate to Upcoming and confirm related episodes appear.
5. Trigger relation sync flow (or action path) and confirm newly discovered related entries appear.
6. Refresh and verify persistence.

Store artifacts under `artifacts/`.

## Execution Order

1. API completeness + normalization fixes (Workstream A)
2. Schema and backend auto-follow primitives (Workstream B)
3. Watchlist/upcoming query behavior updates (Workstream C)
4. Detail relation visibility (Workstream D)
5. Audits + smoke validation + bugfix loop (Workstream E)

## Risks and Mitigations

1. Relation over-inclusion noise
   - Mitigation: start with strict include rules (main anime chain first).
2. Upcoming misses due to title mismatch
   - Mitigation: prioritize external ID matching before title fallback.
3. Rate limits from AniList/Jikan
   - Mitigation: cache relation graph and use throttled sync windows.
4. Watchlist bloat
   - Mitigation: separate visual labels for relation-tracked not-started entries.

## Non-Negotiable Product Guarantees

1. Adding one anime should effectively follow its franchise timeline.
2. New related seasons discovered later must auto-surface.
3. Watchlist and Upcoming must reflect that automatically.
