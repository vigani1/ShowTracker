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
- Convex queries/mutations in `convex/` directory, one file per domain (shows.ts, users.ts, lists.ts)
- API clients return normalized types defined in `lib/api/types.ts`
- File naming: kebab-case for files, PascalCase for components
- Imports: absolute paths via `@/` alias (e.g., `@/components/ShowCard`)

## Documentation Update Rule (Important)

- If an implementation issue reveals that project docs/rules are outdated or incorrect, the agent must pause and ask the user before changing docs.
- The agent should propose the exact doc/rule update and only apply it after explicit user confirmation.
- After confirmation, update all relevant sources of truth consistently (e.g., `AGENTS.md`, rule files, review config, and `PROGRESS.md` when status changes).

## Feature Owner Mode

- This mode is active only when the user explicitly says the agent is the "feature owner" (or equivalent wording).
- In Feature Owner Mode, the agent is expected to run end-to-end ownership: plan, implement, verify, fix, and close the loop without handoff.
- The agent should proactively run robust verification, including browser-based checks with the `agent-browser` skill when the feature touches web UX.
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
- See docs/TECH_STACK.md for setup, build, run, and debug instructions
- See docs/API_REFERENCE.md for external API details and rate limits
- See PROGRESS.md for current status, completed work, and known issues
