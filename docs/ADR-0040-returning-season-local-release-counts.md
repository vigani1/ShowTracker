# ADR-0040: Returning Season-Local Release Counts

## Status

Accepted

## Context

On July 7, 2026, Mushoku Tensei: Jobless Reincarnation (`tmdb:tv:94664`)
reproduced the "Schedule is correct but Home hides the show until detail opens"
failure class. The Schedule tab had July 4, 2026 rows for season 3 episodes 1
and 2. Opening the detail route repaired Home immediately and showed `47/49`
with `2 left`.

The VPS schedule-confidence state before detail refresh had a direct TMDB fact:

- latest released row: `S03E02` / "Howl, Mad Dog" on July 4, 2026
- next scheduled row: `S03E03` / "Life Back at Home" on July 11, 2026
- `totalEpisodes = 50`
- `releasedEpisodes = 47`
- simulated projection: `remainingEpisodes = 0`, `hasHomeAttention = false`

That `releasedEpisodes = 47` was wrong. The user had exact watched anchors for
all season 1 and season 2 episodes, 47 watched episodes total. The provider rows
were season-local, so `S03E01` and `S03E02` were two additional released,
unwatched episodes. The reconciler should have emitted 49 released episodes and
kept the show visible on Home.

## Current Behavior Before This Change

`buildReleaseFact` intentionally avoided trusting raw totals when future rows
existed. In the `hasKnownFutureEvents` branch it computed released episodes as:

```text
max(watchedEpisodesCount, releasedEvents.length)
```

That protected shows with future-known planned totals, but it failed returning
season-local numbering. For Mushoku Tensei, `releasedEvents.length` was only the
small provider slice around the new season, while `watchedEpisodesCount` already
covered the previous seasons. The resulting fact stayed at 47 released episodes
even though two new season-local rows were available.

## Decision

The schedule-confidence release fact builder now uses exact watched episode
anchors as a provider-backed floor for season-local returning seasons.

When a tracked row has complete watched anchors and provider released rows, the
reconciler counts provider released rows that are not already in the watched
anchor set. If any exist, the released floor becomes:

```text
watchedEpisodesCount + unwatched released provider rows
```

This floor is stronger than timestamp-only capping. If two episodes share the
same airtime and the user watched one after that airtime, exact watched anchors
still preserve the other unwatched released row.

## Reasoning

The bug was not missing provider data. TMDB had the exact episode rows, and
Schedule displayed them. The bug was that the release-count logic treated the
provider event slice as either absolute numbering or a standalone count, instead
of combining exact previous watched anchors with new season-local provider rows.

Watched anchors are safer than title exceptions and safer than trusting planned
totals. They prove which provider-local episodes the user has already consumed.
Counting only released provider rows that are absent from those anchors adds the
new work without reviving already watched rows.

The fix remains bounded to rows with complete anchors. If anchors are missing or
incomplete, the reconciler falls back to the existing conservative count logic.

## Provider and Data Assumptions

TMDB, TVMaze, AniList, Jikan/MAL, IMDb, route IDs, provider matching, and
schedule duplicate collapse keep their existing rules.

Provider rows used for this floor must already have survived release-fact
dedupe. The change does not broaden title fallback or create new provider
matches.

Watched episode anchors are exact evidence only when they cover the tracked
watched count. Aggregate watched counts without full anchors are not enough for
this floor.

Future provider rows remain future-only. They do not add to released counts.

## Edge Cases

Returning seasons with season-local numbering can now surface Home attention
when new released rows appear after all previous seasons were watched.

Same-day multi-episode drops remain visible even if the user watches one of the
same-airtime episodes before the reconciler runs again.

Future-only planned rows still do not create Home attention because only
released provider rows are counted.

Rows with incomplete watched anchors keep the older conservative behavior.

Terminal sparse-history capping remains unchanged unless exact anchors prove
there are released unwatched rows.

## Verification

Local validation added fixture coverage for the Mushoku Tensei shape:

- 47 watched anchors across seasons 1 and 2
- released `S03E01` and `S03E02`
- future `S03E03`
- expected fact: `releasedEpisodes = 49`, `totalEpisodes = 50`,
  `releaseState = available_now`

The fixture also covers a partial same-day case where `S03E01` is watched and
`S03E02` remains unwatched. The expected fact remains `releasedEpisodes = 49`
and `releaseState = available_now`.

Replay validation against a copied VPS SQLite snapshot for `tmdb:tv:94664`
produced:

- `releaseState = available_now`
- `releasedEpisodes = 49`
- `totalEpisodes = 50`
- simulated projection `remainingEpisodes = 2`
- `hasHomeAttention = true`

Required validation for this change:

- `npm run schedule-confidence:validate`
- `node --check scripts/schedule-confidence.mjs`
- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npx convex deploy --dry-run --yes`
- `npx expo export --platform web --output-dir dist`
- `git diff --check`

## Rollback Notes

Rollback by removing `getWatchedAnchorBackedReleasedEpisodeFloor` from
`scripts/schedule-confidence.mjs` and restoring the previous timestamp-capping
condition.

If stale rows appear after rollback, inspect provider event dedupe, watched
anchors, and `buildReleaseFact` before adding title-specific exceptions or
broadening Home display rules.
