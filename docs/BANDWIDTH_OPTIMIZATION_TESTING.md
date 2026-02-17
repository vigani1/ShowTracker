# Bandwidth Optimization — Testing Guide

## Prerequisites

1. **Convex dev running**: `npx convex dev`
2. **Expo dev running**: `npx expo start --web` (or with mobile)
3. **Backfill complete**: The schema deploys automatically with `convex dev`. Run the backfill once:
   ```bash
   # Backfill mediaType on existing userShows (run until patched=0)
   npx convex run --no-push shows:backfillUserShowsMediaType

   # Build feed projections for all users
   npx convex run --no-push shows:dailyReconcileProjections
   ```
   You only need to do this once. After that, all new writes maintain projections automatically.

---

## What Changed (and Where to Test)

### 1. Home Feed — `/` (Home tab → Watchlist)

**What changed:** The Home watchlist now reads from `feedProjections` instead of doing N+1 queries (1 userShows read + 1 show read per tracked title).

**What to expect:**
- Same cards as before: poster, title, "X LEFT" badge, episode progress
- Anime franchise grouping still works — only one entry per franchise (the one you're currently watching)
- Movies are excluded (same as before)
- Sorted by most recently watched

**How to test:**
- Open Home → Watchlist tab. Verify all your tracked shows appear.
- Compare the count and titles against what you see in Library (filtering to watching/active).
- Mark an episode watched on a show, go back to Home — the "X LEFT" count should update immediately.
- If you finish an anime season, the next relation should appear in its place.

---

### 2. Home Feed — `/` (Home tab → Upcoming)

**What changed:** The Upcoming schedule now reads tracked-show metadata from `feedProjections` instead of joining userShows + shows.

**What to expect:**
- Same episode cards grouped by date
- Same "X DAYS" countdown badges
- Same Load Earlier / Load Later / Jump to Today controls

**How to test:**
- Switch to the Upcoming tab on Home.
- Verify episodes appear for your tracked shows.
- Click a show card — it should navigate to the correct show detail page.

---

### 3. Library — `/library`

**What changed:**
- Media type tabs (All, TV Shows, Anime, Movies) now filter server-side via Convex index instead of client-side.
- Status badge counts (Watching: 5, Planned: 3, etc.) come from a dedicated `getLibraryCounts` query instead of counting the full library client-side.

**What to expect:**
- Same show grid with status filter chips
- Badge counts on status chips should match the actual number of shows
- Switching between TV Shows / Anime / Movies tabs should feel the same (but uses fewer reads)

**How to test:**
- Open Library. Check that badge counts on each status chip are correct.
- Switch between All → TV Shows → Anime → Movies. Each should show the right subset.
- Add a new show to your watchlist, come back to Library — it should appear with correct counts updated.

---

### 4. Discover — `/discover`

**What changed:** Uses a lightweight `getTrackedIds` query (returns only mediaType + tmdbId + anilistId per tracked show) instead of loading the full library with all metadata.

**What to expect:**
- Trending shows grid looks the same
- Shows you already track should still show the "In Library" or tracking indicator
- Hero banner and category tabs unchanged

**How to test:**
- Open Discover. Verify trending shows load.
- Find a show you're already tracking — it should be marked as tracked.
- Find a show you're NOT tracking — no tracking indicator.

---

### 5. For You / Recommendations — `/recommendations`

**What changed:** Same as Discover — uses `getTrackedIds` instead of full library load.

**What to expect:**
- Personalized recommendations still appear across All / TV Shows / Anime / Movies tabs
- Already-tracked shows are excluded from recommendations (same as before)

**How to test:**
- Open For You. Verify recommendations load across all tabs.
- Confirm none of your currently tracked shows appear in the recommendations.

---

### 6. Profile — `/profile`

**What changed:** Profile now uses a lightweight summary query for first paint, then lazy-loads heavy sections (`getUserStats`, favorites, lists, full library) shortly after render.

**What to expect:** Hero/profile header appears quickly; detailed stats and rails load moments later without changing behavior.

**How to test:** Open Profile. Verify header appears first, then detailed stats and poster rails load correctly.

---

## Edge Cases to Verify

| Scenario | Where | Expected |
|----------|-------|----------|
| Add a new show | Show detail → Add to Watchlist | Appears on Home within seconds, Library counts update |
| Remove a show | Show detail → Remove from Watchlist | Disappears from Home, Library counts update |
| Change status to "Completed" | Show detail → Status dropdown | Disappears from Home watchlist (completed shows hidden) |
| Change status to "Paused" | Show detail → Status dropdown | Hidden from Home watchlist (paused entries are filtered in `app/(tabs)/home/index.tsx` `filteredWatchlist`) |
| Mark all episodes watched on anime | Show detail → Mark all watched | Next relation in franchise should surface on Home |
| Mark episode watched | Show detail → Episode checkbox | "X LEFT" badge updates on Home |

---

## Daily Cron (Automatic)

A cron job runs at **3 AM UTC daily** that:
1. Backfills `mediaType` on any userShows rows missing it
2. Rebuilds all feed projections from scratch for every user

This catches any drift from missed mutation hooks or show metadata updates (new episodes, new seasons).

You can trigger it manually anytime:
```bash
npx convex run --no-push shows:dailyReconcileProjections
```

---

## If Something Looks Wrong

If the Home feed is missing shows or showing stale data:
```bash
# Rebuild projections for all users
npx convex run --no-push shows:dailyReconcileProjections
```

This is a full rebuild and takes a few seconds. After it completes, refresh the Home page.

The old `getWatchlist` query is still in the codebase (unused by frontend) as a reference — it hasn't been deleted yet.
