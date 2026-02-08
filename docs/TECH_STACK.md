# ShowTracker Tech Stack & Development Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ (LTS recommended) | [nodejs.org](https://nodejs.org) |
| npm | 9+ (comes with Node) | Included with Node.js |
| Expo CLI | Latest | `npm install -g expo-cli` (or use npx) |
| Convex CLI | Latest | `npm install -g convex` (or use npx) |
| Git | Any recent version | [git-scm.com](https://git-scm.com) |

## First-Time Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd ShowTracker

# 2. Install dependencies
npm install

# 3. Initialize Convex (if not already done)
npx convex init

# 4. Set up environment variables
cp .env.example .env
# Fill in your API keys (see Environment Variables below)

# 5. Push Convex schema to dev
npx convex dev
```

## Environment Variables

Create a `.env` file in the project root:

```env
# TMDB API
EXPO_PUBLIC_TMDB_API_KEY=your_tmdb_api_key_here
EXPO_PUBLIC_TMDB_BASE_URL=https://api.themoviedb.org/3

# Convex
CONVEX_DEPLOYMENT=dev:your-deployment-name
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# AniList (no key needed, but base URL for reference)
EXPO_PUBLIC_ANILIST_URL=https://graphql.anilist.co

# TVMaze (no key needed)
EXPO_PUBLIC_TVMAZE_BASE_URL=https://api.tvmaze.com

# Jikan (no key needed)
EXPO_PUBLIC_JIKAN_BASE_URL=https://api.jikan.moe/v4
```

### Getting API Keys

- **TMDB**: Create account at [themoviedb.org](https://www.themoviedb.org/), go to Settings → API → Request API Key
- **Convex**: Automatically configured when running `npx convex init`
- **AniList, TVMaze, Jikan**: No API keys required

### Convex Environment Variables

For server-side secrets (Convex actions that call external APIs), set them via the Convex dashboard or CLI:

```bash
npx convex env set TMDB_API_KEY your_key_here
```

## Running Development

You need **two terminals** running simultaneously:

```bash
# Terminal 1: Expo dev server
npx expo start

# Terminal 2: Convex dev backend
npx convex dev
```

### Platform-Specific

```bash
# Web only
npx expo start --web

# iOS simulator
npx expo start --ios

# Android emulator
npx expo start --android

# Clear cache and start fresh
npx expo start --clear
```

## Building & Deploying

### Convex Deployment

```bash
# Deploy to production
npx convex deploy

# View Convex dashboard
npx convex dashboard
```

### Expo Build (EAS)

```bash
# Install EAS CLI
npm install -g eas-cli

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android

# Build for web (static export)
npx expo export --platform web
```

## Project Dependencies

### Core
| Package | Purpose |
|---------|---------|
| expo | App framework |
| expo-router | File-based routing |
| nativewind | Tailwind CSS for React Native |
| convex | Backend-as-a-service |
| @convex-dev/auth | Authentication |

### UI & UX
| Package | Purpose |
|---------|---------|
| @shopify/flash-list | High-performance lists |
| expo-image | Optimized image loading |
| @expo/vector-icons | Icon library |
| react-native-reanimated | Animations |
| react-native-gesture-handler | Touch gestures |

### State & Storage
| Package | Purpose |
|---------|---------|
| zustand | Client state management |
| react-native-mmkv | Fast key-value storage |

## Common Errors & Fixes

### Metro Bundler Issues
```bash
# Clear Metro cache
npx expo start --clear

# If that doesn't work, delete node_modules and reinstall
rm -rf node_modules
npm install
npx expo start --clear
```

### NativeWind Not Applying Styles
- Ensure `babel.config.js` has the NativeWind plugin
- Ensure `tailwind.config.js` content array includes all component paths
- Restart Metro after config changes: `npx expo start --clear`

### Convex Connection Issues
```bash
# Check Convex deployment status
npx convex status

# Re-authenticate
npx convex login

# Reset dev deployment
npx convex dev --once
```

### TypeScript Errors After Schema Changes
```bash
# Regenerate Convex types
npx convex dev --once

# This creates/updates convex/_generated/ directory
```

### Expo Image Not Loading on Web
- Ensure `expo-image` is properly configured in `app.json`
- On web, verify CORS headers allow image loading from TMDB/AniList CDNs

### Module Resolution Errors
```bash
# Reset all caches
npx expo start --clear
# If persists, delete .expo/ directory
rm -rf .expo
```

## Development Workflow

1. Start Convex dev backend (`npx convex dev`)
2. Start Expo dev server (`npx expo start`)
3. Make changes — hot reload applies automatically
4. If changing Convex schema, the `convex dev` watcher auto-pushes changes
5. Run linter before committing: `npx expo lint`
6. Test on web first (fastest iteration), then mobile

## Useful Commands Reference

| Command | Purpose |
|---------|---------|
| `npx expo start` | Start dev server |
| `npx expo start --web` | Web only |
| `npx expo start --clear` | Start with clean cache |
| `npx convex dev` | Start Convex dev backend |
| `npx convex deploy` | Deploy Convex to production |
| `npx convex dashboard` | Open Convex dashboard |
| `npx expo lint` | Run linter |
| `npx expo export --platform web` | Export for web deployment |
