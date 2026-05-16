# ShowTracker

Cross-platform show/anime/movie tracking app built with Expo (React Native + Web), Convex backend, NativeWind styling. Replaces TVTime with better performance and cleaner UX.

## Project Goal

Build a fast, minimal show tracker that lets users: discover trending shows/anime/movies, search across all media types, track episodes watched per show, manage watchlists with unwatched episode counts, view a personal schedule of upcoming episodes, create custom lists, and see watch statistics. Runs on web + iOS + Android from one codebase. Open source.

## Tech Stack

- **Runtime**: Expo SDK 52+ (React Native + React Native Web)
- **Language**: TypeScript (strict mode)
- **Routing**: Expo Router v4 (file-based)
- **Styling**: NativeWind v4 (Tailwind CSS for RN)
- **Backend**: Convex (real-time DB, server functions, auth)
- **Client State**: Zustand + react-native-mmkv
- **APIs**: TMDB (movies/TV), TVMaze (schedule), AniList (anime), Jikan (fallback)

## Key Commands

- `npx expo start` — Start dev server (web + mobile)
- `npx expo start --web` — Web only
- `npx convex dev` — Start Convex dev backend (run alongside expo)
- `npx convex deploy` — Deploy Convex to production
- `npx expo lint` — Lint the project

## Project Structure

- `app/` — Expo Router screens and layouts
- `components/` — Reusable UI components
- `lib/` — Business logic, API clients, utilities
- `lib/api/` — External API clients (TMDB, AniList, TVMaze, Jikan)
- `convex/` — Convex backend (schema, queries, mutations, actions)
- `constants/` — Theme colors, config values
- `hooks/` — Custom React hooks
- `store/` — Zustand stores
- `types/` — Shared TypeScript types
- `docs/` — Architecture, API reference, tech stack docs

## Code Conventions

- Functional components only, prefer named exports
- Use NativeWind className for all styling (no StyleSheet.create)
- Use React Native `Image` from `react-native` for all app/component images (never `expo-image`)
- For any frontend/UI work, always use the `frontend-design` skill as the default design workflow.
- For browser-based development work on the web app, use Chrome DevTools MCP as the default browser debugging tool.
- Use the `chrome-devtools` skill when the task needs browser inspection, screenshots, console/network analysis, or UI debugging.
- Use the `agent-browser` skill when the task is a browser workflow task (login, guest flow, route walkthrough, data collection, persistent session/auth checks).
- Use `npm run ui:inspect:quick` or `npm run ui:inspect` after UI changes when you need a route/theme/context screenshot sweep.
- Convex queries/mutations in `convex/` directory, one file per domain (shows.ts, users.ts, lists.ts)
- API clients return normalized types defined in `lib/api/types.ts`
- File naming: kebab-case for files, PascalCase for components
- Imports: absolute paths via `@/` alias (e.g., `@/components/ShowCard`)

## Browser Tooling

- **Default for UI debugging:** Chrome DevTools MCP
- **Default for browser task execution:** `agent-browser`
- **Default for fast visual regression sweeps:** `npm run ui:inspect:quick` (or `npm run ui:inspect` for a wider pass)
- The repo assumes the user may have Chrome remote debugging enabled from `chrome://inspect/#remote-debugging`; when that is true, prefer attaching to the running browser with Chrome DevTools MCP instead of assuming a manually launched `--remote-debugging-port` browser.
- Use Chrome DevTools MCP first when the task is to inspect, debug, fix, or polish the web UI.
- Use `agent-browser` first when the task is to operate the app like a user, especially for auth flows, guest mode, and multi-step route walkthroughs.
- Do not treat `ui:inspect` as the primary debugging tool; use it after a fix to verify route/theme/device coverage.
- See `docs/BROWSER_AUTOMATION.md` for the full decision guide.

## Documentation Update Rule (Important)

- If an implementation issue reveals that project docs/rules are outdated or incorrect, the agent must pause and ask the user before changing docs.
- The agent should propose the exact doc/rule update and only apply it after explicit user confirmation.
- After confirmation, update all relevant sources of truth consistently (e.g., `AGENTS.md`, rule files, review config, and `PROGRESS.md` when status changes).

## Watchlist and Schedule Change Control (Critical)

The watchlist, Home attention feed, schedule calendar, schedule cache, episode availability, and provider reconciliation paths are the highest-risk and most regression-prone part of this repo. Any change that can affect this base functionality requires an ADR. No exceptions.

This applies to any code, data model, query, reconciler, import/export, route-id, provider matching, dedupe, filtering, sorting, count, status, projection, or UI behavior that can change what appears in:

- Home watchlist sections, including active, paused, not-started, completed, dropped, and newly available rows.
- Schedule views, including day/month calendar counts, selected-day rows, future weekly rows, and media filters.
- Episode availability and progress signals, including `remainingEpisodes`, `releasedEpisodes`, `newEpisodeSignalAt`, `homeSortAt`, `watchlistAirtimeMode`, and completed-show reactivation.
- Provider and identity matching, including TMDB, TVMaze, AniList, Jikan/MAL, IMDb, title fallback, anime season aliases, bridge IDs, route IDs, canonical keys, and low-confidence matches.
- Duplicate prevention and cross-provider collapse logic, especially same-day entries, same-title TV/anime rows, long-running shows, season-number disagreements, and schedule-cache merges.
- The external SQLite reconciler and Convex sync boundary when they affect schedule facts, release facts, watchlist rows, projections, or schedule-cache rows.

Before or in the same PR as the code change, add a new `docs/ADR-####-short-title.md` entry. Do not rely only on commit messages, PR descriptions, chat history, inline comments, or memory. The ADR must make the reasoning durable enough that a future agent can understand why the behavior exists and avoid reintroducing old bugs.

Each watchlist/schedule ADR must include:

- **Context:** the exact bug, regression, product feature, or operational risk being addressed.
- **Current behavior:** what the app does before the change, including the affected screens/functions/tables where relevant.
- **Decision:** the behavior being introduced or preserved.
- **Reasoning:** why this approach is safer than the alternatives, including duplicate/regression risks considered.
- **Provider/data assumptions:** which providers and IDs are trusted, when title fallback is allowed, and when it is intentionally blocked.
- **Edge cases:** completed shows with new releases, paused/dropped shows, planned/not-started shows, long-running shows, anime season aliases, missing providers, title fallbacks, same-day duplicate episodes, future weekly rows, and stale provider totals when applicable.
- **Verification:** concrete commands, queries, screenshots, simulations, or known-show checks used to prove the change. Include specific show examples when the change is motivated by real titles.
- **Rollback notes:** what to revert or watch if the change causes schedule/watchlist regressions.

If an agent is unsure whether a change can affect watchlist or schedule behavior, treat it as affecting them and write the ADR. If a change is a quick hotfix, the ADR is still required in the same PR before merge.

## Feature Owner Mode

- This mode is active only when the user explicitly says the agent is the "feature owner" (or equivalent wording).
- In Feature Owner Mode, the agent is expected to run end-to-end ownership: plan, implement, verify, fix, and close the loop without handoff.
- The agent should proactively run robust verification when the feature touches web UX: use Chrome DevTools MCP for debugging/inspection, `agent-browser` for task-style flows, and `ui:inspect` for regression sweeps when appropriate.
- The agent may create focused helper scripts, run targeted diagnostics, and call APIs/tools needed to validate behavior from start to finish.
- The agent may use credentials already available in local environment/session for verification, but must never expose, log, or commit secrets.
- The agent should keep iterating until done, and only stop when blocked by a true external dependency (missing credential/access, irreversible decision, or explicit user stop).

## Git Workflow

- **Never commit directly to main** — always create a feature branch and open a PR
- **Never commit unless the user explicitly asks** — only stage/commit/push when instructed
- **All changes go through PRs** — CodeRabbit reviews every PR before merge
- **After user feedback on an open PR, always update that PR** — push follow-up commits to the same PR branch unless the user asks for a different branch/PR
- **Branch naming**: `feat/short-description`, `fix/short-description`, `docs/short-description`
- **Squash merge only** — keep main history clean (repo enforces this)

## Boundaries — Never Do These

- Never commit API keys or secrets (use .env + Convex environment variables)
- Never make API calls directly from components — always go through lib/api/ clients
- Never store images in Convex — always use URL references to external CDNs (TMDB, AniList)
- Never bypass Convex for data that needs to sync — all user data goes through Convex
- Never use StyleSheet.create — always use NativeWind className
- Never push directly to main — always use a branch + PR
- User runs their own frontend/backend server instances: never start/restart local app/backend servers (e.g., `npx expo start`, `npx convex dev`) unless the user explicitly asks, or it is mandatory to validate a required fix.

## Detailed Docs

- See docs/PLAN.md for implementation phases and feature breakdown
- See docs/ARCHITECTURE.md for system design and data flow
- See docs/DEVELOPMENT.md for setup, build, run, and debug instructions
- See docs/BROWSER_AUTOMATION.md for browser tooling decisions and workflows
- See docs/API_REFERENCE.md for external API details and rate limits
- See PROGRESS.md for current status, completed work, and known issues
