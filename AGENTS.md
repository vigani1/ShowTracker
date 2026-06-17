# ShowTracker Agent Guide

## Mission

ShowTracker is a fast, minimal, open source tracker for shows, anime, and movies. It should feel like a cleaner TVTime replacement: discover media, track progress, manage a Home watchlist, see upcoming/released episodes, build custom lists, and inspect watch statistics from one Expo codebase.

## How To Work

- Treat user bug reports as requests to fix and ship. Use live URLs/screenshots when provided, make the smallest correct change, and verify the result in production.
- Default delivery is: branch, validate, commit, push, PR, merge to `main` once checks pass, let Netlify deploy, deploy Convex when backend behavior changed, sync/run the VPS when schedule-confidence is involved, then test the live app with Browser tooling.
- Use docs as project memory and code as current behavior. When they disagree, trust code for diagnosis and update docs only when the task is documentation work or the needed doc fix is clear.
- For Home, Watchlist, Schedule, release availability, provider matching, duplicate collapse, route IDs, or projections, read `docs/DECISIONS.md` and the relevant ADRs before changing behavior.

Read these first when the task is broad:

- `docs/GOALS.md` for the durable product direction and non-goals.
- `CONTEXT.md` for product language.
- `docs/DECISIONS.md` for the ADR map.
- `docs/ARCHITECTURE.md` for the current system shape.
- `docs/DEVELOPMENT.md` for commands and validation.
- `docs/BROWSER_AUTOMATION.md` when the task involves live UI, screenshots, auth/session state, or Browser verification.
- `docs/SCHEDULE_CONFIDENCE.md` when the task involves release dates, schedule freshness, Home attention, provider reconciliation, or the VPS job.

## Current Stack

- Expo SDK 54, React 19, React Native 0.81, React Native Web 0.21.
- Expo Router 6 file-based routing.
- TypeScript strict mode.
- NativeWind 4 for styling.
- Convex with Convex Auth for synced user data, server functions, projections, and repair tools.
- Zustand only for small client/UI state. Do not assume `react-native-mmkv`; it is not a dependency.
- Provider clients live in `lib/api/` and normalize TMDB, TVMaze, AniList, and Jikan/MAL data.

## Code Rules

- Functional components only; prefer named exports.
- Use NativeWind `className` for styling. Do not add `StyleSheet.create`.
- App/component images use `Image` from `react-native`; do not switch app UI to `expo-image`.
- Do not call external provider APIs directly from screens/components. Use `lib/api/*` clients or Convex actions.
- User-owned synced state goes through Convex. Do not bypass Convex with ad hoc local-only persistence.
- Convex functions must use `v.*` validators and validate auth where user data is involved.
- Prefer indexed Convex queries over broad `.filter()` scans.
- Imports should use the `@/` alias where the repo already does.

## Frontend And Browser Work

- For frontend/UI work, follow the repo's existing UI conventions and visual patterns.
- For web UI debugging, use Chrome DevTools MCP first when inspection, screenshots, console/network analysis, or UI debugging is needed.
- Use `agent-browser` for task-style browser workflows such as auth, guest flows, route walkthroughs, and persistent session checks.
- Use `npm run ui:inspect:quick` or `npm run ui:inspect` after UI changes when route/theme/device screenshot coverage is useful.
- See `docs/BROWSER_AUTOMATION.md` for the tool decision guide.
- Local Expo/Convex servers are useful for fast iteration, but final verification should use the live app when the change is intended for production.

## Skill Management

- Repo-local skill files and `skills-lock.json` are managed by skills.sh or the Codex app. Do not edit, regenerate, install, or remove skills from an agent session unless the user explicitly asks.
- Claude-specific local mirrors are intentionally absent. Do not recreate `.claude/` content.

## Watchlist And Schedule Change Control

The Home watchlist, Home attention feed, schedule calendar, schedule cache, episode availability, provider reconciliation, release facts, and projection paths are the highest-risk areas in this repo.

The ADRs for these paths are long-term memory, not cleanup targets. They preserve the hard-won context behind "shows are showing / shows are not showing" Home regressions, including provider matching, stale release signals, duplicate schedule rows, completed-show reactivation, and projection fallbacks. Before changing these paths, read `docs/DECISIONS.md` and the latest relevant ADRs.

Any code change that can affect what appears in Home, Watchlist, Schedule, release availability, provider matching, duplicate collapse, route IDs, or projection reads requires a new ADR in `docs/ADR-####-short-title.md` before or with the code change.

This includes changes to:

- Home active, paused, not-started, completed, dropped, and newly available rows.
- Schedule day/month/future rows and media filters.
- `remainingEpisodes`, `releasedEpisodes`, `newEpisodeSignalAt`, `homeSortAt`, `watchlistAirtimeMode`, completed-show reactivation, and future-only filtering.
- TMDB, TVMaze, AniList, Jikan/MAL, IMDb, route IDs, canonical keys, anime aliases, bridge IDs, title fallback, and low-confidence matches.
- Duplicate prevention, same-day schedule entries, same-title TV/anime rows, stale provider totals, schedule-cache merges, and SQLite reconciler to Convex sync boundaries.

Each ADR must include context, current behavior, decision, reasoning, provider/data assumptions, edge cases, verification, and rollback notes. If unsure whether a change affects these paths, treat it as affecting them.

## Docs

Keep docs durable. Update them when the task is documentation work or when implementation exposes a clear durable mismatch; avoid phase logs, handoff notes, and one-off plans.

## Project Guardrails

- Never store images in Convex; store external CDN URLs.
- Never weaken release-state correctness just to reduce Convex I/O. If correct release intelligence is too expensive in Convex, move the work to the schedule-confidence reconciliation layer and apply compact deltas.
- Never reintroduce broad aggregate repair/backfill from routine app navigation.
