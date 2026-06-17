# ShowTracker

ShowTracker is a cross-platform show, anime, and movie tracker built with Expo, React Native Web, Convex, and NativeWind. It is meant to replace TVTime with a faster, cleaner, open source app for discovery, progress tracking, watchlists, schedules, custom lists, and watch statistics.

## Features

- Discover trending TV, anime, and movies.
- Search across supported media types.
- Track episode, season, full-show, and movie watch state.
- Manage Home watchlist surfaces with released/unwatched counts.
- View tracked-show schedule and upcoming episode projections.
- Create custom lists and inspect profile/watch statistics.
- Import tracked data and repair stale tracking state with bounded tools.

## Tech Stack

- **Runtime**: Expo SDK 54, React 19, React Native 0.81, React Native Web 0.21
- **Routing**: Expo Router 6
- **Language**: TypeScript 5.9 in strict mode
- **Styling**: NativeWind 4
- **Backend**: Convex with Convex Auth
- **Client state**: Convex realtime data plus small Zustand stores for client/UI state
- **Providers**: TMDB, TVMaze, AniList, and Jikan/MAL fallback

## Getting Started

```bash
npm install
npm run start:web
npx convex dev
```

Useful validation commands:

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run schedule-confidence:validate
```

## Documentation

Agents start with [AGENTS.md](AGENTS.md). The docs map is [docs/README.md](docs/README.md).

## Contributing

Create a focused branch, open or update a PR, merge to `main` once checks pass, and verify the live Netlify deployment. Keep user-owned synced data in Convex, and add an ADR for any change that can affect watchlist, schedule, release availability, provider matching, or projection behavior.
