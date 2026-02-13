import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { auth } from "./auth";
import { api, internal } from "./_generated/api";
import {
  getAniListAnimeRelations,
  getAniListMediaByMalId,
  type AniListAnimeRelations,
  type AniListRelatedShow,
} from "../lib/api/anilist";
import type { NormalizedShow } from "../lib/api/types";

const RELATION_SYNC_THROTTLE_MS = 1000 * 60 * 60 * 6;
const RELATION_SYNC_BATCH_LIMIT = 6;
const RELATION_SYNC_MAX_GRAPH_NODES = 30;
const RELATION_INCLUDE_TYPES = new Set(["PREQUEL", "SEQUEL"]);

const showInput = {
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  malId: v.optional(v.number()),
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
  anilistFormat: v.optional(v.string()),
  animeSeason: v.optional(v.string()),
  animeSeasonYear: v.optional(v.number()),
  rootAnilistId: v.optional(v.number()),
  relatedAnilistIds: v.optional(v.array(v.number())),
  lastRelationSyncAt: v.optional(v.number()),
  lastUpdated: v.number(),
};

const showLookupInput = {
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  malId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
};

const userShowStatusValidator = v.union(
  v.literal("watching"),
  v.literal("paused"),
  v.literal("dropped"),
  v.literal("completed"),
  v.literal("plan_to_watch")
);

type UserShowStatus =
  | "watching"
  | "paused"
  | "dropped"
  | "completed"
  | "plan_to_watch";

function hasLookupArgs(args: {
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
}) {
  return (
    typeof args.tmdbId === "number" ||
    typeof args.anilistId === "number" ||
    typeof args.malId === "number" ||
    typeof args.tvmazeId === "number"
  );
}

function getExternalShowId(show: {
  tmdbId?: number | null;
  anilistId?: number | null;
  malId?: number | null;
  tvmazeId?: number | null;
  imdbId?: string | null;
}) {
  if (typeof show.tmdbId === "number") {
    return String(show.tmdbId);
  }
  if (typeof show.anilistId === "number") {
    return String(show.anilistId);
  }
  if (typeof show.malId === "number") {
    return String(show.malId);
  }
  if (typeof show.tvmazeId === "number") {
    return String(show.tvmazeId);
  }
  if (typeof show.imdbId === "string" && show.imdbId.trim()) {
    return show.imdbId;
  }
  return null;
}

function mergeNumberArrays(...values: (number[] | undefined)[]) {
  const merged = new Set<number>();
  for (const value of values) {
    for (const item of value ?? []) {
      if (Number.isFinite(item)) {
        merged.add(item);
      }
    }
  }
  return merged.size > 0 ? Array.from(merged) : undefined;
}

function buildShowPatch(
  incoming: ShowPayload,
  existing?: Doc<"shows">
): ShowPayload {
  const mergedRelatedIds = mergeNumberArrays(
    existing?.relatedAnilistIds,
    incoming.relatedAnilistIds
  );

  const rootAnilistId =
    incoming.rootAnilistId ??
    existing?.rootAnilistId ??
    (incoming.mediaType === "anime"
      ? incoming.anilistId ?? existing?.anilistId
      : undefined);

  return {
    ...incoming,
    malId: incoming.malId ?? existing?.malId,
    anilistFormat: incoming.anilistFormat ?? existing?.anilistFormat,
    animeSeason: incoming.animeSeason ?? existing?.animeSeason,
    animeSeasonYear: incoming.animeSeasonYear ?? existing?.animeSeasonYear,
    rootAnilistId,
    relatedAnilistIds: mergedRelatedIds,
    lastRelationSyncAt: incoming.lastRelationSyncAt ?? existing?.lastRelationSyncAt,
  };
}

type ShowPayload = {
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
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
  anilistFormat?: string;
  animeSeason?: string;
  animeSeasonYear?: number;
  rootAnilistId?: number;
  relatedAnilistIds?: number[];
  lastRelationSyncAt?: number;
  lastUpdated: number;
};

async function getCurrentUserId(ctx: QueryCtx | MutationCtx | ActionCtx) {
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
    malId?: number;
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

  const byMalId =
    typeof args.malId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_malId", (q) => q.eq("malId", args.malId))
          .unique()
      : null;
  if (byMalId) {
    return byMalId;
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
  args: ShowPayload
): Promise<Doc<"shows">["_id"]> {
  const existing = await findShowByLookup(ctx, args);
  const payload = buildShowPatch(args, existing ?? undefined);
  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }
  return ctx.db.insert("shows", payload);
}

async function ensureShow(
  ctx: MutationCtx,
  args: ShowPayload
): Promise<Doc<"shows">["_id"]> {
  return ensureShowRecordId(ctx, args);
}

function buildShowPayloadFromNormalized(
  show: NormalizedShow,
  overrides: Partial<ShowPayload> = {}
): ShowPayload {
  return {
    tmdbId: show.tmdbId,
    anilistId: show.anilistId,
    malId: show.malId,
    tvmazeId: show.tvmazeId,
    imdbId: show.imdbId,
    mediaType: show.mediaType,
    title: show.title,
    overview: show.overview,
    posterUrl: show.posterUrl,
    backdropUrl: show.backdropUrl,
    genres: show.genres,
    status: show.status,
    totalEpisodes: show.totalEpisodes,
    totalSeasons: show.totalSeasons,
    episodeRuntime: show.episodeRuntime,
    rating: show.rating,
    firstAired: show.firstAired,
    anilistFormat: show.anilistFormat,
    animeSeason: show.animeSeason,
    animeSeasonYear: show.animeSeasonYear,
    rootAnilistId: show.rootAnilistId,
    relatedAnilistIds: show.relatedAnilistIds,
    lastRelationSyncAt: show.lastRelationSyncAt,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

function shouldIncludeRelationType(relationType: string) {
  return RELATION_INCLUDE_TYPES.has(relationType);
}

function mergeShowPayload(
  existing: ShowPayload | undefined,
  incoming: ShowPayload
): ShowPayload {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    tmdbId: incoming.tmdbId ?? existing.tmdbId,
    anilistId: incoming.anilistId ?? existing.anilistId,
    malId: incoming.malId ?? existing.malId,
    tvmazeId: incoming.tvmazeId ?? existing.tvmazeId,
    imdbId: incoming.imdbId ?? existing.imdbId,
    overview: incoming.overview ?? existing.overview,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    backdropUrl: incoming.backdropUrl ?? existing.backdropUrl,
    genres: incoming.genres ?? existing.genres,
    status: incoming.status ?? existing.status,
    totalEpisodes: incoming.totalEpisodes ?? existing.totalEpisodes,
    totalSeasons: incoming.totalSeasons ?? existing.totalSeasons,
    episodeRuntime: incoming.episodeRuntime ?? existing.episodeRuntime,
    rating: incoming.rating ?? existing.rating,
    firstAired: incoming.firstAired ?? existing.firstAired,
    anilistFormat: incoming.anilistFormat ?? existing.anilistFormat,
    animeSeason: incoming.animeSeason ?? existing.animeSeason,
    animeSeasonYear: incoming.animeSeasonYear ?? existing.animeSeasonYear,
    rootAnilistId: incoming.rootAnilistId ?? existing.rootAnilistId,
    relatedAnilistIds: mergeNumberArrays(
      existing.relatedAnilistIds,
      incoming.relatedAnilistIds
    ),
    lastRelationSyncAt: incoming.lastRelationSyncAt ?? existing.lastRelationSyncAt,
    lastUpdated: Math.max(existing.lastUpdated, incoming.lastUpdated),
  };
}

function buildRelationShowPayload(
  related: AniListRelatedShow,
  rootAnilistId: number,
  syncedAt: number
) {
  return buildShowPayloadFromNormalized(related.show, {
    mediaType: "anime",
    anilistId: related.anilistId,
    rootAnilistId,
    lastRelationSyncAt: syncedAt,
    lastUpdated: syncedAt,
  });
}

async function buildAnimeRelationPayloads(rootAnilistId: number) {
  const now = Date.now();
  const queue: number[] = [rootAnilistId];
  const visited = new Set<number>();
  const payloadByAnilistId = new Map<number, ShowPayload>();
  const relatedIdsByAnilistId = new Map<number, Set<number>>();

  while (queue.length > 0 && visited.size < RELATION_SYNC_MAX_GRAPH_NODES) {
    const currentAnilistId = queue.shift();
    if (typeof currentAnilistId !== "number") {
      continue;
    }
    if (visited.has(currentAnilistId)) {
      continue;
    }
    visited.add(currentAnilistId);

    let graph: AniListAnimeRelations | null = null;
    try {
      graph = await getAniListAnimeRelations(currentAnilistId);
    } catch (error) {
      console.error("Failed to fetch AniList relation graph", {
        currentAnilistId,
        error,
      });
      continue;
    }

    if (!graph?.root.anilistId) {
      continue;
    }

    const included = graph.relations.filter((entry) =>
      shouldIncludeRelationType(entry.relationType)
    );

    const currentRelatedIds =
      relatedIdsByAnilistId.get(currentAnilistId) ?? new Set<number>();

    for (const relation of included) {
      currentRelatedIds.add(relation.anilistId);
      if (!visited.has(relation.anilistId)) {
        queue.push(relation.anilistId);
      }

      const relatedPayload = buildRelationShowPayload(
        relation,
        rootAnilistId,
        now
      );
      const existingRelated = payloadByAnilistId.get(relation.anilistId);
      payloadByAnilistId.set(
        relation.anilistId,
        mergeShowPayload(existingRelated, relatedPayload)
      );
    }

    relatedIdsByAnilistId.set(currentAnilistId, currentRelatedIds);

    const rootPayload = buildShowPayloadFromNormalized(graph.root, {
      mediaType: "anime",
      anilistId: currentAnilistId,
      rootAnilistId,
      relatedAnilistIds: Array.from(currentRelatedIds),
      lastRelationSyncAt: now,
      lastUpdated: now,
    });

    const existingRoot = payloadByAnilistId.get(currentAnilistId);
    payloadByAnilistId.set(
      currentAnilistId,
      mergeShowPayload(existingRoot, rootPayload)
    );
  }

  const shows = Array.from(payloadByAnilistId.entries()).map(([anilistId, payload]) => ({
    ...payload,
    mediaType: "anime" as const,
    anilistId,
    rootAnilistId,
    relatedAnilistIds: mergeNumberArrays(
      payload.relatedAnilistIds,
      relatedIdsByAnilistId.has(anilistId)
        ? Array.from(relatedIdsByAnilistId.get(anilistId)!)
        : undefined
    ),
    lastRelationSyncAt: now,
    lastUpdated: now,
  }));

  return {
    shows,
    syncedAt: now,
  };
}

type WatchlistMutationResult = {
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
};

type AnimeRelationSyncResult = {
  rootAnilistId: number;
  synced: boolean;
  discoveredShows: number;
  insertedUserShows: number;
  autoTrackedInserted: number;
};

type AddAnimeToWatchlistResult = WatchlistMutationResult & {
  synced: boolean;
  rootAnilistId: number | null;
  discoveredShows: number;
  insertedUserShows: number;
  autoTrackedInserted: number;
};

async function syncAnimeRelationRoot(
  ctx: ActionCtx,
  userId: Id<"users">,
  rootAnilistId: number
): Promise<AnimeRelationSyncResult> {
  const { shows, syncedAt } = await buildAnimeRelationPayloads(rootAnilistId);
  if (shows.length === 0) {
    return {
      rootAnilistId,
      synced: false,
      discoveredShows: 0,
      insertedUserShows: 0,
      autoTrackedInserted: 0,
    };
  }

  const syncResult: {
    insertedUserShows: number;
    autoTrackedInserted: number;
  } = await ctx.runMutation(internal.shows.applyAnimeRelationSync, {
    userId,
    rootAnilistId,
    syncedAt,
    shows,
  });

  return {
    rootAnilistId,
    synced: true,
    discoveredShows: shows.length,
    insertedUserShows: syncResult.insertedUserShows,
    autoTrackedInserted: syncResult.autoTrackedInserted,
  };
}

export const applyAnimeRelationSync = internalMutation({
  args: {
    userId: v.id("users"),
    rootAnilistId: v.number(),
    syncedAt: v.number(),
    shows: v.array(v.object(showInput)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedUserShows = 0;
    let autoTrackedInserted = 0;

    for (const showPayload of args.shows) {
      const showId = await ensureShowRecordId(ctx, showPayload);
      const isRoot = showPayload.anilistId === args.rootAnilistId;

      const existingUserShow = await ctx.db
        .query("userShows")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", args.userId).eq("showId", showId)
        )
        .unique();

      if (existingUserShow) {
        await ctx.db.patch(existingUserShow._id, {
          relationRootAnilistId: args.rootAnilistId,
          ...(isRoot
            ? {
                isAutoTracked: false,
                lastRelationSyncAt: args.syncedAt,
              }
            : {
                isAutoTracked: true,
              }),
        });
        continue;
      }

      await ctx.db.insert("userShows", {
        userId: args.userId,
        showId,
        status: "plan_to_watch",
        isAutoTracked: !isRoot,
        relationRootAnilistId: args.rootAnilistId,
        ...(isRoot ? { lastRelationSyncAt: args.syncedAt } : {}),
        addedAt: now,
      });

      insertedUserShows += 1;
      if (!isRoot) {
        autoTrackedInserted += 1;
      }
    }

    return {
      insertedUserShows,
      autoTrackedInserted,
    };
  },
});

export const getAnimeRelationSyncCandidates = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const rootBySyncAt = new Map<number, number>();

    for (const userShow of userShows) {
      if (userShow.status === "dropped") {
        continue;
      }

      const show = await ctx.db.get(userShow.showId);
      if (!show || show.mediaType !== "anime") {
        continue;
      }

      const rootAnilistId =
        userShow.relationRootAnilistId ??
        show.rootAnilistId ??
        show.anilistId;

      if (typeof rootAnilistId !== "number") {
        continue;
      }

      const previousSyncAt = rootBySyncAt.get(rootAnilistId) ?? 0;
      const syncedAt = Math.max(
        previousSyncAt,
        userShow.lastRelationSyncAt ?? 0,
        show.lastRelationSyncAt ?? 0
      );

      rootBySyncAt.set(rootAnilistId, syncedAt);
    }

    return Array.from(rootBySyncAt.entries())
      .map(([rootAnilistId, lastSyncedAt]) => ({ rootAnilistId, lastSyncedAt }))
      .sort((a, b) => a.lastSyncedAt - b.lastSyncedAt);
  },
});

export const addAnimeToWatchlistWithRelations = action({
  args: showInput,
  handler: async (ctx, args): Promise<AddAnimeToWatchlistResult> => {
    if (args.mediaType !== "anime") {
      const result: WatchlistMutationResult = await ctx.runMutation(
        api.shows.addToWatchlist,
        args
      );
      return {
        ...result,
        synced: false,
        rootAnilistId: null,
        discoveredShows: 0,
        insertedUserShows: 0,
        autoTrackedInserted: 0,
      };
    }

    const userId = await getCurrentUserId(ctx);
    const now = Date.now();

    let resolvedPayload: ShowPayload = {
      ...args,
      mediaType: "anime",
      lastUpdated: now,
    };

    let rootAnilistId = args.anilistId;

    if (typeof rootAnilistId !== "number" && typeof args.malId === "number") {
      const resolvedFromMal = await getAniListMediaByMalId(args.malId).catch(
        () => null
      );
      if (resolvedFromMal?.anilistId) {
        rootAnilistId = resolvedFromMal.anilistId;
        resolvedPayload = buildShowPayloadFromNormalized(resolvedFromMal, {
          ...args,
          mediaType: "anime",
          anilistId: resolvedFromMal.anilistId,
          malId: resolvedFromMal.malId ?? args.malId,
          rootAnilistId: resolvedFromMal.anilistId,
          lastUpdated: now,
        });
      }
    }

    if (typeof rootAnilistId === "number") {
      resolvedPayload = {
        ...resolvedPayload,
        anilistId: rootAnilistId,
        rootAnilistId,
        lastUpdated: now,
      };
    }

    const addResult: WatchlistMutationResult = await ctx.runMutation(
      api.shows.addToWatchlist,
      resolvedPayload
    );

    if (typeof rootAnilistId !== "number") {
      return {
        ...addResult,
        synced: false,
        rootAnilistId: null,
        discoveredShows: 0,
        insertedUserShows: 0,
        autoTrackedInserted: 0,
      };
    }

    // Best-effort relation sync: don't abort watchlist add on sync failure
    try {
      const syncResult = await syncAnimeRelationRoot(ctx, userId, rootAnilistId);
      return {
        ...addResult,
        ...syncResult,
        rootAnilistId,
      };
    } catch {
      // Sync failed but watchlist add succeeded; return partial success state
      return {
        ...addResult,
        synced: false,
        rootAnilistId,
        discoveredShows: 0,
        insertedUserShows: 0,
        autoTrackedInserted: 0,
      };
    }
  },
});

export const syncTrackedAnimeRelations = action({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const now = Date.now();

    const candidates: { rootAnilistId: number; lastSyncedAt: number }[] =
      await ctx.runQuery(internal.shows.getAnimeRelationSyncCandidates, {
        userId,
      });

    const staleCandidates = candidates
      .filter((candidate: { rootAnilistId: number; lastSyncedAt: number }) =>
        args.force
          ? true
          : now - candidate.lastSyncedAt >= RELATION_SYNC_THROTTLE_MS
      )
      .slice(0, RELATION_SYNC_BATCH_LIMIT);

    const results: AnimeRelationSyncResult[] = [];

    for (const candidate of staleCandidates) {
      const result = await syncAnimeRelationRoot(
        ctx,
        userId,
        candidate.rootAnilistId
      );
      results.push(result);
    }

    return {
      scannedRoots: candidates.length,
      syncedRoots: results.filter((entry) => entry.synced).length,
      results,
    };
  },
});

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

export const getRelatedAnimeForShow = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args)) {
      return [] as {
        title: string;
        mediaType: "anime";
        posterUrl: string | null;
        backdropUrl: string | null;
        firstAired: string | null;
        anilistId: number | null;
        malId: number | null;
        anilistFormat: string | null;
        status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch" | null;
        isInWatchlist: boolean;
        isAutoTracked: boolean;
        animeSeason: string | null;
        animeSeasonYear: number | null;
      }[];
    }

    const sourceShow = await findShowByLookup(ctx, args);
    if (!sourceShow || sourceShow.mediaType !== "anime") {
      return [];
    }

    const rootAnilistId = sourceShow.rootAnilistId ?? sourceShow.anilistId;
    if (typeof rootAnilistId !== "number") {
      return [];
    }

    const relatedCandidates = await ctx.db
      .query("shows")
      .withIndex("by_rootAnilistId", (q) => q.eq("rootAnilistId", rootAnilistId))
      .collect();

    const candidateMap = new Map<Doc<"shows">["_id"], Doc<"shows">>();
    for (const candidate of relatedCandidates) {
      if (candidate.mediaType !== "anime") {
        continue;
      }
      candidateMap.set(candidate._id, candidate);
    }

    if (!candidateMap.has(sourceShow._id)) {
      candidateMap.set(sourceShow._id, sourceShow);
    }

    const fallbackRelatedIds = sourceShow.relatedAnilistIds ?? [];
    for (const relatedAnilistId of fallbackRelatedIds) {
      const related = await ctx.db
        .query("shows")
        .withIndex("by_anilistId", (q) => q.eq("anilistId", relatedAnilistId))
        .unique();
      if (related && related.mediaType === "anime") {
        candidateMap.set(related._id, related);
      }
    }

    const relatedShows = Array.from(candidateMap.values())
      .filter((entry) => entry._id !== sourceShow._id)
      .sort((a, b) => {
        const yearA = a.animeSeasonYear ?? 0;
        const yearB = b.animeSeasonYear ?? 0;
        if (yearA !== yearB) {
          return yearA - yearB;
        }
        return a.title.localeCompare(b.title);
      })
      .slice(0, 40);

    const hydrated = await Promise.all(
      relatedShows.map(async (relatedShow) => {
        const userShow = await ctx.db
          .query("userShows")
          .withIndex("by_user_show", (q) =>
            q.eq("userId", userId).eq("showId", relatedShow._id)
          )
          .unique();

        return {
          title: relatedShow.title,
          mediaType: "anime" as const,
          posterUrl: relatedShow.posterUrl ?? null,
          backdropUrl: relatedShow.backdropUrl ?? null,
          firstAired: relatedShow.firstAired ?? null,
          anilistId: relatedShow.anilistId ?? null,
          malId: relatedShow.malId ?? null,
          anilistFormat: relatedShow.anilistFormat ?? null,
          status: userShow?.status ?? null,
          isInWatchlist: userShow !== null,
          isAutoTracked: userShow?.isAutoTracked ?? false,
          animeSeason: relatedShow.animeSeason ?? null,
          animeSeasonYear: relatedShow.animeSeasonYear ?? null,
        };
      })
    );

    return hydrated;
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
          id: getExternalShowId(show) ?? String(show._id),
          title: show.title,
          mediaType: show.mediaType,
          status: userShow.status,
          posterUrl: show.posterUrl ?? null,
          backdropUrl: show.backdropUrl ?? null,
          overview: show.overview ?? null,
          firstAired: show.firstAired ?? null,
          tmdbId: show.tmdbId ?? null,
          anilistId: show.anilistId ?? null,
          malId: show.malId ?? null,
          tvmazeId: show.tvmazeId ?? null,
          imdbId: show.imdbId ?? null,
          relationRootAnilistId:
            userShow.relationRootAnilistId ?? show.rootAnilistId ?? show.anilistId ?? null,
          anilistFormat: show.anilistFormat ?? null,
          animeSeason: show.animeSeason ?? null,
          animeSeasonYear: show.animeSeasonYear ?? null,
          watchedEpisodes: watchedCount,
          totalEpisodes,
          remainingEpisodes,
          progressPercent,
          lastActivityAt: userShow.lastWatchedAt ?? userShow.addedAt,
        };
      })
    );

    const seasonMonthOffsetByName: Record<string, number> = {
      WINTER: 0,
      SPRING: 3,
      SUMMER: 6,
      FALL: 9,
    };

    const mainlineFormats = new Set(["TV", "TV_SHORT"]);

    const formatWeightByType: Record<string, number> = {
      TV: 0,
      TV_SHORT: 1,
      MOVIE: 2,
      ONA: 3,
      OVA: 4,
      SPECIAL: 5,
      MUSIC: 6,
    };

    const getChronologyValue = (entry: {
      firstAired: string | null;
      animeSeason: string | null;
      animeSeasonYear: number | null;
    }) => {
      const firstAired = entry.firstAired?.trim();
      if (firstAired) {
        const directDateMatch = firstAired.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (directDateMatch) {
          const year = Number.parseInt(directDateMatch[1], 10);
          const month = Number.parseInt(directDateMatch[2], 10) - 1;
          const day = Number.parseInt(directDateMatch[3], 10);
          const asDate = Date.UTC(year, month, day);
          if (Number.isFinite(asDate)) {
            return asDate;
          }
        }

        const parsed = new Date(firstAired).getTime();
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      if (typeof entry.animeSeasonYear === "number") {
        const season = entry.animeSeason?.toUpperCase() ?? "";
        const monthOffset = seasonMonthOffsetByName[season] ?? 0;
        return Date.UTC(entry.animeSeasonYear, monthOffset, 1);
      }

      return Number.MAX_SAFE_INTEGER;
    };

    const getFormatWeight = (entry: { anilistFormat: string | null }) => {
      const format = entry.anilistFormat?.toUpperCase();
      if (!format) {
        return 99;
      }
      return formatWeightByType[format] ?? 99;
    };

    const isMainlineAnime = (entry: { anilistFormat: string | null }) => {
      const format = entry.anilistFormat?.toUpperCase();
      if (!format) {
        return true;
      }
      return mainlineFormats.has(format);
    };

    const sortAnimeCandidates = (
      a: {
        title: string;
        firstAired: string | null;
        animeSeason: string | null;
        animeSeasonYear: number | null;
        anilistFormat: string | null;
        anilistId: number | null;
        malId: number | null;
      },
      b: {
        title: string;
        firstAired: string | null;
        animeSeason: string | null;
        animeSeasonYear: number | null;
        anilistFormat: string | null;
        anilistId: number | null;
        malId: number | null;
      }
    ) => {
      const chronologyA = getChronologyValue(a);
      const chronologyB = getChronologyValue(b);
      if (chronologyA !== chronologyB) {
        return chronologyA - chronologyB;
      }

      const formatA = getFormatWeight(a);
      const formatB = getFormatWeight(b);
      if (formatA !== formatB) {
        return formatA - formatB;
      }

      if (a.title !== b.title) {
        return a.title.localeCompare(b.title);
      }

      const idA = a.anilistId ?? a.malId ?? Number.MAX_SAFE_INTEGER;
      const idB = b.anilistId ?? b.malId ?? Number.MAX_SAFE_INTEGER;
      return idA - idB;
    };

    const baseShows = hydrated.filter(
      (
        entry
      ): entry is NonNullable<(typeof hydrated)[number]> =>
        !!entry && entry.mediaType !== "movie"
    );

    const groupedAnime = new Map<string, (typeof baseShows)[number][]>();
    const selectedShows: (typeof baseShows)[number][] = [];

    for (const entry of baseShows) {
      if (entry.mediaType !== "anime") {
        selectedShows.push(entry);
        continue;
      }

      const groupKey =
        typeof entry.relationRootAnilistId === "number"
          ? `root:${entry.relationRootAnilistId}`
          : typeof entry.anilistId === "number"
            ? `anilist:${entry.anilistId}`
            : typeof entry.malId === "number"
              ? `mal:${entry.malId}`
              : `show:${entry.id}`;

      const group = groupedAnime.get(groupKey) ?? [];
      group.push(entry);
      groupedAnime.set(groupKey, group);
    }

    for (const entries of groupedAnime.values()) {
      const activeCandidates = entries.filter(
        (entry) =>
          entry.status !== "dropped" &&
          (entry.remainingEpisodes === null || entry.remainingEpisodes > 0)
      );

      const pool = activeCandidates.length > 0 ? activeCandidates : entries;
      const mainlinePool = pool.filter((entry) => isMainlineAnime(entry));
      const candidates = mainlinePool.length > 0 ? mainlinePool : pool;
      const sorted = [...candidates].sort(sortAnimeCandidates);

      if (sorted.length > 0) {
        selectedShows.push(sorted[0]);
        continue;
      }

      const byRecentActivity = [...entries].sort(
        (a, b) => b.lastActivityAt - a.lastActivityAt
      );
      if (byRecentActivity[0]) {
        selectedShows.push(byRecentActivity[0]);
      }
    }

    const shows = selectedShows
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 40)
      .map(
        ({
          relationRootAnilistId: _relationRootAnilistId,
          anilistFormat: _anilistFormat,
          animeSeason: _animeSeason,
          animeSeasonYear: _animeSeasonYear,
          ...rest
        }) => rest
      );

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
    const relationRootAnilistId =
      args.mediaType === "anime"
        ? args.rootAnilistId ?? args.anilistId
        : undefined;
    const isAnimeRoot =
      args.mediaType === "anime" &&
      typeof args.anilistId === "number" &&
      relationRootAnilistId === args.anilistId;

    const existing = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (existing) {
      if (typeof relationRootAnilistId === "number") {
        await ctx.db.patch(existing._id, {
          relationRootAnilistId,
          ...(isAnimeRoot ? { isAutoTracked: false } : {}),
        });
      }
      return { status: existing.status };
    }

    await ctx.db.insert("userShows", {
      userId,
      showId,
      status: "plan_to_watch",
      ...(typeof relationRootAnilistId === "number"
        ? {
            relationRootAnilistId,
            isAutoTracked: false,
          }
        : {}),
      addedAt: Date.now(),
    });

    return { status: "plan_to_watch" as const };
  },
});

export const removeFromWatchlist = mutation({
  args: {
    show: v.object(showInput),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const show = await findShowByLookup(ctx, args.show);

    if (!show) {
      return {
        removed: false,
        watchedEpisodesRemoved: 0,
      };
    }

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .unique();

    if (!userShow) {
      return {
        removed: false,
        watchedEpisodesRemoved: 0,
      };
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .collect();

    for (const entry of watchedEpisodes) {
      await ctx.db.delete(entry._id);
    }

    await ctx.db.delete(userShow._id);

    return {
      removed: true,
      watchedEpisodesRemoved: watchedEpisodes.length,
    };
  },
});

export const setWatchlistStatus = mutation({
  args: {
    show: v.object(showInput),
    status: userShowStatusValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);
    const now = Date.now();

    const relationRootAnilistId =
      args.show.mediaType === "anime"
        ? args.show.rootAnilistId ?? args.show.anilistId
        : undefined;

    const existing = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (!existing) {
      const insertData: Omit<Doc<"userShows">, "_id" | "_creationTime"> = {
        userId,
        showId,
        status: args.status,
        statusChangedAt: now,
        addedAt: now,
      };
      
      if (typeof relationRootAnilistId === "number") {
        insertData.relationRootAnilistId = relationRootAnilistId;
        insertData.isAutoTracked = false;
      }
      
      if (args.status === "completed") {
        insertData.lastWatchedAt = now;
        insertData.completedAt = now;
      }
      
      if (args.status === "watching") {
        insertData.lastWatchedAt = now;
      }
      
      if (args.status === "dropped") {
        insertData.droppedAt = now;
      }
      
      await ctx.db.insert("userShows", insertData);

      return {
        inWatchlist: true,
        status: args.status as UserShowStatus,
      };
    }

    const patch: Partial<Doc<"userShows">> = {
      status: args.status as UserShowStatus,
      statusChangedAt: now,
    };

    if (typeof relationRootAnilistId === "number") {
      patch.relationRootAnilistId = relationRootAnilistId;
      if (
        args.show.mediaType === "anime" &&
        typeof args.show.anilistId === "number" &&
        relationRootAnilistId === args.show.anilistId
      ) {
        patch.isAutoTracked = false;
      }
    }

    if (args.status === "completed") {
      if (typeof existing.lastWatchedAt !== "number") {
        patch.lastWatchedAt = now;
      }
      patch.completedAt = now;
      patch.droppedAt = undefined; // Clear dropped date if completed
    }

    if (args.status === "watching" && typeof existing.lastWatchedAt !== "number") {
      patch.lastWatchedAt = now;
    }
    
    if (args.status === "dropped") {
      patch.droppedAt = now;
    }

    // Clear completedAt when transitioning away from completed
    if (existing.status === "completed" && args.status !== "completed") {
      patch.completedAt = undefined;
    }

    // Clear droppedAt when transitioning away from dropped
    if (existing.status === "dropped" && args.status !== "dropped") {
      patch.droppedAt = undefined;
    }

    // Clear autoPausedAt when manually changing status
    if (existing.autoPausedAt) {
      patch.autoPausedAt = undefined;
    }

    await ctx.db.patch(existing._id, patch);

    return {
      inWatchlist: true,
      status: args.status as UserShowStatus,
    };
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
      runtime: args.runtime ?? args.show.episodeRuntime,
      watchCount: 1,
      watchHistory: [now],
    });

    const totalWatched = watchedEpisodes.length + 1;
    
    // Determine next status based on progress
    let nextStatus: UserShowStatus = userShow?.status ?? "watching";
    let statusChanged = false;
    
    // Auto-resume from paused/planned
    if (nextStatus === "paused" || nextStatus === "plan_to_watch") {
      nextStatus = "watching";
      statusChanged = true;
    }

    // Auto-resume from completed if new episodes added
    if (
      userShow?.status === "completed" &&
      args.show.totalEpisodes &&
      totalWatched < args.show.totalEpisodes
    ) {
      nextStatus = "watching";
      statusChanged = true;
    }

    // Auto-complete when all episodes watched
    if (
      args.show.totalEpisodes &&
      totalWatched >= args.show.totalEpisodes &&
      nextStatus !== "completed"
    ) {
      nextStatus = "completed";
      statusChanged = true;
    }

    if (userShow) {
      const updateData: Partial<Doc<"userShows">> = {
        status: nextStatus,
        lastWatchedAt: now,
      };
      
      if (statusChanged) {
        updateData.statusChangedAt = now;
        // Clear stale automation fields when status changes
        if (userShow.autoPausedAt) {
          updateData.autoPausedAt = undefined;
        }
        if (userShow.droppedAt) {
          updateData.droppedAt = undefined;
        }
      }

      if (nextStatus === "completed") {
        updateData.completedAt = now;
      } else if (userShow.status === "completed") {
        // Clear completedAt when transitioning away from completed
        updateData.completedAt = undefined;
      }
      
      await ctx.db.patch(userShow._id, updateData);
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
          runtime: entry.runtime ?? args.show.episodeRuntime,
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
      const statusChanged = userShow.status !== nextStatus;
      const updateData: Partial<Doc<"userShows">> = {
        status: nextStatus,
        lastWatchedAt: now,
      };

      if (statusChanged) {
        updateData.statusChangedAt = now;
        if (userShow.autoPausedAt) {
          updateData.autoPausedAt = undefined;
        }
        if (userShow.droppedAt) {
          updateData.droppedAt = undefined;
        }
        if (userShow.status === "completed") {
          updateData.completedAt = undefined;
        }
      }

      if (nextStatus === "completed") {
        updateData.completedAt = now;
      }

      await ctx.db.patch(userShow._id, updateData);
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
        runtime: entry.runtime ?? args.show.episodeRuntime,
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
      const statusChanged = userShow.status !== nextStatus;
      const updateData: Partial<Doc<"userShows">> = {
        status: nextStatus,
        lastWatchedAt: now,
      };

      if (statusChanged) {
        updateData.statusChangedAt = now;
        if (userShow.autoPausedAt) {
          updateData.autoPausedAt = undefined;
        }
        if (userShow.droppedAt) {
          updateData.droppedAt = undefined;
        }
        if (userShow.status === "completed") {
          updateData.completedAt = undefined;
        }
      }

      if (nextStatus === "completed") {
        updateData.completedAt = now;
      }

      await ctx.db.patch(userShow._id, updateData);
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
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const watchedByShow = new Map<string, Set<string>>();
    const lastWatchedAtByShow = new Map<string, number>();
    for (const entry of watchedEpisodes) {
      const key = entry.showId as string;
      if (!watchedByShow.has(key)) {
        watchedByShow.set(key, new Set());
      }
      watchedByShow.get(key)!.add(`${entry.season}:${entry.episode}`);

      const currentLastWatchedAt = lastWatchedAtByShow.get(key) ?? 0;
      if (entry.watchedAt > currentLastWatchedAt) {
        lastWatchedAtByShow.set(key, entry.watchedAt);
      }
    }

    const seasonMonthOffsetByName: Record<string, number> = {
      WINTER: 0,
      SPRING: 3,
      SUMMER: 6,
      FALL: 9,
    };

    const mainlineFormats = new Set(["TV", "TV_SHORT"]);

    const formatWeightByType: Record<string, number> = {
      TV: 0,
      TV_SHORT: 1,
      MOVIE: 2,
      ONA: 3,
      OVA: 4,
      SPECIAL: 5,
      MUSIC: 6,
    };

    const getChronologyValue = (entry: {
      firstAired: string | null;
      animeSeason: string | null;
      animeSeasonYear: number | null;
    }) => {
      const firstAired = entry.firstAired?.trim();
      if (firstAired) {
        const directDateMatch = firstAired.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (directDateMatch) {
          const year = Number.parseInt(directDateMatch[1], 10);
          const month = Number.parseInt(directDateMatch[2], 10) - 1;
          const day = Number.parseInt(directDateMatch[3], 10);
          const asDate = Date.UTC(year, month, day);
          if (Number.isFinite(asDate)) {
            return asDate;
          }
        }

        const parsed = new Date(firstAired).getTime();
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      if (typeof entry.animeSeasonYear === "number") {
        const season = entry.animeSeason?.toUpperCase() ?? "";
        const monthOffset = seasonMonthOffsetByName[season] ?? 0;
        return Date.UTC(entry.animeSeasonYear, monthOffset, 1);
      }

      return Number.MAX_SAFE_INTEGER;
    };

    const getFormatWeight = (entry: { anilistFormat: string | null }) => {
      const format = entry.anilistFormat?.toUpperCase();
      if (!format) {
        return 99;
      }
      return formatWeightByType[format] ?? 99;
    };

    const isMainlineAnime = (entry: { anilistFormat: string | null }) => {
      const format = entry.anilistFormat?.toUpperCase();
      if (!format) {
        return true;
      }
      return mainlineFormats.has(format);
    };

    const sortAnimeCandidates = (
      a: {
        title: string;
        firstAired: string | null;
        animeSeason: string | null;
        animeSeasonYear: number | null;
        anilistFormat: string | null;
        anilistId: number | null;
        malId: number | null;
      },
      b: {
        title: string;
        firstAired: string | null;
        animeSeason: string | null;
        animeSeasonYear: number | null;
        anilistFormat: string | null;
        anilistId: number | null;
        malId: number | null;
      }
    ) => {
      const chronologyA = getChronologyValue(a);
      const chronologyB = getChronologyValue(b);
      if (chronologyA !== chronologyB) {
        return chronologyA - chronologyB;
      }

      const formatA = getFormatWeight(a);
      const formatB = getFormatWeight(b);
      if (formatA !== formatB) {
        return formatA - formatB;
      }

      if (a.title !== b.title) {
        return a.title.localeCompare(b.title);
      }

      const idA = a.anilistId ?? a.malId ?? Number.MAX_SAFE_INTEGER;
      const idB = b.anilistId ?? b.malId ?? Number.MAX_SAFE_INTEGER;
      return idA - idB;
    };

    const watchlistItems = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show || show.mediaType === "movie") {
          return null;
        }

        const totalEpisodes =
          typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;

        const watchedKeys = watchedByShow.get(userShow.showId as string) || new Set();
        const watchedCount = watchedKeys.size;
        const remainingEpisodes =
          totalEpisodes === null
            ? null
            : Math.max(totalEpisodes - watchedCount, 0);

        const progressPercent =
          totalEpisodes && totalEpisodes > 0
            ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
            : null;

        const lastWatchedEntry = watchedEpisodes
          .filter((e) => e.showId === userShow.showId)
          .sort((a, b) => b.watchedAt - a.watchedAt)[0];

        const trackingState =
          totalEpisodes === null
            ? watchedCount > 0
              ? "upcoming"
              : "tba"
            : watchedCount === 0
              ? "not_started"
              : "in_progress";

        return {
          id: getExternalShowId(show) ?? String(show._id),
          title: show.title,
          mediaType: show.mediaType,
          posterUrl: show.posterUrl ?? null,
          backdropUrl: show.backdropUrl ?? null,
          overview: show.overview ?? null,
          firstAired: show.firstAired ?? null,
          tmdbId: show.tmdbId ?? null,
          anilistId: show.anilistId ?? null,
          malId: show.malId ?? null,
          tvmazeId: show.tvmazeId ?? null,
          imdbId: show.imdbId ?? null,
          status: userShow.status,
          isAutoTracked: userShow.isAutoTracked ?? false,
          trackingState,
          relationRootAnilistId:
            userShow.relationRootAnilistId ?? show.rootAnilistId ?? show.anilistId ?? null,
          anilistFormat: show.anilistFormat ?? null,
          animeSeason: show.animeSeason ?? null,
          animeSeasonYear: show.animeSeasonYear ?? null,
          watchedEpisodes: watchedCount,
          totalEpisodes,
          remainingEpisodes,
          progressPercent,
          lastWatchedAt:
            userShow.lastWatchedAt ??
            lastWatchedEntry?.watchedAt ??
            lastWatchedAtByShow.get(userShow.showId as string) ??
            userShow.addedAt,
        };
      })
    );

    const hydrated = watchlistItems.filter(
      (item): item is NonNullable<typeof item> => item !== null
    );

    const groupedAnime = new Map<string, (typeof hydrated)[number][]>();
    const selectedEntries: (typeof hydrated)[number][] = [];

    const isCompletedEntry = (entry: {
      status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
      remainingEpisodes: number | null;
    }) =>
      entry.status === "completed" ||
      (typeof entry.remainingEpisodes === "number" && entry.remainingEpisodes <= 0);

    for (const item of hydrated) {
      if (item.mediaType !== "anime") {
        selectedEntries.push(item);
        continue;
      }

      const groupKey =
        typeof item.relationRootAnilistId === "number"
          ? `root:${item.relationRootAnilistId}`
          : typeof item.anilistId === "number"
            ? `anilist:${item.anilistId}`
            : typeof item.malId === "number"
              ? `mal:${item.malId}`
              : `show:${item.id}`;

      const group = groupedAnime.get(groupKey) ?? [];
      group.push(item);
      groupedAnime.set(groupKey, group);
    }

    for (const entries of groupedAnime.values()) {
      const nonCompleted = entries.filter((entry) => !isCompletedEntry(entry));
      const watchingEntries = nonCompleted.filter((entry) => entry.status === "watching");
      const pausedEntries = nonCompleted.filter((entry) => entry.status === "paused");
      const plannedEntries = nonCompleted.filter((entry) => entry.status === "plan_to_watch");
      const droppedEntries = nonCompleted.filter((entry) => entry.status === "dropped");

      const displayable =
        watchingEntries.length > 0
          ? watchingEntries
          : pausedEntries.length > 0
            ? pausedEntries
            : plannedEntries.length > 0
              ? plannedEntries
              : droppedEntries.length > 0
                ? droppedEntries
                : nonCompleted.length > 0
                  ? nonCompleted
                  : entries;

      if (displayable.length === 0) {
        continue;
      }

      const mainlineDisplayable = displayable.filter((entry) => isMainlineAnime(entry));
      const pool = mainlineDisplayable.length > 0 ? mainlineDisplayable : displayable;
      const sortedPool = [...pool].sort(sortAnimeCandidates);

      if (sortedPool.length === 0) {
        continue;
      }

      selectedEntries.push(sortedPool[0]);
    }

    return selectedEntries
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
      .map(
        ({
          relationRootAnilistId: _relationRootAnilistId,
          anilistFormat: _anilistFormat,
          animeSeason: _animeSeason,
          animeSeasonYear: _animeSeasonYear,
          ...rest
        }) => rest
      );
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
      const statusChanged = userShow.status !== nextStatus;
      const updateData: Partial<Doc<"userShows">> = {
        status: nextStatus,
        lastWatchedAt: now,
      };

      if (statusChanged) {
        updateData.statusChangedAt = now;
        if (userShow.autoPausedAt) {
          updateData.autoPausedAt = undefined;
        }
        if (userShow.droppedAt) {
          updateData.droppedAt = undefined;
        }
        if (userShow.status === "completed") {
          updateData.completedAt = undefined;
        }
      }

      if (nextStatus === "completed") {
        updateData.completedAt = now;
      }

      await ctx.db.patch(userShow._id, updateData);
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

// Status Automation Functions

const INACTIVITY_THRESHOLD_DAYS = 30;
const DROPPED_REMINDER_DAYS = 90;

/**
 * Check if a show should be auto-paused due to inactivity
 */
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

/**
 * Check if completed show should be resumed due to new episodes
 */
function shouldResumeForNewContent(
  currentStatus: UserShowStatus,
  completedAt: number | undefined,
  hasNewEpisodes: boolean
): boolean {
  if (currentStatus !== "completed") return false;
  if (!hasNewEpisodes) return false;
  return true;
}

/**
 * Scheduled internal mutation to auto-pause inactive shows
 * Runs daily via cron job
 */
export const autoPauseInactiveShows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTime = now - (INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    
    // Find all "watching" shows where lastWatchedAt is older than threshold
    const showsToPause = await ctx.db
      .query("userShows")
      .withIndex("by_status_last_watched", (q) => 
        q.eq("status", "watching").lt("lastWatchedAt", cutoffTime)
      )
      .collect();
    
    let pausedCount = 0;
    
    for (const userShow of showsToPause) {
      // Double-check the condition
      if (shouldAutoPause(userShow.status, userShow.lastWatchedAt, now)) {
        await ctx.db.patch(userShow._id, {
          status: "paused",
          statusChangedAt: now,
          autoPausedAt: now,
        });
        pausedCount++;
        
        // TODO: Send push notification when notifications are implemented
        // await sendPushNotification({
        //   userId: userShow.userId,
        //   title: "Show auto-paused",
        //   body: `You haven't watched this show in ${INACTIVITY_THRESHOLD_DAYS} days. Status set to Paused.`,
        //   data: { showId: userShow.showId },
        // });
      }
    }
    
    return { pausedCount };
  },
});

/**
 * Check for shows that need status updates based on episode activity
 * Call this when episodes are marked/unmarked
 */
async function updateStatusBasedOnProgress(
  ctx: MutationCtx,
  userShowId: Id<"userShows">,
  showId: Id<"shows">,
  totalEpisodes?: number
) {
  const userShow = await ctx.db.get(userShowId);
  if (!userShow) return;
  
  const watchedEpisodes = await ctx.db
    .query("watchedEpisodes")
    .withIndex("by_user_show", (q) => 
      q.eq("userId", userShow.userId).eq("showId", showId)
    )
    .collect();
  
  const now = Date.now();
  const watchedCount = watchedEpisodes.length;
  
  // Rule 1: Auto-complete when all episodes watched
  if (
    userShow.status === "watching" &&
    totalEpisodes &&
    watchedCount >= totalEpisodes
  ) {
    await ctx.db.patch(userShowId, {
      status: "completed",
      statusChangedAt: now,
      completedAt: now,
    });
    return;
  }
  
  // Rule 2: Resume from paused when episode is watched
  if (
    (userShow.status === "paused" || userShow.status === "plan_to_watch") &&
    watchedCount > 0
  ) {
    await ctx.db.patch(userShowId, {
      status: "watching",
      statusChangedAt: now,
    });
    return;
  }
  
  // Rule 3: Un-complete when episodes are removed
  if (
    userShow.status === "completed" &&
    totalEpisodes &&
    watchedCount < totalEpisodes
  ) {
    await ctx.db.patch(userShowId, {
      status: "watching",
      statusChangedAt: now,
      completedAt: undefined,
    });
    return;
  }
}

/**
 * Get user automation preferences (placeholder for future implementation)
 */
export const getUserAutomationPreferences = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserId(ctx);
    // Return default preferences until user settings are implemented
    return {
      autoPauseEnabled: true,
      autoPauseDays: INACTIVITY_THRESHOLD_DAYS,
      autoCompleteEnabled: true,
      newSeasonNotifications: true,
      droppedRemindersEnabled: true,
      droppedReminderDays: DROPPED_REMINDER_DAYS,
    };
  },
});
