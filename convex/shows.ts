import {
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { auth } from "./auth";

const showInput = {
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  imdbId: v.optional(v.string()),
  mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
  title: v.string(),
  overview: v.optional(v.string()),
  posterUrl: v.optional(v.string()),
  backdropUrl: v.optional(v.string()),
  genres: v.optional(v.array(v.string())),
  status: v.optional(v.string()),
  totalEpisodes: v.optional(v.number()),
  totalSeasons: v.optional(v.number()),
  episodeRuntime: v.optional(v.number()),
  rating: v.optional(v.number()),
  firstAired: v.optional(v.string()),
  lastUpdated: v.number(),
};

const showLookupInput = {
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
};

function hasLookupArgs(args: {
  tmdbId?: number;
  anilistId?: number;
  tvmazeId?: number;
}) {
  return (
    typeof args.tmdbId === "number" ||
    typeof args.anilistId === "number" ||
    typeof args.tvmazeId === "number"
  );
}

function getExternalShowId(show: {
  tmdbId?: number | null;
  anilistId?: number | null;
  tvmazeId?: number | null;
  imdbId?: string | null;
}) {
  if (typeof show.tmdbId === "number") {
    return String(show.tmdbId);
  }
  if (typeof show.anilistId === "number") {
    return String(show.anilistId);
  }
  if (typeof show.tvmazeId === "number") {
    return String(show.tvmazeId);
  }
  if (typeof show.imdbId === "string" && show.imdbId.trim()) {
    return show.imdbId;
  }
  return null;
}

async function getCurrentUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await auth.getUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

async function findShowByLookup(
  ctx: QueryCtx | MutationCtx,
  args: {
    tmdbId?: number;
    anilistId?: number;
    tvmazeId?: number;
  }
) {
  const byTmdb =
    typeof args.tmdbId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_tmdbId", (q) => q.eq("tmdbId", args.tmdbId))
          .unique()
      : null;
  if (byTmdb) {
    return byTmdb;
  }

  const byAniList =
    typeof args.anilistId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_anilistId", (q) => q.eq("anilistId", args.anilistId))
          .unique()
      : null;
  if (byAniList) {
    return byAniList;
  }

  const byTvMaze =
    typeof args.tvmazeId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_tvmazeId", (q) => q.eq("tvmazeId", args.tvmazeId))
          .unique()
      : null;

  return byTvMaze;
}

async function ensureShowRecordId(
  ctx: MutationCtx,
  args: {
    tmdbId?: number;
    anilistId?: number;
    tvmazeId?: number;
    imdbId?: string;
    mediaType: "tv" | "anime" | "movie";
    title: string;
    overview?: string;
    posterUrl?: string;
    backdropUrl?: string;
    genres?: string[];
    status?: string;
    totalEpisodes?: number;
    totalSeasons?: number;
    episodeRuntime?: number;
    rating?: number;
    firstAired?: string;
    lastUpdated: number;
  }
): Promise<Doc<"shows">["_id"]> {
  const existing = await findShowByLookup(ctx, args);
  if (existing) {
    await ctx.db.patch(existing._id, args);
    return existing._id;
  }
  return ctx.db.insert("shows", args);
}

async function ensureShow(
  ctx: MutationCtx,
  args: {
    tmdbId?: number;
    anilistId?: number;
    tvmazeId?: number;
    imdbId?: string;
    mediaType: "tv" | "anime" | "movie";
    title: string;
    overview?: string;
    posterUrl?: string;
    backdropUrl?: string;
    genres?: string[];
    status?: string;
    totalEpisodes?: number;
    totalSeasons?: number;
    episodeRuntime?: number;
    rating?: number;
    firstAired?: string;
    lastUpdated: number;
  }
): Promise<Doc<"shows">["_id"]> {
  return ensureShowRecordId(ctx, args);
}

export const upsertShow = mutation({
  args: showInput,
  handler: async (ctx, args) => {
    await getCurrentUserId(ctx);
    return ensureShow(ctx, args);
  },
});

export const getUserShowTracking = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args)) {
      return {
        showId: null,
        inWatchlist: false,
        status: null,
        watchedEpisodeKeys: [] as string[],
        watchedEpisodes: 0,
      };
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return {
        showId: null,
        inWatchlist: false,
        status: null,
        watchedEpisodeKeys: [] as string[],
        watchedEpisodes: 0,
      };
    }

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .unique();

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .collect();

    return {
      showId: getExternalShowId(show),
      inWatchlist: userShow !== null,
      status: userShow?.status ?? null,
      watchedEpisodeKeys: watchedEpisodes.map(
        (entry) => `${entry.season}:${entry.episode}`
      ),
      watchedEpisodes: watchedEpisodes.length,
    };
  },
});

export const getHomeDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    const [userShows, watchedEpisodes] = await Promise.all([
      ctx.db
        .query("userShows")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);

    const watchedByShow = new Map<string, number>();
    for (const entry of watchedEpisodes) {
      const key = entry.showId as string;
      watchedByShow.set(key, (watchedByShow.get(key) ?? 0) + 1);
    }

    const hydrated = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show) {
          return null;
        }

        const watchedCount = watchedByShow.get(userShow.showId as string) ?? 0;
        const totalEpisodes =
          typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
        const remainingEpisodes =
          totalEpisodes === null ? null : Math.max(totalEpisodes - watchedCount, 0);
        const progressPercent =
          totalEpisodes && totalEpisodes > 0
            ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
            : null;

        return {
          id: getExternalShowId(show),
          title: show.title,
          mediaType: show.mediaType,
          status: userShow.status,
          posterUrl: show.posterUrl ?? null,
          backdropUrl: show.backdropUrl ?? null,
          overview: show.overview ?? null,
          firstAired: show.firstAired ?? null,
          tmdbId: show.tmdbId ?? null,
          anilistId: show.anilistId ?? null,
          tvmazeId: show.tvmazeId ?? null,
          imdbId: show.imdbId ?? null,
          watchedEpisodes: watchedCount,
          totalEpisodes,
          remainingEpisodes,
          progressPercent,
          lastActivityAt: userShow.lastWatchedAt ?? userShow.addedAt,
        };
      })
    );

    const shows = hydrated
      .filter(
        (
          entry
        ): entry is NonNullable<(typeof hydrated)[number]> =>
          !!entry && entry.mediaType !== "movie"
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 40);

    const movies = hydrated
      .filter(
        (
          entry
        ): entry is NonNullable<(typeof hydrated)[number]> =>
          !!entry && entry.mediaType === "movie"
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 40);

    return { shows, movies };
  },
});

export const addToWatchlist = mutation({
  args: showInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args);

    const existing = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (existing) {
      return { status: existing.status };
    }

    await ctx.db.insert("userShows", {
      userId,
      showId,
      status: "plan_to_watch",
      addedAt: Date.now(),
    });

    return { status: "plan_to_watch" as const };
  },
});

export const toggleEpisodeWatched = mutation({
  args: {
    show: v.object(showInput),
    season: v.number(),
    episode: v.number(),
    runtime: v.optional(v.number()),
    action: v.union(v.literal("toggle"), v.literal("rewatch")),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    let userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (!userShow) {
      const userShowId = await ctx.db.insert("userShows", {
        userId,
        showId,
        status: "watching",
        addedAt: Date.now(),
        lastWatchedAt: Date.now(),
      });
      userShow = await ctx.db.get(userShowId);
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    const existingEpisode = watchedEpisodes.find(
      (entry) => entry.season === args.season && entry.episode === args.episode
    );

    const now = Date.now();

    if (existingEpisode) {
      if (args.action === "rewatch") {
        const currentCount = existingEpisode.watchCount ?? 1;
        const currentHistory = existingEpisode.watchHistory ?? [existingEpisode.watchedAt];
        
        await ctx.db.patch(existingEpisode._id, {
          watchCount: currentCount + 1,
          watchHistory: [...currentHistory, now],
          watchedAt: now,
        });

        if (userShow) {
          await ctx.db.patch(userShow._id, {
            lastWatchedAt: now,
          });
        }

        return {
          watched: true,
          watchCount: currentCount + 1,
          isRewatch: true,
        };
      } else {
        await ctx.db.delete(existingEpisode._id);

        const remainingCount = watchedEpisodes.length - 1;
        if (
          userShow &&
          userShow.status === "completed" &&
          (!args.show.totalEpisodes || remainingCount < args.show.totalEpisodes)
        ) {
          await ctx.db.patch(userShow._id, { status: "watching" });
        }

        return {
          watched: false,
          watchedEpisodes: remainingCount,
        };
      }
    }

    await ctx.db.insert("watchedEpisodes", {
      userId,
      showId,
      season: args.season,
      episode: args.episode,
      watchedAt: now,
      runtime: args.runtime,
      watchCount: 1,
      watchHistory: [now],
    });

    const totalWatched = watchedEpisodes.length + 1;
    const nextStatus =
      args.show.totalEpisodes && totalWatched >= args.show.totalEpisodes
        ? "completed"
        : "watching";

    if (userShow) {
      await ctx.db.patch(userShow._id, {
        status: nextStatus,
        lastWatchedAt: now,
      });
    }

    return {
      watched: true,
      watchedEpisodes: totalWatched,
      status: nextStatus,
      watchCount: 1,
      isRewatch: false,
    };
  },
});

export const batchRewatchEpisodes = mutation({
  args: {
    show: v.object(showInput),
    episodes: v.array(
      v.object({
        season: v.number(),
        episode: v.number(),
        runtime: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);
    const now = Date.now();

    let userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (!userShow) {
      const userShowId = await ctx.db.insert("userShows", {
        userId,
        showId,
        status: "watching",
        addedAt: now,
        lastWatchedAt: now,
      });
      userShow = await ctx.db.get(userShowId);
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    const existingByKey = new Map(
      watchedEpisodes.map((entry) => [`${entry.season}:${entry.episode}`, entry])
    );

    const uniqueEpisodes = Array.from(
      new Map(args.episodes.map((entry) => [`${entry.season}:${entry.episode}`, entry])).values()
    );

    let updatedCount = 0;
    let insertedCount = 0;

    for (const entry of uniqueEpisodes) {
      const key = `${entry.season}:${entry.episode}`;
      const existing = existingByKey.get(key);

      if (existing) {
        const currentCount = existing.watchCount ?? 1;
        const currentHistory = existing.watchHistory ?? [existing.watchedAt];

        await ctx.db.patch(existing._id, {
          watchCount: currentCount + 1,
          watchHistory: [...currentHistory, now],
          watchedAt: now,
        });
        updatedCount += 1;
      } else {
        await ctx.db.insert("watchedEpisodes", {
          userId,
          showId,
          season: entry.season,
          episode: entry.episode,
          watchedAt: now,
          runtime: entry.runtime,
          watchCount: 1,
          watchHistory: [now],
        });
        insertedCount += 1;
      }
    }

    const totalWatched = watchedEpisodes.length + insertedCount;
    const nextStatus =
      args.show.totalEpisodes && totalWatched >= args.show.totalEpisodes
        ? "completed"
        : "watching";

    if (userShow) {
      await ctx.db.patch(userShow._id, {
        status: nextStatus,
        lastWatchedAt: now,
      });
    }

    return {
      processedCount: uniqueEpisodes.length,
      updatedCount,
      insertedCount,
      watchedEpisodes: totalWatched,
      status: nextStatus,
    };
  },
});

export const markSeasonWatched = mutation({
  args: {
    show: v.object(showInput),
    season: v.number(),
    episodes: v.array(
      v.object({
        episode: v.number(),
        runtime: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);
    const now = Date.now();

    let userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (!userShow) {
      const userShowId = await ctx.db.insert("userShows", {
        userId,
        showId,
        status: "watching",
        addedAt: now,
        lastWatchedAt: now,
      });
      userShow = await ctx.db.get(userShowId);
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    const existingSeasonEpisodes = new Set(
      watchedEpisodes
        .filter((entry) => entry.season === args.season)
        .map((entry) => entry.episode)
    );

    const uniqueEpisodes = Array.from(
      new Map(args.episodes.map((entry) => [entry.episode, entry])).values()
    );

    let addedCount = 0;
    for (const entry of uniqueEpisodes) {
      if (existingSeasonEpisodes.has(entry.episode)) {
        continue;
      }
      await ctx.db.insert("watchedEpisodes", {
        userId,
        showId,
        season: args.season,
        episode: entry.episode,
        watchedAt: now,
        runtime: entry.runtime,
        watchCount: 1,
        watchHistory: [now],
      });
      addedCount += 1;
    }

    const totalWatched = watchedEpisodes.length + addedCount;
    const nextStatus =
      args.show.totalEpisodes && totalWatched >= args.show.totalEpisodes
        ? "completed"
        : "watching";

    if (userShow) {
      await ctx.db.patch(userShow._id, {
        status: nextStatus,
        lastWatchedAt: now,
      });
    }

    return {
      addedCount,
      watchedEpisodes: totalWatched,
      status: nextStatus,
    };
  },
});

export const unmarkSeasonWatched = mutation({
  args: {
    show: v.object(showInput),
    season: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    const seasonEpisodes = watchedEpisodes.filter(
      (entry) => entry.season === args.season
    );

    let removedCount = 0;
    for (const entry of seasonEpisodes) {
      await ctx.db.delete(entry._id);
      removedCount++;
    }

    if (userShow && removedCount > 0) {
      const remainingCount = watchedEpisodes.length - removedCount;
      const newStatus =
        userShow.status === "completed" &&
        args.show.totalEpisodes &&
        remainingCount < args.show.totalEpisodes
          ? "watching"
          : userShow.status;

      await ctx.db.patch(userShow._id, {
        status: newStatus,
      });
    }

    return {
      removedCount,
      watchedEpisodes: watchedEpisodes.length - removedCount,
    };
  },
});

export const clearShowWatched = mutation({
  args: {
    show: v.object(showInput),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    for (const entry of watchedEpisodes) {
      await ctx.db.delete(entry._id);
    }

    if (userShow) {
      await ctx.db.patch(userShow._id, {
        status: "plan_to_watch",
      });
    }

    return {
      removedCount: watchedEpisodes.length,
    };
  },
});

export const getWatchlist = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "watching")
      )
      .collect();

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const watchedByShow = new Map<string, Set<string>>();
    for (const entry of watchedEpisodes) {
      const key = entry.showId as string;
      if (!watchedByShow.has(key)) {
        watchedByShow.set(key, new Set());
      }
      watchedByShow.get(key)!.add(`${entry.season}:${entry.episode}`);
    }

    const watchlistItems = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show || show.mediaType === "movie") {
          return null;
        }

        const totalEpisodes =
          typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
        if (totalEpisodes === null) {
          return null;
        }

        const watchedKeys = watchedByShow.get(userShow.showId as string) || new Set();
        const watchedCount = watchedKeys.size;
        const remainingEpisodes = totalEpisodes - watchedCount;

        if (remainingEpisodes <= 0) {
          return null;
        }

        const progressPercent = totalEpisodes > 0
          ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
          : 0;

        const lastWatchedEntry = watchedEpisodes
          .filter((e) => e.showId === userShow.showId)
          .sort((a, b) => b.watchedAt - a.watchedAt)[0];

        return {
          id: getExternalShowId(show),
          title: show.title,
          mediaType: show.mediaType,
          posterUrl: show.posterUrl ?? null,
          backdropUrl: show.backdropUrl ?? null,
          overview: show.overview ?? null,
          firstAired: show.firstAired ?? null,
          tmdbId: show.tmdbId ?? null,
          anilistId: show.anilistId ?? null,
          tvmazeId: show.tvmazeId ?? null,
          imdbId: show.imdbId ?? null,
          watchedEpisodes: watchedCount,
          totalEpisodes,
          remainingEpisodes,
          progressPercent,
          lastWatchedAt: lastWatchedEntry?.watchedAt ?? userShow.addedAt,
        };
      })
    );

    return watchlistItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
  },
});

export const getUserWatchlistShows = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const shows = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show) return null;
        return {
          id: userShow.showId,
          title: show.title,
          mediaType: show.mediaType,
          posterUrl: show.posterUrl ?? null,
          status: userShow.status,
        };
      })
    );

    return shows.filter((s): s is NonNullable<typeof s> => s !== null);
  },
});

export const batchMarkWatched = mutation({
  args: {
    show: v.object(showInput),
    upToSeason: v.number(),
    upToEpisode: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    let userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (!userShow) {
      const userShowId = await ctx.db.insert("userShows", {
        userId,
        showId,
        status: "watching",
        addedAt: Date.now(),
        lastWatchedAt: Date.now(),
      });
      userShow = await ctx.db.get(userShowId);
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .collect();

    const existingKeys = new Set(
      watchedEpisodes.map((entry) => `${entry.season}:${entry.episode}`)
    );

    const now = Date.now();
    let addedCount = 0;
    const totalEpisodes = args.show.totalEpisodes;
    let episodesInserted = 0;

    for (let season = 1; season <= args.upToSeason; season++) {
      const isLastSeason = season === args.upToSeason;
      const maxEpisode = isLastSeason ? args.upToEpisode : 99;

      for (let episode = 1; episode <= maxEpisode; episode++) {
        // Stop if we've reached the show's total episode count
        if (typeof totalEpisodes === "number" && episodesInserted >= totalEpisodes) {
          break;
        }

        const key = `${season}:${episode}`;
        if (existingKeys.has(key)) {
          continue;
        }

        await ctx.db.insert("watchedEpisodes", {
          userId,
          showId,
          season,
          episode,
          watchedAt: now,
          runtime: args.show.episodeRuntime,
          watchCount: 1,
          watchHistory: [now],
        });
        addedCount++;
        episodesInserted++;
      }

      // Break outer loop if we've reached total episodes
      if (typeof totalEpisodes === "number" && episodesInserted >= totalEpisodes) {
        break;
      }
    }

    const totalWatched = watchedEpisodes.length + addedCount;
    const nextStatus =
      args.show.totalEpisodes && totalWatched >= args.show.totalEpisodes
        ? "completed"
        : "watching";

    if (userShow) {
      await ctx.db.patch(userShow._id, {
        status: nextStatus,
        lastWatchedAt: now,
      });
    }

    return {
      addedCount,
      totalWatched,
      status: nextStatus,
    };
  },
});

export const getShowIdByExternal = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    await getCurrentUserId(ctx);
    if (!hasLookupArgs(args)) {
      return null;
    }

    const show = await findShowByLookup(ctx, args);
    return show?._id ?? null;
  },
});

export const getEpisodeWatchHistory = query({
  args: {
    show: v.object(showInput),
    season: v.number(),
    episode: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const show = await findShowByLookup(ctx, args.show);

    if (!show) {
      return null;
    }

    const watchedEntry = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show_season_episode", (q) =>
        q.eq("userId", userId)
          .eq("showId", show._id)
          .eq("season", args.season)
          .eq("episode", args.episode)
      )
      .unique();

    if (!watchedEntry) {
      return null;
    }

    return {
      watchCount: watchedEntry.watchCount ?? 1,
      watchHistory: watchedEntry.watchHistory ?? [watchedEntry.watchedAt],
      firstWatchedAt: watchedEntry.watchedAt,
      lastWatchedAt: watchedEntry.watchHistory?.[watchedEntry.watchHistory.length - 1] ?? watchedEntry.watchedAt,
    };
  },
});

// Movie-specific tracking (no episodes, just watched status)
export const toggleMovieWatched = mutation({
  args: {
    show: v.object(showInput),
    action: v.union(v.literal("toggle"), v.literal("rewatch")),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    // Only allow for movies
    if (args.show.mediaType !== "movie") {
      throw new Error("This mutation is only for movies");
    }

    let userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    // Check if movie already has a watched entry (we use season 0, episode 0 for movies)
    const watchedEntry = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show_season_episode", (q) =>
        q.eq("userId", userId)
          .eq("showId", showId)
          .eq("season", 0)
          .eq("episode", 0)
      )
      .unique();

    const now = Date.now();

    if (watchedEntry) {
      if (args.action === "rewatch") {
        // Add rewatch
        const currentCount = watchedEntry.watchCount ?? 1;
        const currentHistory = watchedEntry.watchHistory ?? [watchedEntry.watchedAt];
        
        await ctx.db.patch(watchedEntry._id, {
          watchCount: currentCount + 1,
          watchHistory: [...currentHistory, now],
          watchedAt: now,
        });

        if (userShow) {
          await ctx.db.patch(userShow._id, {
            status: "completed",
            lastWatchedAt: now,
          });
        }

        return {
          watched: true,
          watchCount: currentCount + 1,
          isRewatch: true,
        };
      } else {
        // Unwatch - delete the entry
        await ctx.db.delete(watchedEntry._id);

        if (userShow) {
          await ctx.db.patch(userShow._id, {
            status: "plan_to_watch",
          });
        }

        return {
          watched: false,
          watchCount: 0,
        };
      }
    } else {
      // First watch
      await ctx.db.insert("watchedEpisodes", {
        userId,
        showId,
        season: 0,
        episode: 0,
        watchedAt: now,
        runtime: args.show.episodeRuntime,
        watchCount: 1,
        watchHistory: [now],
      });

      if (!userShow) {
        await ctx.db.insert("userShows", {
          userId,
          showId,
          status: "completed",
          addedAt: now,
          lastWatchedAt: now,
        });
      } else {
        await ctx.db.patch(userShow._id, {
          status: "completed",
          lastWatchedAt: now,
        });
      }

      return {
        watched: true,
        watchCount: 1,
        isRewatch: false,
      };
    }
  },
});

export const getMovieWatchHistory = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    
    if (!hasLookupArgs(args)) {
      return null;
    }

    const show = await findShowByLookup(ctx, args);
    if (!show || show.mediaType !== "movie") {
      return null;
    }

    const watchedEntry = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show_season_episode", (q) =>
        q.eq("userId", userId)
          .eq("showId", show._id)
          .eq("season", 0)
          .eq("episode", 0)
      )
      .unique();

    if (!watchedEntry) {
      return null;
    }

    return {
      watchCount: watchedEntry.watchCount ?? 1,
      watchHistory: watchedEntry.watchHistory ?? [watchedEntry.watchedAt],
      firstWatchedAt: watchedEntry.watchedAt,
      lastWatchedAt: watchedEntry.watchHistory?.[watchedEntry.watchHistory.length - 1] ?? watchedEntry.watchedAt,
    };
  },
});

// Get all episode watch counts for a show (for displaying rewatch counts)
export const getEpisodeWatchCounts = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    
    if (!hasLookupArgs(args)) {
      return {};
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return {};
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .collect();

    const counts: Record<string, number> = {};
    for (const entry of watchedEpisodes) {
      const key = `${entry.season}:${entry.episode}`;
      counts[key] = entry.watchCount ?? 1;
    }

    return counts;
  },
});
