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
) {
  await ensureShowRecordId(ctx, args);
  return getExternalShowId(args);
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
          !!entry &&
          entry.mediaType !== "movie" &&
          (entry.status === "watching" ||
            entry.status === "paused" ||
            entry.status === "plan_to_watch") &&
          (entry.remainingEpisodes === null || entry.remainingEpisodes > 0)
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 40);

    const movies = hydrated
      .filter(
        (
          entry
        ): entry is NonNullable<(typeof hydrated)[number]> =>
          !!entry && entry.mediaType === "movie" && entry.status !== "completed"
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

    if (existingEpisode) {
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

    const now = Date.now();
    await ctx.db.insert("watchedEpisodes", {
      userId,
      showId,
      season: args.season,
      episode: args.episode,
      watchedAt: now,
      runtime: args.runtime,
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

