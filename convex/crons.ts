import { cronJobs } from "convex/server";
import { internal } from "@/convex/_generated/api";

/**
 * Scheduled automation tasks for ShowTracker
 * 
 * Auto-Pause: Runs daily to pause shows with no activity for 30 days
 */

const crons = cronJobs();

// Run daily at 2 AM to auto-pause inactive shows
// Cron syntax: minute hour day month dayOfWeek
// "0 2 * * *" = Every day at 2:00 AM UTC
crons.cron(
  "autoPauseInactiveShows",
  "0 2 * * *",
  internal.shows.autoPauseInactiveShows
);

// TODO: Implement new season detection when notifications are added
// crons.weekly(
//   "checkForNewSeasons",
//   { day: "sunday", hourUTC: 10, minuteUTC: 0 },
//   internal.shows.checkForNewSeasons
// );

// TODO: Implement dropped show reminders when notifications are added
// crons.weekly(
//   "sendDroppedReminders",
//   { day: "sunday", hourUTC: 11, minuteUTC: 0 },
//   internal.shows.sendDroppedReminders
// );

export default crons;
