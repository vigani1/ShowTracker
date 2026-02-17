# Bandwidth Optimization - Next Steps

Last updated: 2026-02-17

## Current situation

- Convex free-tier database bandwidth is currently the primary scaling risk.
- In stress-test windows, read-heavy calls are dominated by schedule, recommendations, tracked-id lookups, and feed/library reads.

## Highest-impact optimizations (priority order)

1. Narrow `feedProjections` scans in Home and Upcoming
   - Home and Upcoming currently read all user projections, then filter in memory.
   - Add/use projection indexes keyed by user plus media/status where possible.
   - Expected impact: large reduction for users with big libraries.

2. Replace `getTrackedIds` join path with projection-backed tracked keys
   - Discover and For You only need lightweight tracked identity info.
   - Avoid full `userShows` + `shows` hydration when only presence/exclusion is needed.
   - Expected impact: major drop on tab switches and recommendation loads.

3. Collapse recommendation seed reads into one query
   - For You currently pulls seeds by media type separately.
   - Return all seed categories in one query so user tracking is read once.
   - Expected impact: immediate reduction in recommendation query bytes.

4. Split Profile heavy reads
   - Profile currently combines expensive stats + broad library hydration.
   - Introduce lightweight summary/rails query for first render; lazy-load heavy sections.
   - Expected impact: lower per-visit cost to Profile.

5. Reduce watchlist-side schedule fallback window
   - Home watchlist fallback currently hydrates a multi-day future window.
   - Tighten default range or gate refreshes behind user interaction.
   - Expected impact: fewer schedule cache scans and hydrations.

## Account-level actions to stay on free tier longer

- Move heavy local testing to local Convex deployment where possible.
- Pause or reduce noisy dev/test traffic on non-critical screens (For You, Profile, wide Upcoming windows).
- Keep only one active high-traffic project under the same team when near quota (usage is team-level).
- Avoid repeated scripted page loops against cloud dev deployment.
- Monitor top database bandwidth consumers in Usage and keep a weekly cap check.

## Plan behavior notes

- Free plan: if limits are exceeded for an extended period, deployments may return function-call errors.
- Starter/Professional plans continue serving and apply metered overage rates.
- Convex states resource usage is tracked per team (sum across projects in the team).

## Follow-up implementation queue

- [x] Implement projection-indexed Home/Upcoming narrowing.
- [x] Replace `shows.getTrackedIds` backend path with projection-based lookup.
- [x] Merge recommendation seed queries into one backend call.
- [x] Split Profile into lightweight summary query + deferred heavy sections.
- [x] Tune Home watchlist future schedule fallback days.

## Anime progression UX controls

- New unwatch scope controls should support:
  - `This title only` (current relation/season context)
  - `All related titles` (entire franchise timeline under the same root)
- Completion prompt should support:
  - `Go to Next Season`
  - `Pause Other Related Seasons`
  - `Stay Here`

### Suggested settings model

- Global Home relation visibility mode:
  - `core_only` (sequels/prequels + mainline formats)
  - `all_relations` (include side stories, specials, alternatives)
- Per-franchise override:
  - optional override keyed by `relationRootAnilistId`
  - inherits from global mode unless explicitly overridden
- Optional default for completion prompt behavior:
  - `ask_every_time`
  - `auto_open_next`
  - `auto_pause_others_keep_next`

### Edge cases to account for

- Missing/unknown relation type from AniList (fallback by chronology + format).
- Multiple concurrent branches in same franchise timeline.
- Movie/OVA entries mixed into TV progression (respect selected visibility mode).
- Already paused/dropped/completed related entries should not be force-overwritten.

## Implementation phases

### Phase A - Data model and settings API

- Add persistent global anime home settings per user:
  - relation visibility mode (`core_only` vs `all_relations`)
  - completion behavior (`ask`, `auto open`, `auto pause others`)
- Add per-franchise override table keyed by `relationRootAnilistId`.
- Expose query/mutation APIs to read/write both levels.

### Phase B - Feed and relation-sync behavior

- Apply effective relation mode (franchise override -> global fallback) in Home feed selection.
- Update anime relation sync to include all relation types when effective mode is `all_relations`.
- Keep existing conservative behavior as default (`core_only`).

### Phase C - UX controls

- On anime details screen:
  - global relation mode controls
  - per-franchise override controls
  - completion behavior controls
- Completion modal actions:
  - Go to next season
  - Pause other related seasons
  - Stay here
- Unwatch scope controls:
  - this title only
  - all related titles in franchise

### Phase D - Upcoming tab performance

- Make edge-range extension optimistic (extend visible range immediately; hydrate in background).
- Increase edge prefetch threshold to reduce "hit boundary then wait" behavior.
- Reuse cached past schedule buckets without aggressive freshness invalidation.
- Keep media-filter prefiltering as early as possible in schedule matching.

### Phase E - Validation

- Run lint + type checks.
- Verify Monogatari progression flows (Bakemonogatari -> Nisemonogatari).
- Verify Home behavior for both relation modes (core-only vs all-relations).
- Verify upcoming scroll latency after first load in headed browser.
