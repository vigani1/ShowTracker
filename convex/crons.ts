import { cronJobs } from "convex/server";
import { internal } from "@/convex/_generated/api";

/**
 * Scheduled automation tasks for ShowTracker
 * 
 * Auto-Pause: Runs daily to pause shows with no activity for 30 days
 */

const crons = cronJobs();

// Cron syntax: minute hour day month dayOfWeek, evaluated in UTC.
// Keep maintenance after the UTC schedule day has rolled over.
crons.cron(
  "autoPauseInactiveShows",
  "45 0 * * *",
  internal.shows.autoPauseInactiveShows
);

// Manual fallback only. Release/schedule confidence is owned by the external
// SQLite reconciler, which applies compact deltas through scheduleConfidence.
// Keep these callable for dev verification or emergency repair, but do not
// schedule Convex-side provider/schedule sweeps by default.
//
// internal.shows.refreshCompletedShowsForNewEpisodes
// internal.schedule.runMonthlyHomeWatchlistScheduleSignalBackfill

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
