import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "@/convex/_generated/server";
import type { MutationCtx, QueryCtx } from "@/convex/_generated/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { v } from "convex/values";

async function getCurrentUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId as Id<"users">;
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0min";

  const breakdown = formatDurationBreakdown(minutes);

  if (breakdown.months > 0) {
    return `${breakdown.months}mo ${breakdown.days}d ${breakdown.hours}h`;
  }

  if (breakdown.days > 0) {
    return `${breakdown.days}d ${breakdown.hours}h ${breakdown.minutes}min`;
  }

  if (breakdown.hours > 0) {
    return `${breakdown.hours}h ${breakdown.minutes}min`;
  }

  return `${breakdown.minutes}min`;
}

function formatDurationBreakdown(minutes: number): {
  months: number;
  days: number;
  hours: number;
  minutes: number;
} {
  const monthMinutes = 30.44 * 24 * 60;
  let rem = minutes;

  let months = Math.floor(rem / monthMinutes);
  rem -= months * monthMinutes;

  let days = Math.floor(rem / (24 * 60));
  rem -= days * 24 * 60;

  let hours = Math.floor(rem / 60);
  let mins = Math.round(rem - hours * 60);

  if (mins === 60) {
    mins = 0;
    hours += 1;
  }

  if (hours === 24) {
    hours = 0;
    days += 1;
  }

  if (days >= 30) {
    months += Math.floor(days / 30);
    days %= 30;
  }

  return { months, days, hours, minutes: mins };
}

function prettifyHandle(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/^@+/, "")
    .replace(/[|]+/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  return normalized
    .split(" ")
    .slice(0, 3)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractCandidateFromTokenIdentifier(tokenIdentifier?: string): string {
  if (!tokenIdentifier) return "";
  const trimmed = tokenIdentifier.trim();
  if (!trimmed) return "";
  let lastSegment = trimmed;
  if (trimmed.includes("|")) {
    const parts = trimmed.split("|");
    lastSegment = parts[parts.length - 1] ?? "";
  }
  if (!lastSegment) return "";
  if (lastSegment.includes("@")) {
    return lastSegment.split("@")[0] ?? "";
  }
  return lastSegment;
}

function resolveDisplayName(args: {
  profileUsername?: string;
  profileTokenIdentifier?: string;
}): string {
  const explicitProfileName = args.profileUsername?.trim() ?? "";
  if (explicitProfileName) return explicitProfileName;

  const tokenCandidate = extractCandidateFromTokenIdentifier(
    args.profileTokenIdentifier,
  );
  if (tokenCandidate) return prettifyHandle(tokenCandidate);

  return "ShowTracker User";
}

function calculateStreak(watchedDates: number[]): {
  currentStreak: number;
  longestStreak: number;
} {
  if (watchedDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Get unique dates (only count one watch per day for streaks)
  const uniqueDates = Array.from(
    new Set(
      watchedDates.map((timestamp) => {
        const date = new Date(timestamp);
        return new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
        ).getTime();
      }),
    ),
  ).sort((a, b) => a - b);

  let currentStreak = 0;
  let longestStreak = 0;
  let currentCount = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  // Check if today has activity
  const hasActivityToday = uniqueDates.includes(todayTime);

  // Calculate current streak
  if (hasActivityToday) {
    currentStreak = 1;
    let checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - 1);

    while (uniqueDates.includes(checkDate.getTime())) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  } else {
    // Check if yesterday had activity (streak could still be active)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (uniqueDates.includes(yesterday.getTime())) {
      currentStreak = 1;
      let checkDate = new Date(yesterday);
      checkDate.setDate(checkDate.getDate() - 1);

      while (uniqueDates.includes(checkDate.getTime())) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
    }
  }

  // Calculate longest streak
  for (let i = 0; i < uniqueDates.length; i++) {
    if (i === 0) {
      currentCount = 1;
    } else {
      const prevDate = new Date(uniqueDates[i - 1]);
      const currDate = new Date(uniqueDates[i]);
      const diffDays =
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        currentCount++;
      } else {
        longestStreak = Math.max(longestStreak, currentCount);
        currentCount = 1;
      }
    }
  }
  longestStreak = Math.max(longestStreak, currentCount);

  return { currentStreak, longestStreak };
}

export const getUserStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    // Get all user shows with precomputed watch aggregates.
    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Resolve all referenced shows once to avoid repeated reads.
    const uniqueShowIds = Array.from(
      new Set<Id<"shows">>(userShows.map((userShow) => userShow.showId)),
    );

    const showDocs = await Promise.all(
      uniqueShowIds.map((showId) => ctx.db.get(showId)),
    );
    const showById = new Map<string, Doc<"shows">>();
    uniqueShowIds.forEach((showId, index) => {
      const show = showDocs[index];
      if (show) {
        showById.set(showId.toString(), show);
      }
    });

    // Calculate basic counts
    let uniqueEpisodesWatched = 0;
    let totalWatchEvents = 0;
    let tvEpisodes = 0;
    let tvWatchTimeMinutes = 0;
    let animeEpisodes = 0;
    let animeWatchTimeMinutes = 0;
    let movieCount = 0;
    let movieWatchTimeMinutes = 0;

    const showWatchCounts = new Map<string, number>();

    for (const userShow of userShows) {
      const show = showById.get(userShow.showId.toString());
      if (!show) {
        continue;
      }

      const watchedEpisodesCount = Math.max(
        0,
        Math.floor(userShow.watchedEpisodesCount ?? 0),
      );
      const watchedTotalCount = Math.max(
        watchedEpisodesCount,
        Math.floor(userShow.watchedTotalCount ?? watchedEpisodesCount),
      );
      const rewatchCount = Math.max(
        watchedTotalCount - watchedEpisodesCount,
        0,
      );
      const fallbackRuntimeMinutes =
        Math.max(0, show.episodeRuntime ?? 0) * watchedTotalCount;
      const watchedRuntimeMinutes = Math.max(
        0,
        Math.floor(
          typeof userShow.watchedRuntimeMinutes === "number"
            ? userShow.watchedRuntimeMinutes
            : fallbackRuntimeMinutes,
        ),
      );

      uniqueEpisodesWatched += watchedEpisodesCount;
      totalWatchEvents += rewatchCount;

      if (rewatchCount > 0) {
        showWatchCounts.set(show._id.toString(), rewatchCount);
      }

      if (show.mediaType === "tv") {
        tvEpisodes += watchedTotalCount;
        tvWatchTimeMinutes += watchedRuntimeMinutes;
        continue;
      }

      if (show.mediaType === "anime") {
        animeEpisodes += watchedTotalCount;
        animeWatchTimeMinutes += watchedRuntimeMinutes;
        continue;
      }

      if (show.mediaType === "movie") {
        if (userShow.status === "completed") {
          movieCount += 1;
        }
        movieWatchTimeMinutes += watchedRuntimeMinutes;
      }
    }

    const totalRewatches = Math.max(totalWatchEvents, 0);

    // Bound streak computation to recent episode rows so large accounts stay under query limits.
    const streakEpisodeSamples = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_watchedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10000);

    const watchedTimestamps: number[] = [];
    for (const episode of streakEpisodeSamples) {
      watchedTimestamps.push(episode.watchedAt);
      if (episode.watchHistory) {
        for (const timestamp of episode.watchHistory) {
          watchedTimestamps.push(timestamp);
        }
      }
    }

    // Calculate streaks
    const { currentStreak, longestStreak } = calculateStreak(watchedTimestamps);

    // Find most re-watched shows
    const topRewatchedEntries = Array.from(showWatchCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const topRewatchedShows = topRewatchedEntries.map(([showId, count]) => {
      const show = showById.get(showId);
      return {
        title: show?.title ?? "Unknown",
        watchCount: count,
      };
    });

    // Count completed shows
    const completedShows = userShows.filter(
      (us) => us.status === "completed",
    ).length;

    // Get user profile for social stats
    const userProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const userSocial = await ctx.db
      .query("userSocial")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const displayName = resolveDisplayName({
      profileUsername: userProfile?.username,
      profileTokenIdentifier: userProfile?.tokenIdentifier,
    });

    // Calculate total across all types
    const allWatchTimeMinutes =
      tvWatchTimeMinutes + animeWatchTimeMinutes + movieWatchTimeMinutes;

    return {
      // Episode stats
      uniqueEpisodesWatched,
      totalRewatches,
      totalEpisodesWatched: uniqueEpisodesWatched + totalRewatches,

      // Breakdown by type
      tvEpisodes,
      animeEpisodes,
      movieCount,

      // Total watch time
      totalWatchTimeMinutes: allWatchTimeMinutes,
      totalWatchTimeFormatted: formatDuration(allWatchTimeMinutes),
      totalWatchTimeBreakdown: formatDurationBreakdown(allWatchTimeMinutes),

      // TV watch time
      tvWatchTimeMinutes,
      tvWatchTimeFormatted: formatDuration(tvWatchTimeMinutes),
      tvWatchTimeBreakdown: formatDurationBreakdown(tvWatchTimeMinutes),

      // Anime watch time
      animeWatchTimeMinutes,
      animeWatchTimeFormatted: formatDuration(animeWatchTimeMinutes),
      animeWatchTimeBreakdown: formatDurationBreakdown(animeWatchTimeMinutes),

      // Movie watch time
      movieWatchTimeMinutes,
      movieWatchTimeFormatted: formatDuration(movieWatchTimeMinutes),
      movieWatchTimeBreakdown: formatDurationBreakdown(movieWatchTimeMinutes),

      // Streaks
      currentStreak,
      longestStreak,

      // Show completion
      completedShows,
      totalTrackedShows: userShows.length,

      // Top re-watched
      topRewatchedShows,

      // Social stats
      followingCount: userSocial?.followingCount ?? 0,
      followersCount: userSocial?.followersCount ?? 0,
      commentsCount: userSocial?.commentsCount ?? 0,

      // Profile info
      username: displayName,
      bio: userProfile?.bio ?? "",
      avatarUrl: userProfile?.avatarUrl,
      bannerUrl: userProfile?.bannerUrl,
    };
  },
});

export const upsertUserProfile = mutation({
  args: {
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const username = (args.username ?? "").trim().slice(0, 32);
    const bio = (args.bio ?? "").trim().slice(0, 280);
    const avatarUrl = (args.avatarUrl ?? "").trim().slice(0, 500);
    const bannerUrl = (args.bannerUrl ?? "").trim().slice(0, 500);
    const tokenIdentifier = existingProfile?.tokenIdentifier;
    const createdAt = existingProfile?.createdAt ?? Date.now();

    const nextData = {
      username,
      bio,
      avatarUrl,
      bannerUrl,
      createdAt,
      ...(tokenIdentifier ? { tokenIdentifier } : {}),
    };

    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, nextData);
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        ...nextData,
      });
    }

    return {
      username,
      bio,
      avatarUrl,
      bannerUrl,
    };
  },
});

export const getUserFavorites = query({
  args: {
    mediaType: v.optional(
      v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const limit = args.limit ?? 20;

    let favorites;
    const mediaTypeFilter = args.mediaType;
    if (mediaTypeFilter) {
      favorites = await ctx.db
        .query("userFavorites")
        .withIndex("by_user_mediaType", (q) =>
          q.eq("userId", userId).eq("mediaType", mediaTypeFilter),
        )
        .order("desc")
        .take(limit);
    } else {
      favorites = await ctx.db
        .query("userFavorites")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit);
    }

    const shows = await Promise.all(
      favorites.map(async (fav) => {
        const show = await ctx.db.get(fav.showId);
        return {
          id: fav.showId,
          title: show?.title ?? "Unknown",
          posterUrl: show?.posterUrl,
          backdropUrl: show?.backdropUrl,
          mediaType: show?.mediaType ?? fav.mediaType,
          tmdbId: show?.tmdbId ?? null,
          anilistId: show?.anilistId ?? null,
          malId: show?.malId ?? null,
        };
      }),
    );

    return shows;
  },
});

export const getWatchHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const limit = args.limit ?? 50;

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_watchedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    const history = await Promise.all(
      watchedEpisodes.map(async (entry) => {
        const show = await ctx.db.get(entry.showId);
        return {
          id: entry._id,
          showTitle: show?.title ?? "Unknown",
          mediaType: show?.mediaType ?? "tv",
          season: entry.season,
          episode: entry.episode,
          watchedAt: entry.watchedAt,
          watchCount: entry.watchCount ?? 1,
          watchHistory: entry.watchHistory ?? [entry.watchedAt],
        };
      }),
    );

    return history;
  },
});
