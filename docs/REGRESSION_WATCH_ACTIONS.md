# Phase 10: Watch Actions Regression Checklist

## Overview
This document provides comprehensive test cases for watch action functionality across TV shows, anime, and movies.

## Test Matrix

### 1. Episode Watch Actions (TV Shows)

#### 1.1 Mark Single Episode Watched
- [ ] Navigate to a TV show with unwatched episodes
- [ ] Click on unwatched episode radio button
- [ ] Verify: Episode marked as watched (green checkmark appears)
- [ ] Verify: Watch count increases in stats
- [ ] Verify: Season progress bar updates
- [ ] Verify: Watch time adds episode runtime
- [ ] Refresh page, verify state persists

#### 1.2 Mark Single Episode Unwatched
- [ ] Navigate to a TV show with watched episodes
- [ ] Click on watched episode radio button
- [ ] Verify: Episode marked as unwatched (empty circle)
- [ ] Verify: Watch count decreases in stats
- [ ] Verify: Season progress bar updates
- [ ] Verify: Watch time subtracts episode runtime
- [ ] Refresh page, verify state persists

#### 1.3 Rewatch Episode
- [ ] Navigate to a watched episode
- [ ] Long-press or use rewatch option
- [ ] Verify: Episode remains marked as watched
- [ ] Verify: Watch count increments (now 2x)
- [ ] Verify: Watch history shows multiple watches
- [ ] Verify: Total watch time increases

#### 1.4 Batch Mark Season Watched
- [ ] Navigate to a TV show with unwatched season
- [ ] Click season "Mark All" radio button
- [ ] Verify: All released episodes marked watched
- [ ] Verify: Unreleased episodes remain unwatched
- [ ] Verify: Progress shows 100% for season
- [ ] Verify: Stats updated with total season runtime

#### 1.5 Batch Unmark Season
- [ ] Navigate to a fully watched season
- [ ] Click season "Mark All" radio button (toggle off)
- [ ] Verify: All episodes marked as unwatched
- [ ] Verify: Progress resets to 0%
- [ ] Verify: Stats subtract season runtime

### 2. Episode Watch Actions (Anime)

#### 2.1 Mark Anime Episode Watched
- [ ] Navigate to an anime show
- [ ] Click episode radio button
- [ ] Verify: Episode marked watched with visual feedback
- [ ] Verify: Runtime correctly recorded from Jikan data
- [ ] Verify: Progress updates

#### 2.2 Complete Season Navigation
- [ ] Mark all episodes in anime season as watched
- [ ] Verify: Next season prompt appears (if related anime exists)
- [ ] Click "Continue to Next Season"
- [ ] Verify: Navigation to next season in franchise

#### 2.3 Anime Episode Fallback Runtime
- [ ] Test anime with no runtime data
- [ ] Verify: Default runtime (24 min) used
- [ ] Verify: Watch time calculated correctly

### 3. Movie Watch Actions

#### 3.1 Mark Movie Watched
- [ ] Navigate to a movie
- [ ] Click "Mark as Watched" button
- [ ] Verify: Movie marked as watched
- [ ] Verify: Appears in completed movies list
- [ ] Verify: Watch time adds movie runtime

#### 3.2 Mark Movie Unwatched
- [ ] Navigate to a watched movie
- [ ] Click to unmark
- [ ] Verify: Movie no longer marked as watched
- [ ] Verify: Removed from completed list
- [ ] Verify: Watch time subtracted

#### 3.3 Rewatch Movie
- [ ] Navigate to watched movie
- [ ] Use rewatch option
- [ ] Verify: Watch count increments
- [ ] Verify: Appears multiple times in history

### 4. Full Show Actions

#### 4.1 Mark Full Show Watched
- [ ] Navigate to show with multiple seasons
- [ ] Use "Mark All as Watched" action
- [ ] Verify: All released episodes marked
- [ ] Verify: All seasons show 100% progress
- [ ] Verify: Show status changes to "Completed"

#### 4.2 Clear Show History
- [ ] Navigate to fully watched show
- [ ] Use "Clear All History" action
- [ ] Verify: All episodes marked unwatched
- [ ] Verify: Rewatch counts cleared
- [ ] Verify: Stats updated

### 5. Cross-Device Sync

#### 5.1 Real-time Episode Sync
- [ ] Open show on web browser
- [ ] Open same show on mobile
- [ ] Mark episode watched on web
- [ ] Verify: Episode appears watched on mobile within 2 seconds

#### 5.2 Offline Episode Actions
- [ ] Enable airplane mode on mobile
- [ ] Mark episode watched
- [ ] Disable airplane mode
- [ ] Verify: Action syncs to server
- [ ] Verify: Appears on web within 5 seconds

### 6. Edge Cases

#### 6.1 Missing Runtime Data
- [ ] Test show with no episode runtime data
- [ ] Mark episodes watched
- [ ] Verify: Uses fallback runtime
- [ ] Verify: No errors in console

#### 6.2 Missing Air Date
- [ ] Test episode with no air date
- [ ] Verify: Episode treated as released (optimistic)
- [ ] Verify: Can be marked watched

#### 6.3 Future Episodes
- [ ] Test episode with future air date
- [ ] Verify: Shows "Airs [date]" label
- [ ] Verify: Cannot be marked watched (disabled)

#### 6.4 Large Episode Count
- [ ] Test show with 100+ episodes
- [ ] Verify: Batch mark operations complete quickly
- [ ] Verify: No performance degradation

### 7. Error Handling

#### 7.1 Network Failure on Toggle
- [ ] Start marking episode
- [ ] Disconnect network
- [ ] Verify: Error message shown
- [ ] Verify: UI reverts to previous state
- [ ] Reconnect, retry - verify succeeds

#### 7.2 Server Error
- [ ] Simulate server error (503)
- [ ] Attempt watch action
- [ ] Verify: User-friendly error message
- [ ] Verify: Can retry action

## Automation Commands

Run these test commands (when tests are implemented):

```bash
# Run all unit tests
npx jest

# Run all integration tests  
npx jest --testPathPattern="convex"

# Run E2E tests (when implemented)
npx playwright test
```

Note: Unit/integration/E2E tests for watch actions are not yet implemented. 
To add tests, create test files in the appropriate directories (e.g., 
`lib/*.test.ts` for unit tests, `convex/*.test.ts` for integration tests, 
or `e2e/*.spec.ts` for E2E tests).

## Test Data Requirements

1. TV Show with multiple seasons (e.g., Breaking Bad, The Office)
2. Anime with episodes (e.g., Attack on Titan)
3. Movie (e.g., The Dark Knight)
4. Show with missing metadata (no runtime/air dates)
5. Show with future episodes (currently airing)

## Expected Performance

- Single episode toggle: < 100ms
- Season batch mark: < 500ms for 20 episodes
- Full show mark: < 2 seconds for 100 episodes
- Cross-device sync: < 2 seconds
