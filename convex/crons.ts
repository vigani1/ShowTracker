import { cronJobs } from "convex/server";
import { internal } from "@/convex/_generated/api";

/**
 * Scheduled automation tasks for ShowTracker
 * 
 * Auto-Pause: Runs daily to pause shows with no activity for 30 days
 */

const crons = cronJobs();

// Run daily before metadata refresh so newly resumed completed shows are not
// immediately paused by stale lastWatchedAt values.
// Cron syntax: minute hour day month dayOfWeek
// "45 1 * * *" = Every day at 1:45 AM UTC
crons.cron(
  "autoPauseInactiveShows",
  "45 1 * * *",
  internal.shows.autoPauseInactiveShows
);

// Run daily at 2 AM UTC. This refreshes completed TV/anime titles so old
// completed shows can resurface when providers release new episodes.
crons.cron(
  "refreshCompletedShowsForNewEpisodes",
  "0 2 * * *",
  internal.shows.refreshCompletedShowsForNewEpisodes
);

// Run monthly after the previous calendar month has fully settled. This is a
// schedule-cache-only safety net for users who did not open the app while old
// tracked shows released new episodes.
crons.cron(
  "monthlyHomeWatchlistScheduleSignals",
  "30 3 2 * *",
  internal.schedule.runMonthlyHomeWatchlistScheduleSignalBackfill
);

// Manual repair only: dailyReconcileProjections is intentionally not scheduled.
// It performs a full aggregate/projection rebuild and is too expensive for
// routine production use. Run it manually after migrations or data repair.

// TODO: Implement dropped show reminders when notifications are added
// crons.weekly(
//   "sendDroppedReminders",
//   { day: "sunday", hourUTC: 11, minuteUTC: 0 },
//   internal.shows.sendDroppedReminders
// );

export default crons;
