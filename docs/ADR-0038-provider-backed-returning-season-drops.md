# ADR-0038: Provider-Backed Returning Season Drops

## Status

Accepted

## Context

On June 24, 2026, `BEEF` (`tmdb:tv:154385`) disappeared from the Home
Watchlist after the nightly schedule-confidence job. The user had marked season
1 watched the day before, so the correct state was `10 watched / 18 released /
8 remaining`. Opening the detail page refreshed the show metadata and made the
Watchlist row return.

Production evidence showed:

- TMDB currently reports `BEEF` as a returning series with 18 regular episodes:
  season 1 has 10 episodes, season 2 has 8 episodes, and
  `last_episode_to_air` is `S02E08` on April 16, 2026.
- The VPS provider-event cache only had one old TMDB event row for `S02E08`.
- After the detail refresh, the imported library row had
  `watched_episodes_count = 10`, `total_episodes = 18`, and
  `remaining_episodes = 8`.
- The schedule-confidence release fact still wrote `caught_up` with
  `released_episodes = 10` because the latest cached provider event aired
  before the user's `last_watched_at`.

That made the nightly path able to hide a valid returning-show backlog even
after the detail page repaired the local projection.

## Current Behavior

The schedule-confidence reconciler protects Home from stale sparse release
history by capping release facts to the watched count when:

- there are no known future rows;
- the deduped provider-event history has at most one released row; and
- that row aired before the user's last watched timestamp.

ADR-0036 lets terminal imported backlog defeat this cap only when fresh provider
metadata confirms the imported watchable count. Returning shows did not get the
same provider-backed treatment. A whole-season drop could therefore look stale
when the provider cache only contained the latest episode row and the user had
watched any earlier episode after that latest episode's air date.

If the imported projection was still stale at `10/10`, the reconciler also did
not use fresh provider metadata `18 released / 18 total` as a release floor
because broad projection repair is intentionally capped to small drift by
ADR-0014.

## Decision

Fresh provider metadata can now defeat sparse-old release capping for
non-terminal returning shows when there are no known future rows.

The reconciler computes a current provider metadata released count from
`provider_released_episodes`, capped by `provider_total_episodes` when a total
is present. That count is trusted only for the current no-future, non-terminal
shape.

Two provider-backed cases are accepted:

- If the imported projection already has positive remaining backlog, preserve
  the imported watchable count when provider metadata confirms at least that
  count.
- If the imported projection is still stale and provider metadata's released
  count is above both the watched count and imported episode ceiling, use the
  provider metadata released count as the release floor. This floor is not
  available for terminal shows.

Terminal shows get an additional guard: when there are no future rows, the
latest released provider event is already watched, and that event's episode
number equals the user's watched count, the release fact is capped to the
watched count. This prevents TMDB metadata that includes alternate/special
counts from reactivating finished regular-series anime such as `Hunter x
Hunter`, `Naruto`, and `Naruto Shippūden`.

The existing provider-confirmed lower-total guard keeps precedence. A fresh
complete provider total can still cap stale inflated imports when
`releasedEpisodes >= totalEpisodes` and the imported ceiling is above the
provider total.

This does not widen `projectionRepair`. Large provider-backed season drops are
expressed as ordinary `available_now` release deltas, letting Convex patch show
counts and rebuild the affected user's projection through the existing
`applyReleaseDeltas` path.

When a corrected terminal release fact is `caught_up`, Convex may restore a
`watching` user row to `completed` if the user has watched at least the released
count. This repairs rows that were incorrectly resumed by an earlier inflated
provider-backed delta and matches the normal progress-derived completion
behavior.

## Reasoning

The user's `last_watched_at` is a user action timestamp, not proof that every
episode aired before that timestamp was watched. For a returning show where a
full season dropped before the user caught up on an older season, the timestamp
cap can be wrong.

Provider metadata is the right authority for returning-show season drops because
it comes from the same refreshed TMDB show details that made the detail page
correct. Requiring fresh provider metadata avoids reviving stale imported
remaining counts from SQLite alone.

Terminal shows need the extra cap because some TMDB TV metadata can expose
higher aggregate counts than the regular episode count shown on the detail page.
If the latest regular event already lines up with the user's watched count, the
provider metadata count is not enough evidence of new regular backlog.

Keeping projection repair narrow preserves ADR-0014. The broad show-count patch
and projection rebuild path already runs for `available_now` release deltas and
for show total increases, so no new Convex repair surface is needed.

## Provider/Data Assumptions

TMDB regular TV metadata includes current positive-season totals and a released
episode count derived from hydrated regular seasons and current air dates.

For non-terminal rows with no known future events, `provider_released_episodes`
represents the current released/watchable count for the provider's regular
episodes. If `provider_total_episodes` is present, released metadata is capped
by that total.

Sparse provider-event rows can be incomplete for historical seasons. A single
latest episode row does not prove there is no unwatched backlog.

Season 0 specials remain outside this decision. This ADR only handles regular
released episode counts already provided by the normal provider metadata path.

## Edge Cases

Fresh lower provider totals still win first, so a provider that reclassifies or
removes episodes can hide stale inflated backlog as in ADR-0037.

Future-only schedules are unchanged. Provider metadata does not defeat the
future-row branch when the reconciler knows about future provider events.

Paused and planned rows are not made active by this decision unless existing
Home/status rules already allow them to respond to an `available_now` release
delta.

Terminal shows continue to work under ADR-0036; this ADR generalizes the
provider-backed imported backlog rule to non-terminal no-future rows, adds a
provider metadata floor for stale imported `caught_up` rows, and prevents that
floor from applying to terminal rows whose latest regular event already matches
watched progress.

## Verification

Required checks:

```bash
npm run schedule-confidence:validate
npx tsc --noEmit --pretty false
npm run lint
git diff --check
npx convex deploy --dry-run --yes
```

Fixture validation covers two BEEF-shaped rows:

- stale imported `10 watched / 10 total / 0 remaining` with provider metadata
  `18 released / 18 total`;
- detail-refreshed imported `10 watched / 18 total / 8 remaining` with the same
  provider metadata.

Both rows have only one old provider event, `S02E08`, and a later
`last_watched_at`. Both must emit `available_now` with
`releasedEpisodes = 18` and `totalEpisodes = 18`.

Fixture validation also covers terminal anime-shaped rows before and after a bad
inflated provider delta. `Hunter x Hunter`-shaped data with `148 watched`, a
latest `S03E148` event, and provider metadata `284 released / 284 total` must
emit `caught_up` with `releasedEpisodes = 148` and `totalEpisodes = 148`.

Production verification should run the VPS schedule-confidence job after merge,
then confirm `tmdb:tv:154385` produces an `available_now` release fact and the
live Home Watchlist still includes `BEEF` with the correct remaining count.
Also confirm the terminal shows incorrectly reactivated by the prior run no
longer appear in Home Watchlist.

## Rollback Notes

Rollback by removing `currentProviderMetadataReleasedEpisodes`,
`providerMetadataBacklogEpisodes`, and `terminalWatchedCountReleaseCap` from
`scripts/schedule-confidence.mjs`, and by restoring the ADR-0036
metadata-backed imported backlog check to terminal shows only. Remove the
Convex caught-up terminal completion repair if it marks intentionally active
fully watched terminal shows as completed.

If rollback is needed because a returning show falsely appears with released
backlog, inspect whether the provider metadata released count is inflated or
whether a future provider row was missing from the current reconciliation pass.
