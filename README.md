# ShowTracker

Cross-platform show/anime/movie tracking app built with Expo (React Native + Web), Convex backend, and NativeWind styling. It focuses on a fast, minimal UX for discovering media, tracking progress, and managing watchlists across web + iOS + Android from a single codebase.

## Features
- Discover trending shows, anime, and movies.
- Search across all media types.
- Track episodes watched per show.
- Manage watchlists with unwatched episode counts.
- View a personal schedule of upcoming episodes.
- Create custom lists and track watch statistics.

## Tech Stack
- **Runtime**: Expo SDK 52+ (React Native + React Native Web)
- **Language**: TypeScript (strict mode)
- **Routing**: Expo Router v4 (file-based)
- **Styling**: NativeWind v4 (Tailwind CSS for RN)
- **Backend**: Convex (real-time DB, server functions, auth)
- **Client State**: Zustand + react-native-mmkv
- **APIs**: TMDB (movies/TV), TVMaze (schedule), AniList (anime), Jikan (fallback)

## Getting Started
```bash
# Install dependencies
npm install

# Start Expo (web + mobile)
npx expo start

# Start Expo (web only)
npx expo start --web

# Start Convex dev backend (run alongside Expo)
npx convex dev
```

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

## Documentation
- `docs/PLAN.md` — Implementation phases and feature breakdown
- `docs/ARCHITECTURE.md` — System design and data flow
- `docs/TECH_STACK.md` — Setup, build, run, and debug instructions
- `docs/API_REFERENCE.md` — External API details and rate limits
- `PROGRESS.md` — Current status, completed work, and known issues

## Contributing
1. Create a feature branch (`feat/short-description`, `fix/short-description`, `docs/short-description`).
2. Keep changes focused and open a PR for review.
