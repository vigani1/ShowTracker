# Phase 10: Watch Status Automation

## Overview
This document defines automated status transitions and business rules for watch statuses.

## Status Values

- `watching` - Actively progressing through episodes
- `plan_to_watch` - Saved for later
- `paused` - On hold for now
- `dropped` - No longer watching
- `completed` - Finished the entire title

## Automation Rules

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
**Notification**: Send push notification "You haven't watched [Show] in 30 days. Status set to Paused."

```typescript
const INACTIVITY_THRESHOLD_DAYS = 30;

function shouldAutoPause(
  status: UserShowStatus,
  lastWatchedAt: number | undefined,
  now: number = Date.now()
): boolean {
  if (status !== "watching") return false;
  if (!lastWatchedAt) return false;
  
  const daysSinceLastWatch = (now - lastWatchedAt) / (1000 * 60 * 60 * 24);
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

```typescript
function autoResumeForNewSeason(
  currentStatus: UserShowStatus,
  hasNewEpisodes: boolean,
  lastWatchedSeason: number,
  newSeasonNumber: number
): { newStatus: UserShowStatus; shouldNotify: boolean } {
  if (currentStatus === "completed" && hasNewEpisodes && newSeasonNumber > lastWatchedSeason) {
    return { newStatus: "watching", shouldNotify: true };
  }
  return { newStatus: currentStatus, shouldNotify: false };
}
```

### Rule 5: Dropped Show Reminder

**Trigger**: Scheduled job runs weekly
**Condition**: Status is `dropped` AND 90 days since marked dropped
**Action**: Send notification "[Show] has new episodes. Want to give it another try?"

```typescript
const DROPPED_REMINDER_DAYS = 90;

function shouldSendDroppedReminder(
  status: UserShowStatus,
  droppedAt: number | undefined,
  hasNewEpisodes: boolean,
  now: number = Date.now()
): boolean {
  if (status !== "dropped") return false;
  if (!droppedAt) return false;
  if (!hasNewEpisodes) return false;
  
  const daysSinceDropped = (now - droppedAt) / (1000 * 60 * 60 * 24);
  return daysSinceDropped >= DROPPED_REMINDER_DAYS;
}
```

## Implementation

### Convex Schema Updates

```typescript
// Add to userShows table
userShows: defineTable({
  // ... existing fields
  statusChangedAt: v.optional(v.number()), // Track when status last changed
  lastWatchedAt: v.optional(v.number()),   // Track last episode watch
  droppedAt: v.optional(v.number()),       // Track when dropped
  completedAt: v.optional(v.number()),     // Track when completed
})
```

### Convex Actions

```typescript
// convex/shows.ts

export const checkAndApplyAutoPause = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    const showsToPause = await ctx.db
      .query("userShows")
      .withIndex("by_status", (q) => 
        q.eq("status", "watching").lt("lastWatchedAt", cutoff)
      )
      .collect();
    
    for (const show of showsToPause) {
      await ctx.db.patch(show._id, {
        status: "paused",
        statusChangedAt: Date.now(),
      });
      
      // Send notification
      await sendPushNotification({
        userId: show.userId,
        title: "Show auto-paused",
        body: `You haven't watched this show in 30 days. Status set to Paused.`,
        data: { showId: show.showId },
      });
    }
  },
});

export const checkForNewSeasons = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find completed shows with new seasons
    const completedShows = await ctx.db
      .query("userShows")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .collect();
    
    for (const userShow of completedShows) {
      const show = await ctx.db.get(userShow.showId);
      if (!show) continue;
      
      // Check if show has new episodes since completion
      const newEpisodes = await checkForNewEpisodes(show, userShow.completedAt);
      
      if (newEpisodes.length > 0) {
        await ctx.db.patch(userShow._id, {
          status: "watching",
          statusChangedAt: Date.now(),
        });
        
        await sendPushNotification({
          userId: userShow.userId,
          title: "New episodes available!",
          body: `${show.title} has ${newEpisodes.length} new episode(s).`,
          data: { showId: show._id },
        });
      }
    }
  },
});
```

### Schedule Configuration

```typescript
// convex/crons.ts
import { cron } from "./_generated/server";

export default cron.table({
  // Run daily at 2 AM to check for auto-pause
  autoPauseCheck: {
    schedule: "0 2 * * *", // Every day at 2:00 AM
    function: "shows/checkAndApplyAutoPause",
  },
  
  // Run weekly on Sundays to check for new seasons
  newSeasonCheck: {
    schedule: "0 10 * * 0", // Every Sunday at 10:00 AM
    function: "shows/checkForNewSeasons",
  },
  
  // Run weekly to send dropped show reminders
  droppedReminderCheck: {
    schedule: "0 11 * * 0", // Every Sunday at 11:00 AM
    function: "shows/sendDroppedReminders",
  },
});
```

## Testing Checklist

### Auto-Complete Tests
- [ ] Mark all episodes watched → Status changes to "Completed"
- [ ] Mark final episode of ongoing show → Status stays "Watching"
- [ ] Unmark one episode from completed → Status changes to "Watching"

### Auto-Pause Tests
- [ ] No activity for 30 days → Status auto-changes to "Paused"
- [ ] Activity on day 29 → No status change
- [ ] Resume watching paused show → Status changes to "Watching"

### New Season Tests
- [ ] New episodes appear for completed show → Status changes to "Watching"
- [ ] Notification sent for new episodes
- [ ] Click notification → Opens show detail

### Dropped Reminder Tests
- [ ] Dropped show gets new episodes after 90 days → Reminder sent
- [ ] No new episodes → No reminder sent
- [ ] Reminder sent less than 90 days after drop → No duplicate

## Configuration Options

Users can configure automation preferences:

```typescript
interface UserAutomationPreferences {
  autoPauseEnabled: boolean;
  autoPauseDays: number; // Default: 30
  autoCompleteEnabled: boolean;
  newSeasonNotifications: boolean;
  droppedRemindersEnabled: boolean;
  droppedReminderDays: number; // Default: 90
}
```

## UI Indicators

When status is auto-changed, show badge in UI:
- "Auto-paused after 30 days of inactivity"
- "Auto-completed - all episodes watched"
- "Resumed - new episodes available"
