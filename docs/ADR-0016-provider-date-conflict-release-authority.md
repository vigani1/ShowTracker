# ADR-0016: Provider Date Conflict Release Authority

## Context

Hot Ones exposed a provider disagreement for the same tracked TMDB show. The detail screen loaded TMDB season data showing season 30 episode 1 as released on May 18, 2026 and unwatched, while the server schedule projection was still using a TVMaze row for season 30 episode 1 scheduled on May 21, 2026. The result was a confusing state: the detail rail showed a watchable episode, but Home and the server-owned projection could treat the show as caught up or future-only.

Family Guy showed the adjacent regression risk. TVMaze-derived counts can run one episode ahead of TMDB/detail data, while production detail currently shows Family Guy as fully caught up at 456/456. A fix for Hot Ones must not turn future-only or stale provider-count drift back into false Home backlog.

## Current Behavior

The external schedule-confidence reconciler dedupes same-number provider rows with schedule-oriented priority: TVMaze wins over AniList, and AniList wins over TMDB. That deduped row set is used for both schedule display facts and release availability facts.

`buildProjectionRepairFromFact` can also repair stale Home projections when provider metadata says a released count is slightly ahead of the imported projection. Before this ADR, that repair did not require the final release fact to be `available_now`, so a future-only provider disagreement could still request a projection repair.

The Convex tracked-show metadata refresh refines TMDB released counts from season details, but then caps the refined released count to TMDB's aggregate `number_of_episodes`. When TMDB aggregate totals lag behind season detail rows, opening the detail page can still preserve an old denominator.

## Decision

Release availability now uses a release-specific dedupe rule: when two providers describe the same numbered episode and one row is already released while the other is future-dated, the released row wins for release facts. Schedule-oriented source priority remains available for other schedule dedupe paths.

Projection repair now requires the trusted release fact to be `available_now`. Provider metadata alone can no longer repair Home/watchlist progress when the release fact says the show is future-only or caught up.

TMDB server hydration keeps the previous narrow season fetch shape and only hydrates the next TMDB season when TMDB exposes `next_episode_to_air`. It can compute a released-count floor from that hydrated season's episode dates. Convex detail refresh also allows season-detail released counts to raise the stored total when TMDB's aggregate total is stale.

Future-only provider rows no longer raise the normal release delta's `totalEpisodes` by themselves. The delta total can still rise from a released/watchable fact or a bounded provider metadata repair, but a future schedule row should not make a caught-up detail page show a larger denominator.

## Reasoning

The app needs two different answers from provider data:

- Schedule display asks, "which row should represent this episode on the calendar?"
- Watchlist availability asks, "is there any trusted evidence that a user can watch an unwatched episode now?"

Using the same TVMaze-first answer for both questions hid Hot Ones S30E01. Flipping global provider priority to TMDB would be too broad and could regress schedule quality, provider matching, and same-day duplicate collapse. A release-specific dedupe keeps the behavior narrow: it only changes same-number conflicts where provider dates straddle "released now" versus "future."

The projection-repair guard protects Family Guy-shaped cases. A stale provider count or future schedule row is no longer enough to visit user-specific Convex projections unless the final release fact itself says an episode is available now.

Keeping the TMDB server hydration to the next season avoids turning one Hot Ones repair into extra provider calls for every tracked TV show's last and highest seasons. The broader Convex detail refresh already fetches season details when a user explicitly opens a tracked show, so the nightly server path should stay tighter.

## Provider/Data Assumptions

Direct provider IDs remain the authority. TMDB season episode rows are trusted to establish release availability for a TMDB-tracked TV show when they have concrete air dates. TVMaze remains trusted for TV schedule rows, but a future TVMaze row cannot suppress a same-number TMDB row that is already released for the release fact.

Title fallback remains low-confidence and auditable. This change does not expand title-fallback Convex apply permissions.

TMDB aggregate `number_of_episodes` can lag behind season detail rows. When season detail rows prove more released episodes than the aggregate total, the released count may raise the stored total to keep progress denominators coherent.

## Edge Cases

Completed shows with genuinely new releases can still re-enter Home because `available_now` facts and bounded projection repair remain allowed.

Paused and dropped shows are still blocked by the existing projection repair status guard. Planned/not-started shows are still not repaired by watchlist projection repair.

Long-running shows such as Family Guy remain protected from stale one-episode provider-count drift because future-only or caught-up facts cannot trigger projection repair.

Anime season aliases and AniList/MAL matching keep their existing priority. Same-day duplicate episodes still use the existing duplicate collapse logic unless the same-number release-date conflict specifically changes release authority.

Future weekly rows remain future rows unless a provider with a direct identity match says that exact numbered episode is already released.

## Verification

The fixture suite includes a provider-date conflict case with the same numbered TV episode from TMDB as released and TVMaze as future. The release fact must become `available_now`, create one remaining episode, and emit a provider-date-conflict audit issue.

The projection-repair unit check includes a future-only release fact with provider metadata ahead of the imported projection. It must not emit a repair.

The fixture suite also includes a Hot Ones-shaped direct assertion: 416 watched, TMDB S30E01 released, TVMaze S30E01 future, TMDB S30E02 future, and provider released metadata at 417. The fact must become `available_now` with `releasedEpisodes = 417` while preserving the next scheduled TMDB episode.

A future-only total-drift assertion covers the Family Guy shape: 456 watched, 456 total, and only a future provider row numbered 457. The fact must remain `upcoming` with `releasedEpisodes = 456` and `totalEpisodes = 456`.

Known production examples to inspect after rollout:

- Hot Ones (`tmdb:tv:72649`): detail currently shows S30E01 released May 18, 2026 while TVMaze schedule has S30E01 on May 21, 2026.
- Family Guy (`tmdb:tv:1434`): detail currently shows 456/456 and should not regain a false one-episode backlog from TVMaze count drift.

## Rollback Notes

If Home starts showing unreleased future episodes as watchable, revert the release-specific dedupe and the projection-repair `available_now` guard in `scripts/schedule-confidence.mjs`.

If detail-page refresh starts inflating totals from bad TMDB season details, revert the Convex metadata refresh total floor in `convex/shows.ts` while leaving the server-side release dedupe in place for investigation.
