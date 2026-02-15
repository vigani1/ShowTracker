# Watch Tracking

Episode watching, status management, and automation.

## Status Values

- `watching` - Actively progressing through episodes
- `plan_to_watch` - Saved for later
- `paused` - On hold for now
- `dropped` - No longer watching
- `completed` - Finished the entire title

## Watch Actions

### Mark Episode Watched
- Tap episode radio button to toggle watched state
- Visual feedback: green checkmark appears
- Updates: watch count, season progress bar, total watch time
- State persists after refresh

### Mark Episode Unwatched
- Tap watched episode to unmark
- Visual feedback: empty circle
- Updates: watch count decreases, progress bar resets

### Batch Mark Season
- Click season "Mark All" radio button
- All released episodes marked watched
- Unreleased episodes remain unwatched
- Progress shows 100% for season
- Stats updated with total season runtime

### Mark Full Show Watched
- "Mark All as Watched" action
- All released episodes across all seasons marked
- Show status changes to "Completed"

### Movie Watching
- "Mark as Watched" toggle for movies
- Single action (no episodes)
- Updates stats and completed list

---

## Status Automation

### Rule 1: Auto-Mark Completed

**Trigger**: User marks final episode as watched  
**Condition**: All released episodes are now watched  
**Action**: Automatically set status to `completed`

```typescript
function autoMarkCompleted(
  currentStatus: UserShowStatus,
  watchedEpisodes: number,
  totalReleasedEpisodes: number
): UserShowStatus {
  if (
    currentStatus === "watching" &&
    watchedEpisodes >= totalReleasedEpisodes &&
    totalReleasedEpisodes > 0
  ) {
    return "completed";
  }
  return currentStatus;
}
```

### Rule 2: Auto-Pause After Inactivity

**Trigger**: Scheduled job runs daily  
**Condition**: Status is `watching` AND no episodes watched in 30 days  
**Action**: Set status to `paused`

```typescript
const INACTIVITY_THRESHOLD_DAYS = 30;

function shouldAutoPause(
  status: UserShowStatus,
  lastWatchedAt: number | undefined
): boolean {
  if (status !== "watching") return false;
  if (!lastWatchedAt) return false;
  
  const daysSinceLastWatch = (Date.now() - lastWatchedAt) / (1000 * 60 * 60 * 24);
  return daysSinceLastWatch >= INACTIVITY_THRESHOLD_DAYS;
}
```

### Rule 3: Resume from Paused

**Trigger**: User marks episode as watched  
**Condition**: Current status is `paused` or `plan_to_watch`  
**Action**: Automatically set status to `watching`

```typescript
function autoResumeOnActivity(
  currentStatus: UserShowStatus,
  newEpisodeWatched: boolean
): UserShowStatus {
  if (newEpisodeWatched && (currentStatus === "paused" || currentStatus === "plan_to_watch")) {
    return "watching";
  }
  return currentStatus;
}
```

### Rule 4: New Season Available

**Trigger**: Schedule shows new episodes available for tracked show  
**Condition**: Status is `completed` AND new episodes have air dates  
**Action**: Set status to `watching` AND show notification

### Rule 5: Dropped Show Reminder

**Trigger**: Scheduled job runs weekly  
**Condition**: Status is `dropped` AND 90 days since marked dropped  
**Action**: Send notification "[Show] has new episodes. Want to give it another try?"

---

## Cron Jobs

```typescript
// convex/crons.ts
export default cron.table({
  // Run daily at 2 AM to check for auto-pause
  autoPauseCheck: {
    schedule: "0 2 * * *",
    function: "shows/checkAndApplyAutoPause",
  },
  
  // Run weekly on Sundays to check for new seasons
  newSeasonCheck: {
    schedule: "0 10 * * 0",
    function: "shows/checkForNewSeasons",
  },
  
  // Run weekly to send dropped show reminders
  droppedReminderCheck: {
    schedule: "0 11 * * 0",
    function: "shows/sendDroppedReminders",
  },
});
```

---

## Testing Checklist

### TV Show Watch Actions

- [ ] Mark single episode watched → green checkmark, stats update
- [ ] Mark single episode unwatched → empty circle, stats decrease
- [ ] Batch mark season watched → all episodes marked, 100% progress
- [ ] Batch unmark season → all episodes unwatched, 0% progress
- [ ] Mark full show watched → all seasons 100%, status "Completed"
- [ ] Clear show history → all unwatched, stats reset

### Anime Watch Actions

- [ ] Mark anime episode watched → visual feedback, runtime recorded
- [ ] Complete season → next season prompt appears
- [ ] Anime without runtime → uses 24 min default

### Movie Watch Actions

- [ ] Mark movie watched → appears in completed, runtime added
- [ ] Mark movie unwatched → removed from completed, runtime subtracted

### Status Automation

- [ ] Mark all episodes watched → auto-complete triggered
- [ ] No activity 30 days → auto-pause triggered
- [ ] Resume watching paused show → auto-resume triggered
- [ ] New episodes for completed show → status changes to watching
- [ ] Dropped show gets new episodes after 90 days → reminder sent

### Cross-Device Sync

- [ ] Mark episode on web → appears on mobile within 2 seconds
- [ ] Mark episode offline → syncs when reconnected

### Edge Cases

- [ ] Show with no runtime data → uses fallback (24/110 min)
- [ ] Episode with no air date → treated as released
- [ ] Future episode → disabled with "Airs [date]" label
- [ ] Network failure → UI reverts, error shown, can retry

---

## Expected Performance

| Operation | Target |
|-----------|--------|
| Single episode toggle | < 100ms |
| Season batch mark | < 500ms for 20 episodes |
| Full show mark | < 2 seconds for 100 episodes |
| Cross-device sync | < 2 seconds |
