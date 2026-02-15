# Quality & Reliability

Performance, UX, and data quality standards.

## Performance Optimizations

### What's Already Optimized

- **FlashList Usage** - All major lists use FlashList instead of FlatList
- **Memoization** - Proper use of useMemo and useCallback
- **Lazy Loading** - Seasons load episodes on-demand
- **Image Optimization** - HTTPS normalization, fallback chain

### Checklist

- [x] FlashList used for all long lists
- [x] Proper `keyExtractor` functions
- [x] `estimatedItemSize` provided to FlashList
- [x] useMemo for expensive computations
- [x] useCallback for function props
- [x] Debounced search (300ms)
- [x] Client-side caching (15 min TTL)
- [x] Pagination for discovery feeds

### Target Metrics

| Metric | Target |
|--------|--------|
| Time to First Contentful Paint (FCP) | < 1.5s |
| Time to Interactive (TTI) | < 3s |
| List scroll FPS | 60fps |
| Episode toggle response | < 100ms |

### Benchmarks

| Operation | Target | Current |
|-----------|--------|---------|
| Search results render | < 100ms | ✅ ~50ms |
| Season expand | < 500ms | ✅ ~200ms |
| Episode toggle | < 100ms | ✅ ~80ms |
| Watchlist load (50 items) | < 500ms | ✅ ~300ms |

---

## Loading States

| Screen | Loading State |
|--------|---------------|
| **Show Detail** | Full-screen skeleton (hero placeholder + season accordions) |
| **Library** | Grid shimmer (FlashList with skeleton cards) |
| **Search** | Inline spinner below search bar |
| **Discover** | Pull-to-refresh + manual refresh button |
| **Profile** | Staggered load (Stats → Rails → Lists) |
| **List Detail** | Fade-in placeholder (shows list name immediately) |

### Component Loading Patterns

```typescript
// Full page loading
if (isLoading) {
  return (
    <View className="animate-pulse">
      <View className="h-96 bg-bg-elevated" /> {/* Hero skeleton */}
    </View>
  );
}

// Lazy loading
{isLoading ? (
  <View className="flex-row items-center justify-center gap-3 py-8">
    <ActivityIndicator size="small" color="#ef4444" />
    <Text className="text-sm text-text-secondary">Loading episodes...</Text>
  </View>
) : (
  // ... episodes
)}
```

---

## Error States

| Error Type | User Message | Retry Action |
|------------|--------------|--------------|
| **Network Failure** | "Connection lost. Check your internet." | Auto-retry 3x, then manual |
| **API Error (5xx)** | "Service unavailable. Try again later." | Pull-to-refresh |
| **Rate Limited** | "Too many requests. Please wait." | Auto-backoff with countdown |
| **Not Found** | "Show not found. It may have been removed." | Back button |
| **Auth Error** | "Session expired. Please sign in again." | Redirect to login |
| **Unknown Error** | "Something went wrong. Try again." | Retry button |

---

## Microcopy Standards

### Button Labels

| Action | Primary | Loading | Success |
|--------|---------|---------|---------|
| Add to Watchlist | "Add to Watchlist" | "Adding..." | "In Watchlist" |
| Mark Episode Watched | "Watch" | "Saving..." | "Watched" |
| Mark Season Watched | "Mark All" | "Marking..." | "Watched" |

### Status Labels

| Status | Display | Color |
|--------|---------|-------|
| watching | "Watching" | Green |
| plan_to_watch | "Planned" | Blue |
| paused | "Paused" | Yellow |
| dropped | "Dropped" | Red |
| completed | "Completed" | Green |

### Empty States

| Screen | Empty Message | CTA |
|--------|---------------|-----|
| **Library** | "Your library is empty" | "Discover shows" |
| **Watchlist** | "No shows in progress" | "Start watching" |
| **Lists** | "You have no lists yet" | "Create a list" |
| **Search** | "No results found" | "Try different keywords" |

### Writing Standards

- **Consistent**: "Episode" not "Ep.", "Season" not "S.", "Watched" not "Seen"
- **Action-oriented**: "Mark as watched", "Add to watchlist"
- **Friendly tone**: "Oops! Something went wrong." (not "Error 500")

---

## Metadata Fallbacks

### Fallback Chain by Field

| Field | Fallback Chain |
|-------|---------------|
| **Air Dates** | API date → Partial date (YYYY-MM) → Year only → "Air date TBA" |
| **Runtime** | Episode runtime → Show runtime → TV/Anime: 24 min, Movie: 110 min |
| **Episode Count** | API count → Calculated from array → Anime: 12, TV: 0 |
| **Episode Names** | API name → Romanji → "Episode N" |
| **Images** | Episode still → Show backdrop → Show poster → Placeholder |
| **Show Status** | API status → Normalized → "Unknown" |
| **Ratings** | API rating → Hidden if missing |
| **Overviews** | API description → HTML decoded → Empty string |

### Default Values

```typescript
export const DEFAULTS = {
  EPISODE_RUNTIME_MINUTES: 24,
  MOVIE_RUNTIME_MINUTES: 110,
};
```

### Status Normalization

```typescript
export const STATUS_NORMALIZATION: Record<string, string> = {
  "Returning Series": "returning",
  "RELEASING": "airing",
  "Currently Airing": "airing",
  "Ended": "ended",
  "FINISHED": "finished",
};
```

### Safety Mechanisms

```typescript
// Type-safe fallback
function getEpisodeRuntime(
  episode: NormalizedEpisode,
  showRuntime?: number,
  mediaType: string = "tv"
): number {  // Always returns number
  if (episode.runtime && episode.runtime > 0) {
    return episode.runtime;
  }
  if (showRuntime && showRuntime > 0) {
    return showRuntime;
  }
  return mediaType === "movie" 
    ? DEFAULTS.MOVIE_RUNTIME_MINUTES 
    : DEFAULTS.EPISODE_RUNTIME_MINUTES;
}

// Bounds checking
if (validated.rating != null && (validated.rating < 0 || validated.rating > 10)) {
  validated.rating = Math.max(0, Math.min(10, validated.rating));
}
```

---

## Quality Checklist

- [x] All screens have loading states
- [x] All error cases handled gracefully
- [x] Microcopy is consistent across app
- [x] Empty states provide clear CTAs
- [x] Loading states accessible
- [x] Error messages actionable
- [x] Button states (idle/loading/success) consistent
- [x] No "undefined" or "null" displayed
- [x] Network errors show retry option
- [x] Comprehensive fallback chain for all fields
- [x] Type-safe utility functions
- [x] Graceful UI degradation
- [x] Bounds checking and validation
