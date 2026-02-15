import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "@/convex/_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "@/convex/_generated/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { api, internal } from "@/convex/_generated/api";
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
const IMPORT_TRACKED_SHOWS_MAX_ITEMS = 20;
const RELATION_INCLUDE_TYPES = new Set(["PREQUEL", "SEQUEL"]);

const showInput = {
  tmdbId: v.optional(v.number()),
  tvdbId: v.optional(v.number()),
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
  tvdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  malId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  mediaType: v.optional(v.union(v.literal("tv"), v.literal("anime"), v.literal("movie"))),
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

const TERMINAL_SHOW_LIFECYCLE_STATUSES = new Set([
  "ended",
  "finished",
  "finished airing",
  "completed",
  "complete",
  "released",
  "canceled",
  "cancelled",
]);

function hasLookupArgs(args: {
  tmdbId?: number;
  tvdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  mediaType?: "tv" | "anime" | "movie";
}) {
  return (
    typeof args.tmdbId === "number" ||
    typeof args.tvdbId === "number" ||
    typeof args.anilistId === "number" ||
    typeof args.malId === "number" ||
    typeof args.tvmazeId === "number"
  );
}

function pickBestLookupCandidate(
  candidates: Doc<"shows">[],
  expected?: "tv" | "anime" | "movie"
) {
  if (candidates.length === 0) {
    return null;
  }

  const scoped =
    expected !== undefined
      ? candidates.filter((candidate) => candidate.mediaType === expected)
      : candidates;

  if (scoped.length === 0) {
    return null;
  }

  return [...scoped].sort((a, b) => {
    const updatedA = a.lastUpdated ?? 0;
    const updatedB = b.lastUpdated ?? 0;
    if (updatedA !== updatedB) {
      return updatedB - updatedA;
    }
    return b._creationTime - a._creationTime;
  })[0];
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

function sortFiniteTimestamps(values: number[]) {
  return values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
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
    tvdbId: incoming.tvdbId ?? existing?.tvdbId,
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
  tvdbId?: number;
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
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId as Id<"users">;
}

type UserShowTrackingAggregates = {
  watchedEpisodesCount: number;
  watchedTotalCount: number;
  watchedRuntimeMinutes: number;
  lastWatchedAt?: number;
};

function getEpisodeLastWatchedAt(entry: Doc<"watchedEpisodes">) {
  const watchHistory = entry.watchHistory ?? [];
  if (watchHistory.length > 0) {
    return watchHistory[watchHistory.length - 1];
  }
  return entry.watchedAt;
}

function computeWatchedEpisodeAggregates(
  watchedEpisodes: Doc<"watchedEpisodes">[]
): UserShowTrackingAggregates {
  let watchedTotalCount = 0;
  let watchedRuntimeMinutes = 0;
  let lastWatchedAt: number | undefined;

  for (const entry of watchedEpisodes) {
    const watchCount = entry.watchCount ?? 1;
    watchedTotalCount += watchCount;

    const runtime = typeof entry.runtime === "number" ? entry.runtime : 0;
    watchedRuntimeMinutes += runtime * watchCount;

    const episodeLastWatchedAt = getEpisodeLastWatchedAt(entry);
    if (
      typeof episodeLastWatchedAt === "number" &&
      Number.isFinite(episodeLastWatchedAt) &&
      (typeof lastWatchedAt !== "number" || episodeLastWatchedAt > lastWatchedAt)
    ) {
      lastWatchedAt = episodeLastWatchedAt;
    }
  }

  return {
    watchedEpisodesCount: watchedEpisodes.length,
    watchedTotalCount,
    watchedRuntimeMinutes,
    lastWatchedAt,
  };
}

async function refreshUserShowTrackingAggregates(
  ctx: MutationCtx,
  userId: Id<"users">,
  showId: Id<"shows">
) {
  const userShow = await ctx.db
    .query("userShows")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
    .unique();

  if (!userShow) {
    return null;
  }

  const watchedEpisodes = await ctx.db
    .query("watchedEpisodes")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
    .collect();

  const aggregates = computeWatchedEpisodeAggregates(watchedEpisodes);

  await ctx.db.patch(userShow._id, {
    watchedEpisodesCount: aggregates.watchedEpisodesCount,
    watchedTotalCount: aggregates.watchedTotalCount,
    watchedRuntimeMinutes: aggregates.watchedRuntimeMinutes,
    lastWatchedAt: aggregates.lastWatchedAt,
  });

  return aggregates;
}

function normalizePositiveEpisodeCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function isTerminalLifecycleStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return TERMINAL_SHOW_LIFECYCLE_STATUSES.has(normalized);
}

function getImportedStatusFromProgress(
  importedStatus: UserShowStatus,
  show: Pick<ShowPayload, "mediaType" | "totalEpisodes" | "status">,
  watchedEpisodesCount: number
): UserShowStatus {
  if (importedStatus !== "watching") {
    return importedStatus;
  }

  if (show.mediaType === "movie") {
    return watchedEpisodesCount > 0 ? "completed" : importedStatus;
  }

  const totalEpisodes = normalizePositiveEpisodeCount(show.totalEpisodes);
  if (typeof totalEpisodes !== "number") {
    return importedStatus;
  }

  if (!isTerminalLifecycleStatus(show.status)) {
    return importedStatus;
  }

  return watchedEpisodesCount >= totalEpisodes ? "completed" : importedStatus;
}

function normalizeLookupTitle(title?: string) {
  if (!title) {
    return "";
  }

  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function extractLookupYear(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(19|20)\d{2}/);
  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[0], 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    return undefined;
  }

  return year;
}

async function findShowByLookup(
  ctx: QueryCtx | MutationCtx,
  args: {
    tmdbId?: number;
    tvdbId?: number;
    anilistId?: number;
    malId?: number;
    tvmazeId?: number;
    imdbId?: string;
    mediaType?: "tv" | "anime" | "movie";
    title?: string;
    firstAired?: string;
  }
) {
  const byTmdbCandidates =
    typeof args.tmdbId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_tmdbId", (q) => q.eq("tmdbId", args.tmdbId))
          .take(20)
      : [];
  const byTmdb = pickBestLookupCandidate(byTmdbCandidates, args.mediaType);
  if (byTmdb) {
    return byTmdb;
  }

  const byTvdbCandidates =
    typeof args.tvdbId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_tvdbId", (q) => q.eq("tvdbId", args.tvdbId))
          .take(20)
      : [];
  const byTvdb = pickBestLookupCandidate(byTvdbCandidates, args.mediaType);
  if (byTvdb) {
    return byTvdb;
  }

  const byAniListCandidates =
    typeof args.anilistId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_anilistId", (q) => q.eq("anilistId", args.anilistId))
          .take(20)
      : [];
  const byAniList = pickBestLookupCandidate(byAniListCandidates, args.mediaType);
  if (byAniList) {
    return byAniList;
  }

  const byMalIdCandidates =
    typeof args.malId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_malId", (q) => q.eq("malId", args.malId))
          .take(20)
      : [];
  const byMalId = pickBestLookupCandidate(byMalIdCandidates, args.mediaType);
  if (byMalId) {
    return byMalId;
  }

  const byTvMazeCandidates =
    typeof args.tvmazeId === "number"
      ? await ctx.db
          .query("shows")
          .withIndex("by_tvmazeId", (q) => q.eq("tvmazeId", args.tvmazeId))
          .take(20)
      : [];

  const byTvMaze = pickBestLookupCandidate(byTvMazeCandidates, args.mediaType);
  if (byTvMaze) {
    return byTvMaze;
  }

  if (!args.mediaType) {
    return null;
  }
  const mediaType = args.mediaType;

  const byMediaTypeCandidates = await ctx.db
    .query("shows")
    .withIndex("by_mediaType", (q) => q.eq("mediaType", mediaType))
    .order("desc")
    .take(500);

  const normalizedImdbId = args.imdbId?.trim().toLowerCase();
  if (normalizedImdbId) {
    const byImdb = byMediaTypeCandidates.find(
      (candidate) => candidate.imdbId?.trim().toLowerCase() === normalizedImdbId
    );
    if (byImdb) {
      return byImdb;
    }
  }

  const normalizedTitle = normalizeLookupTitle(args.title);
  if (!normalizedTitle) {
    return null;
  }

  const titleMatches = byMediaTypeCandidates.filter(
    (candidate) => normalizeLookupTitle(candidate.title) === normalizedTitle
  );

  if (titleMatches.length === 0) {
    return null;
  }

  const requestedYear = extractLookupYear(args.firstAired);
  if (typeof requestedYear !== "number") {
    return pickBestLookupCandidate(titleMatches, mediaType);
  }

  const yearMatches = titleMatches.filter(
    (candidate) => extractLookupYear(candidate.firstAired) === requestedYear
  );

  return pickBestLookupCandidate(
    yearMatches.length > 0 ? yearMatches : titleMatches,
    mediaType
  );
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
    tvdbId: show.tvdbId,
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
    tvdbId: incoming.tvdbId ?? existing.tvdbId,
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const hydrated = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show) {
          return null;
        }

        const watchedCount = userShow.watchedEpisodesCount ?? 0;
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
          genres: show.genres ?? [],
          rating: show.rating ?? null,
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

export const getLibrary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const hydrated = await Promise.all(
      userShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show) {
          return null;
        }

        const watchedCount = userShow.watchedEpisodesCount ?? 0;
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
          watchedEpisodes: watchedCount,
          totalEpisodes,
          remainingEpisodes,
          progressPercent,
          genres: show.genres ?? [],
          rating: show.rating ?? null,
          lastActivityAt: userShow.lastWatchedAt ?? userShow.addedAt,
        };
      })
    );

    return hydrated
      .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
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
      watchedEpisodesCount: 0,
      watchedTotalCount: 0,
      watchedRuntimeMinutes: 0,
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

export const importTrackedShows = mutation({
  args: {
    items: v.array(
      v.object({
        show: v.object(showInput),
        status: userShowStatusValidator,
        watchedEpisodes: v.array(
          v.object({
            season: v.number(),
            episode: v.number(),
            watchedAt: v.optional(v.number()),
            watchCount: v.optional(v.number()),
            watchHistory: v.optional(v.array(v.number())),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (args.items.length > IMPORT_TRACKED_SHOWS_MAX_ITEMS) {
      throw new Error(
        `Too many items in one import request. Max ${IMPORT_TRACKED_SHOWS_MAX_ITEMS} items per request.`
      );
    }

    const now = Date.now();
    const processedShowIds = new Set<string>();

    let importedShows = 0;
    let insertedEpisodes = 0;
    let skippedEpisodes = 0;

    for (const item of args.items) {
      const showId = await ensureShowRecordId(ctx, item.show);

      const existingUserShow = await ctx.db
        .query("userShows")
        .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
        .unique();

      let userShowId: Id<"userShows">;

      const hasWatchedEpisodes = item.watchedEpisodes.length > 0;
      const relationRootAnilistId =
        item.show.mediaType === "anime"
          ? item.show.rootAnilistId ?? item.show.anilistId
          : undefined;

      if (!existingUserShow) {
        const insertData: Omit<Doc<"userShows">, "_id" | "_creationTime"> = {
          userId,
          showId,
          status: item.status,
          addedAt: now,
          watchedEpisodesCount: 0,
          watchedTotalCount: 0,
          watchedRuntimeMinutes: 0,
          statusChangedAt: now,
        };

        if (typeof relationRootAnilistId === "number") {
          insertData.relationRootAnilistId = relationRootAnilistId;
          insertData.isAutoTracked = false;
        }

        if (hasWatchedEpisodes) {
          insertData.lastWatchedAt = now;
        }

        if (item.status === "completed") {
          insertData.completedAt = now;
        }

        if (item.status === "dropped") {
          insertData.droppedAt = now;
        }

        userShowId = await ctx.db.insert("userShows", insertData);
      } else {
        userShowId = existingUserShow._id;
        const patch: Partial<Doc<"userShows">> = {
          status: item.status,
          statusChangedAt: now,
        };

        if (typeof relationRootAnilistId === "number") {
          patch.relationRootAnilistId = relationRootAnilistId;
          if (
            item.show.mediaType === "anime" &&
            typeof item.show.anilistId === "number" &&
            relationRootAnilistId === item.show.anilistId
          ) {
            patch.isAutoTracked = false;
          }
        }

        if (hasWatchedEpisodes) {
          patch.lastWatchedAt = now;
        }

        patch.completedAt = item.status === "completed" ? now : undefined;
        patch.droppedAt = item.status === "dropped" ? now : undefined;

        await ctx.db.patch(existingUserShow._id, patch);
      }

      const existingEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
        .collect();

      const existingEpisodeKeys = new Set(
        existingEpisodes.map((entry) => `${entry.season}:${entry.episode}`)
      );

      const mergedIncomingEpisodes = new Map<
        string,
        {
          season: number;
          episode: number;
          watchedAt?: number;
          watchCount?: number;
          watchHistory?: number[];
        }
      >();

      for (const episode of item.watchedEpisodes) {
        const episodeKey = `${episode.season}:${episode.episode}`;
        const incomingHistory = Array.isArray(episode.watchHistory)
          ? sortFiniteTimestamps(
              episode.watchHistory.filter(
                (entry): entry is number =>
                  typeof entry === "number" && Number.isFinite(entry)
              )
            )
          : typeof episode.watchedAt === "number" && Number.isFinite(episode.watchedAt)
            ? [episode.watchedAt]
            : [];

        const incomingCount =
          typeof episode.watchCount === "number" && Number.isFinite(episode.watchCount)
            ? Math.max(1, Math.floor(episode.watchCount))
            : incomingHistory.length > 0
              ? incomingHistory.length
              : 1;

        const existing = mergedIncomingEpisodes.get(episodeKey);
        if (!existing) {
          mergedIncomingEpisodes.set(episodeKey, {
            season: episode.season,
            episode: episode.episode,
            watchedAt: episode.watchedAt,
            watchCount: incomingCount,
            watchHistory: incomingHistory,
          });
          continue;
        }

        const existingHistory = sortFiniteTimestamps(
          Array.isArray(existing.watchHistory) ? existing.watchHistory : []
        );
        const mergedHistory = sortFiniteTimestamps([
          ...existingHistory,
          ...incomingHistory,
        ]);
        const mergedCount = (existing.watchCount ?? 1) + incomingCount;

        const watchedAtCandidates = [
          existing.watchedAt,
          episode.watchedAt,
          mergedHistory.length > 0 ? mergedHistory[mergedHistory.length - 1] : undefined,
        ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

        const mergedWatchedAt =
          watchedAtCandidates.length > 0
            ? watchedAtCandidates.reduce((max, value) => (value > max ? value : max), watchedAtCandidates[0])
            : undefined;

        mergedIncomingEpisodes.set(episodeKey, {
          season: episode.season,
          episode: episode.episode,
          watchedAt: mergedWatchedAt,
          watchCount: mergedCount,
          watchHistory: mergedHistory,
        });
      }

      const uniqueIncomingEpisodes = Array.from(mergedIncomingEpisodes.values());

      for (const episode of uniqueIncomingEpisodes) {
        const key = `${episode.season}:${episode.episode}`;
        if (existingEpisodeKeys.has(key)) {
          skippedEpisodes += 1;
          continue;
        }

        const watchedAt =
          typeof episode.watchedAt === "number" && Number.isFinite(episode.watchedAt)
            ? episode.watchedAt
            : now;

        const watchHistory = Array.isArray(episode.watchHistory)
          ? sortFiniteTimestamps(
              episode.watchHistory.filter(
                (entry): entry is number =>
                  typeof entry === "number" && Number.isFinite(entry)
              )
            )
          : [];
        const normalizedWatchHistory =
          watchHistory.length > 0 ? watchHistory : [watchedAt];
        const watchCount =
          typeof episode.watchCount === "number" && Number.isFinite(episode.watchCount)
            ? Math.max(1, Math.floor(episode.watchCount), normalizedWatchHistory.length)
            : normalizedWatchHistory.length;
        const normalizedWatchedAt =
          normalizedWatchHistory.length > 0
            ? normalizedWatchHistory[normalizedWatchHistory.length - 1]
            : watchedAt;

        await ctx.db.insert("watchedEpisodes", {
          userId,
          showId,
          season: episode.season,
          episode: episode.episode,
          watchedAt: normalizedWatchedAt,
          runtime: item.show.episodeRuntime,
          watchCount,
          watchHistory: normalizedWatchHistory,
        });

        insertedEpisodes += 1;
      }

      const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

      const watchedEpisodesCount = Math.max(
        0,
        Math.floor(refreshed?.watchedEpisodesCount ?? item.watchedEpisodes.length)
      );
      const normalizedImportStatus = getImportedStatusFromProgress(
        item.status,
        item.show,
        watchedEpisodesCount
      );

      if (normalizedImportStatus !== item.status) {
        await ctx.db.patch(userShowId, {
          status: normalizedImportStatus,
          statusChangedAt: now,
          completedAt: normalizedImportStatus === "completed" ? now : undefined,
          droppedAt: normalizedImportStatus === "dropped" ? now : undefined,
        });
      }

      const showKey = String(showId);
      if (!processedShowIds.has(showKey)) {
        processedShowIds.add(showKey);
        importedShows += 1;
      }
    }

    return {
      importedShows,
      insertedEpisodes,
      skippedEpisodes,
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

        await refreshUserShowTrackingAggregates(ctx, userId, showId);

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

        const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

        return {
          watched: false,
          watchedEpisodes: refreshed?.watchedEpisodesCount ?? remainingCount,
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

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      watched: true,
      watchedEpisodes: refreshed?.watchedEpisodesCount ?? totalWatched,
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      processedCount: uniqueEpisodes.length,
      updatedCount,
      insertedCount,
      watchedEpisodes: refreshed?.watchedEpisodesCount ?? totalWatched,
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      addedCount,
      watchedEpisodes: refreshed?.watchedEpisodesCount ?? totalWatched,
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

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      removedCount,
      watchedEpisodes: refreshed?.watchedEpisodesCount ?? watchedEpisodes.length - removedCount,
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

    await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      removedCount: watchedEpisodes.length,
    };
  },
});

export const getWatchlist = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    
    // Return empty array if user is not authenticated
    if (!userId) {
      return [];
    }

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .collect();

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

        const watchedCount = userShow.watchedEpisodesCount ?? 0;
        const remainingEpisodes =
          totalEpisodes === null
            ? null
            : Math.max(totalEpisodes - watchedCount, 0);

        const progressPercent =
          totalEpisodes && totalEpisodes > 0
            ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
            : null;

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
          lastWatchedAt: userShow.lastWatchedAt ?? userShow.addedAt,
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

const RESET_USER_DATA_BATCH_SIZE = 400;
const RESET_USER_DATA_MAX_BATCHES = 250;
const RESET_GLOBAL_MEDIA_BATCH_SIZE = 500;
const RESET_GLOBAL_MEDIA_MAX_BATCHES = 1000;

export const resetUserTrackingDataBatch = internalMutation({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    let remaining = Math.max(1, Math.floor(args.limit));

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(remaining);

    for (const entry of watchedEpisodes) {
      await ctx.db.delete(entry._id);
    }

    remaining -= watchedEpisodes.length;

    const userShows =
      remaining > 0
        ? await ctx.db
            .query("userShows")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .take(remaining)
        : [];

    for (const entry of userShows) {
      await ctx.db.delete(entry._id);
    }

    remaining -= userShows.length;

    const userFavorites =
      remaining > 0
        ? await ctx.db
            .query("userFavorites")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .take(remaining)
        : [];

    for (const entry of userFavorites) {
      await ctx.db.delete(entry._id);
    }

    remaining -= userFavorites.length;

    const customLists =
      remaining > 0
        ? await ctx.db
            .query("customLists")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .take(remaining)
        : [];

    for (const entry of customLists) {
      await ctx.db.delete(entry._id);
    }

    const deletedTotal =
      watchedEpisodes.length +
      userShows.length +
      userFavorites.length +
      customLists.length;

    return {
      removedUserShows: userShows.length,
      removedWatchedEpisodes: watchedEpisodes.length,
      removedFavorites: userFavorites.length,
      removedLists: customLists.length,
      deletedTotal,
      hasMore: deletedTotal >= args.limit,
    };
  },
});

export const resetUserTrackingData = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    let removedUserShows = 0;
    let removedWatchedEpisodes = 0;
    let removedFavorites = 0;
    let removedLists = 0;
    let batches = 0;

    while (batches < RESET_USER_DATA_MAX_BATCHES) {
      const batchResult: {
        removedUserShows: number;
        removedWatchedEpisodes: number;
        removedFavorites: number;
        removedLists: number;
        deletedTotal: number;
        hasMore: boolean;
      } = await ctx.runMutation(internal.shows.resetUserTrackingDataBatch, {
        userId,
        limit: RESET_USER_DATA_BATCH_SIZE,
      });

      removedUserShows += batchResult.removedUserShows;
      removedWatchedEpisodes += batchResult.removedWatchedEpisodes;
      removedFavorites += batchResult.removedFavorites;
      removedLists += batchResult.removedLists;
      batches += 1;

      if (!batchResult.hasMore || batchResult.deletedTotal === 0) {
        return {
          removedUserShows,
          removedWatchedEpisodes,
          removedFavorites,
          removedLists,
          batches,
          completed: true,
        };
      }
    }

    return {
      removedUserShows,
      removedWatchedEpisodes,
      removedFavorites,
      removedLists,
      batches,
      completed: false,
    };
  },
});

export const resetGlobalMediaDataBatch = internalMutation({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    let remaining = Math.max(1, Math.floor(args.limit));

    const watchedEpisodes = await ctx.db.query("watchedEpisodes").take(remaining);
    for (const entry of watchedEpisodes) {
      await ctx.db.delete(entry._id);
    }
    remaining -= watchedEpisodes.length;

    const userShows =
      remaining > 0 ? await ctx.db.query("userShows").take(remaining) : [];
    for (const entry of userShows) {
      await ctx.db.delete(entry._id);
    }
    remaining -= userShows.length;

    const userFavorites =
      remaining > 0 ? await ctx.db.query("userFavorites").take(remaining) : [];
    for (const entry of userFavorites) {
      await ctx.db.delete(entry._id);
    }
    remaining -= userFavorites.length;

    const customLists =
      remaining > 0 ? await ctx.db.query("customLists").take(remaining) : [];
    for (const entry of customLists) {
      await ctx.db.delete(entry._id);
    }
    remaining -= customLists.length;

    const shows = remaining > 0 ? await ctx.db.query("shows").take(remaining) : [];
    for (const entry of shows) {
      await ctx.db.delete(entry._id);
    }
    remaining -= shows.length;

    const scheduleCache =
      remaining > 0 ? await ctx.db.query("scheduleCache").take(remaining) : [];
    for (const entry of scheduleCache) {
      await ctx.db.delete(entry._id);
    }

    const deletedTotal =
      watchedEpisodes.length +
      userShows.length +
      userFavorites.length +
      customLists.length +
      shows.length +
      scheduleCache.length;

    return {
      removedWatchedEpisodes: watchedEpisodes.length,
      removedUserShows: userShows.length,
      removedFavorites: userFavorites.length,
      removedLists: customLists.length,
      removedShows: shows.length,
      removedScheduleCache: scheduleCache.length,
      deletedTotal,
      hasMore: deletedTotal >= args.limit,
    };
  },
});

export const resetGlobalMediaData = internalAction({
  args: {},
  handler: async (ctx) => {
    let removedWatchedEpisodes = 0;
    let removedUserShows = 0;
    let removedFavorites = 0;
    let removedLists = 0;
    let removedShows = 0;
    let removedScheduleCache = 0;
    let batches = 0;

    while (batches < RESET_GLOBAL_MEDIA_MAX_BATCHES) {
      const batchResult: {
        removedWatchedEpisodes: number;
        removedUserShows: number;
        removedFavorites: number;
        removedLists: number;
        removedShows: number;
        removedScheduleCache: number;
        deletedTotal: number;
        hasMore: boolean;
      } = await ctx.runMutation(internal.shows.resetGlobalMediaDataBatch, {
        limit: RESET_GLOBAL_MEDIA_BATCH_SIZE,
      });

      removedWatchedEpisodes += batchResult.removedWatchedEpisodes;
      removedUserShows += batchResult.removedUserShows;
      removedFavorites += batchResult.removedFavorites;
      removedLists += batchResult.removedLists;
      removedShows += batchResult.removedShows;
      removedScheduleCache += batchResult.removedScheduleCache;
      batches += 1;

      if (!batchResult.hasMore || batchResult.deletedTotal === 0) {
        return {
          removedWatchedEpisodes,
          removedUserShows,
          removedFavorites,
          removedLists,
          removedShows,
          removedScheduleCache,
          batches,
          completed: true,
        };
      }
    }

    return {
      removedWatchedEpisodes,
      removedUserShows,
      removedFavorites,
      removedLists,
      removedShows,
      removedScheduleCache,
      batches,
      completed: false,
    };
  },
});

const TRACKING_BACKFILL_PAGE_SIZE = 120;
const STATUS_NORMALIZATION_PAGE_SIZE = 120;

export const getUserShowsPageForTrackingBackfill = internalQuery({
  args: {
    userId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate(args.paginationOpts);
  },
});

export const backfillUserShowTrackingAggregatesBatch = internalMutation({
  args: {
    userId: v.id("users"),
    userShowIds: v.array(v.id("userShows")),
  },
  handler: async (ctx, args) => {
    let patched = 0;

    for (const userShowId of args.userShowIds) {
      const userShow = await ctx.db.get(userShowId);
      if (!userShow || userShow.userId !== args.userId) {
        continue;
      }

      const watchedEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", args.userId).eq("showId", userShow.showId)
        )
        .collect();

      const aggregates = computeWatchedEpisodeAggregates(watchedEpisodes);

      await ctx.db.patch(userShowId, {
        watchedEpisodesCount: aggregates.watchedEpisodesCount,
        watchedTotalCount: aggregates.watchedTotalCount,
        watchedRuntimeMinutes: aggregates.watchedRuntimeMinutes,
        lastWatchedAt: aggregates.lastWatchedAt ?? userShow.lastWatchedAt,
      });

      patched += 1;
    }

    return { patched };
  },
});

export const normalizeWatchingStatusesBatch = internalMutation({
  args: {
    userId: v.id("users"),
    userShowIds: v.array(v.id("userShows")),
  },
  handler: async (ctx, args) => {
    let normalized = 0;
    const now = Date.now();

    for (const userShowId of args.userShowIds) {
      const userShow = await ctx.db.get(userShowId);
      if (!userShow || userShow.userId !== args.userId || userShow.status !== "watching") {
        continue;
      }

      const show = await ctx.db.get(userShow.showId);
      if (!show) {
        continue;
      }

      const watchedEpisodesCount = Math.max(
        0,
        Math.floor(userShow.watchedEpisodesCount ?? 0)
      );

      const nextStatus = getImportedStatusFromProgress(
        userShow.status,
        {
          mediaType: show.mediaType,
          totalEpisodes: show.totalEpisodes,
          status: show.status,
        },
        watchedEpisodesCount
      );

      if (nextStatus !== userShow.status) {
        await ctx.db.patch(userShowId, {
          status: nextStatus,
          statusChangedAt: now,
          completedAt: nextStatus === "completed" ? now : undefined,
          droppedAt: nextStatus === "dropped" ? now : undefined,
        });
        normalized += 1;
      }
    }

    return { normalized };
  },
});

async function rebuildTrackingAggregatesForUser(
  ctx: ActionCtx,
  userId: Id<"users">
) {
  let cursor: string | null = null;
  let scanned = 0;
  let patched = 0;
  let batches = 0;

  while (true) {
    const page: {
      page: Array<Doc<"userShows">>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.shows.getUserShowsPageForTrackingBackfill, {
      userId,
      paginationOpts: {
        cursor,
        numItems: TRACKING_BACKFILL_PAGE_SIZE,
      },
    });

    scanned += page.page.length;

    if (page.page.length > 0) {
      const batchResult: { patched: number } = await ctx.runMutation(
        internal.shows.backfillUserShowTrackingAggregatesBatch,
        {
          userId,
          userShowIds: page.page.map((entry) => entry._id),
        }
      );
      patched += batchResult.patched;
      batches += 1;
    }

    if (page.isDone) {
      break;
    }

    cursor = page.continueCursor;
  }

  return {
    scanned,
    patched,
    batches,
  };
}

export const rebuildUserShowTrackingAggregatesForUser = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return rebuildTrackingAggregatesForUser(ctx, args.userId);
  },
});

async function normalizeWatchingStatusesForUser(
  ctx: ActionCtx,
  userId: Id<"users">
) {
  let cursor: string | null = null;
  let scanned = 0;
  let normalized = 0;
  let batches = 0;

  while (true) {
    const page: {
      page: Array<Doc<"userShows">>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.shows.getUserShowsPageForTrackingBackfill, {
      userId,
      paginationOpts: {
        cursor,
        numItems: STATUS_NORMALIZATION_PAGE_SIZE,
      },
    });

    scanned += page.page.length;

    if (page.page.length > 0) {
      const batchResult: { normalized: number } = await ctx.runMutation(
        internal.shows.normalizeWatchingStatusesBatch,
        {
          userId,
          userShowIds: page.page.map((entry) => entry._id),
        }
      );
      normalized += batchResult.normalized;
      batches += 1;
    }

    if (page.isDone) {
      break;
    }

    cursor = page.continueCursor;
  }

  return {
    scanned,
    normalized,
    batches,
  };
}

export const normalizeWatchingStatusesFromProgressForUser = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return normalizeWatchingStatusesForUser(ctx, args.userId);
  },
});

export const normalizeWatchingStatusesFromProgress = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    return normalizeWatchingStatusesForUser(ctx, userId);
  },
});

export const rebuildUserShowTrackingAggregates = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    return rebuildTrackingAggregatesForUser(ctx, userId);
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
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
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

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      addedCount,
      totalWatched: refreshed?.watchedEpisodesCount ?? totalWatched,
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

        await refreshUserShowTrackingAggregates(ctx, userId, showId);

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

        await refreshUserShowTrackingAggregates(ctx, userId, showId);

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
          watchedEpisodesCount: 0,
          watchedTotalCount: 0,
          watchedRuntimeMinutes: 0,
          addedAt: now,
          lastWatchedAt: now,
        });
      } else {
        await ctx.db.patch(userShow._id, {
          status: "completed",
          lastWatchedAt: now,
        });
      }

      await refreshUserShowTrackingAggregates(ctx, userId, showId);

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
 * Get recommended shows based on user's watch history
 * Returns shows that are similar to what the user has watched
 */
export const getRecommendations = query({
  args: {
    mediaType: v.optional(v.union(v.literal("tv"), v.literal("movie"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    
    // Return empty if not authenticated
    if (!userId) {
      return [];
    }

    const limit = Math.max(1, Math.min(args.limit ?? 8, 20));

    // Get user's tracked shows with aggregate fields.
    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .collect();

    const candidateUserShows = userShows
      .filter((userShow) => {
        const watchedCount = userShow.watchedEpisodesCount ?? 0;
        return watchedCount > 0 || userShow.status === "watching" || userShow.status === "completed";
      })
      .map((userShow) => {
        const activityAt = Math.max(
          userShow.lastWatchedAt ?? 0,
          userShow.statusChangedAt ?? 0,
          userShow.addedAt
        );

        return {
          userShow,
          activityAt,
          watchedCount: userShow.watchedEpisodesCount ?? 0,
        };
      })
      .sort((a, b) => b.activityAt - a.activityAt)
      .slice(0, 25);

    const hydratedSeeds = await Promise.all(
      candidateUserShows.map(async ({ userShow, activityAt, watchedCount }) => {
        const show = await ctx.db.get(userShow.showId as Id<"shows">);
        if (!show || typeof show.tmdbId !== "number") {
          return null;
        }

        if (show.mediaType !== "tv" && show.mediaType !== "movie") {
          return null;
        }

        if (args.mediaType && show.mediaType !== args.mediaType) {
          return null;
        }

        return {
          id: `tmdb:${show.mediaType}:${show.tmdbId}`,
          tmdbId: show.tmdbId,
          mediaType: show.mediaType,
          title: show.title,
          activityAt,
          watchedCount,
        };
      })
    );

    const dedupedByTmdb = new Map<string, {
      id: string;
      tmdbId: number;
      mediaType: "tv" | "movie";
      title: string;
      activityAt: number;
      watchedCount: number;
    }>();

    for (const seed of hydratedSeeds) {
      if (!seed) continue;
      const key = `${seed.mediaType}:${seed.tmdbId}`;
      const existing = dedupedByTmdb.get(key);
      if (!existing || seed.activityAt > existing.activityAt) {
        dedupedByTmdb.set(key, seed);
      }
    }

    return Array.from(dedupedByTmdb.values())
      .sort((a, b) => {
        if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt;
        if (b.watchedCount !== a.watchedCount) return b.watchedCount - a.watchedCount;
        return a.title.localeCompare(b.title);
      })
      .slice(0, limit)
      .map(({ id, tmdbId, mediaType, title }) => ({
        id,
        tmdbId,
        mediaType,
        title,
      }));
  },
});

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
