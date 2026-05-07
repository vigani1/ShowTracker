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
  getAniListMediaById,
  getAniListMediaByMalId,
  type AniListAnimeRelations,
  type AniListRelatedShow,
} from "@/lib/api/anilist";
import { getJikanAnime } from "@/lib/api/jikan";
import { normalizeTmdbShowDetails } from "@/lib/api/normalize";
import { getTmdbShowDetails } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";

const RELATION_SYNC_THROTTLE_MS = 1000 * 60 * 60 * 6;
const REFRESH_THROTTLE_MS = 1000 * 60 * 60;
const AUDIT_PAGE_SIZE_DEFAULT = 5;
const AUDIT_PAGE_SIZE_MAX = 10;
const AUDIT_LIVE_LOOKUP_FRESH_MS = 1000 * 60 * 60 * 6;
const RELATION_SYNC_BATCH_LIMIT = 6;
const RELATION_SYNC_MAX_GRAPH_NODES = 30;
const IMPORT_TRACKED_SHOWS_MAX_ITEMS = 20;
const HOME_FEED_MAX_RESULTS = 40;
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
  titleLower: v.optional(v.string()),
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

const animeHomeRelationModeValidator = v.union(
  v.literal("core_only"),
  v.literal("all_relations")
);

const animeCompletionBehaviorValidator = v.union(
  v.literal("ask_every_time"),
  v.literal("auto_open_next"),
  v.literal("auto_pause_others_keep_next")
);
const homePausedSectionModeValidator = v.union(
  v.literal("auto_paused_only"),
  v.literal("all_paused")
);

type AnimeHomeRelationMode = "core_only" | "all_relations";
type AnimeCompletionBehavior =
  | "ask_every_time"
  | "auto_open_next"
  | "auto_pause_others_keep_next";
type HomePausedSectionMode = "auto_paused_only" | "all_paused";

const DEFAULT_ANIME_HOME_RELATION_MODE: AnimeHomeRelationMode = "core_only";
const DEFAULT_ANIME_COMPLETION_BEHAVIOR: AnimeCompletionBehavior = "ask_every_time";
const DEFAULT_HOME_PAUSED_SECTION_MODE: HomePausedSectionMode = "auto_paused_only";

function isAniListRateLimitError(error: unknown): error is { status: number } {
  return !!error && typeof error === "object" && "status" in error && error.status === 429;
}

function buildFeedProjectionFields(
  userShow: Doc<"userShows">,
  show: Doc<"shows">
) {
  const watchedCount = Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0));
  const totalEpisodes =
    typeof show.totalEpisodes === "number" ? show.totalEpisodes : undefined;
  const remainingEpisodes =
    typeof totalEpisodes === "number"
      ? Math.max(totalEpisodes - watchedCount, 0)
      : undefined;

  return {
    userId: userShow.userId,
    showId: userShow.showId,
    userShowId: userShow._id,

    title: show.title,
    mediaType: show.mediaType,
    posterUrl: show.posterUrl,
    backdropUrl: show.backdropUrl,
    tmdbId: show.tmdbId,
    anilistId: show.anilistId,
    malId: show.malId,
    tvmazeId: show.tvmazeId,
    imdbId: show.imdbId,
    firstAired: show.firstAired,
    anilistFormat: show.anilistFormat,
    animeSeason: show.animeSeason,
    animeSeasonYear: show.animeSeasonYear,
    totalEpisodes,

    status: userShow.status,
    isAutoTracked: userShow.isAutoTracked,
    relationRootAnilistId:
      userShow.relationRootAnilistId ?? show.rootAnilistId ?? show.anilistId,
    watchedEpisodesCount: watchedCount,
    remainingEpisodes,
    lastWatchedAt: userShow.lastWatchedAt ?? userShow.addedAt,

    updatedAt: Date.now(),
  };
}

async function upsertFeedProjectionForUserShow(
  ctx: MutationCtx,
  userShowId: Id<"userShows">
) {
  const userShow = await ctx.db.get(userShowId);
  if (!userShow) {
    return;
  }

  const show = await ctx.db.get(userShow.showId);
  if (!show) {
    return;
  }

  const existing = await ctx.db
    .query("feedProjections")
    .withIndex("by_userShow", (q) => q.eq("userShowId", userShowId))
    .unique();

  const fields = buildFeedProjectionFields(userShow, show);

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }

  await ctx.db.insert("feedProjections", fields);
}

async function deleteFeedProjectionForUserShow(
  ctx: MutationCtx,
  userShowId: Id<"userShows">
) {
  const existing = await ctx.db
    .query("feedProjections")
    .withIndex("by_userShow", (q) => q.eq("userShowId", userShowId))
    .unique();

  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

export const rebuildFeedProjectionsForUser = internalMutation({
  args: {
    userId: v.id("users"),
    phase: v.union(v.literal("delete"), v.literal("create")),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.max(1, Math.min(args.pageSize ?? 256, 512));

    if (args.phase === "delete") {
      const existing = await ctx.db
        .query("feedProjections")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(safePageSize);

      for (const row of existing) {
        await ctx.db.delete(row._id);
      }

      return {
        deleted: existing.length,
        created: 0,
        nextCursor: null,
        isDone: existing.length < safePageSize,
      };
    }

    const page = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate({
        numItems: safePageSize,
        cursor: args.cursor ?? null,
      });

    let created = 0;
    for (const userShow of page.page) {
      await upsertFeedProjectionForUserShow(ctx, userShow._id);
      created += 1;
    }

    return {
      deleted: 0,
      created,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const refreshProjectionsForShow = internalMutation({
  args: {
    showId: v.id("shows"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const show = await ctx.db.get(args.showId);
    if (!show) {
      return { updated: 0, nextCursor: null, isDone: true };
    }

    const BATCH_SIZE = 512;
    const page = await ctx.db
      .query("userShows")
      .withIndex("by_showId", (q) => q.eq("showId", args.showId))
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let updated = 0;
    for (const userShow of page.page) {
      const existing = await ctx.db
        .query("feedProjections")
        .withIndex("by_userShow", (q) => q.eq("userShowId", userShow._id))
        .unique();

      const fields = buildFeedProjectionFields(userShow, show);

      if (existing) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("feedProjections", fields);
      }
      updated += 1;
    }

    return {
      updated,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const runRefreshProjectionsForShow = internalAction({
  args: {
    showId: v.id("shows"),
  },
  handler: async (ctx, args) => {
    let cursor: string | undefined;
    let isDone = false;
    let totalUpdated = 0;
    let rounds = 0;

    while (!isDone) {
      const batch: {
        updated: number;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runMutation(internal.shows.refreshProjectionsForShow, {
        showId: args.showId,
        cursor,
      });

      totalUpdated += batch.updated;
      cursor = batch.nextCursor ?? undefined;
      isDone = batch.isDone;
      rounds += 1;
    }

    return { totalUpdated, rounds };
  },
});

const projectionSeasonMonthOffsetByName: Record<string, number> = {
  WINTER: 0,
  SPRING: 3,
  SUMMER: 6,
  FALL: 9,
};

const projectionMainlineFormats = new Set(["TV", "TV_SHORT"]);

const projectionFormatWeightByType: Record<string, number> = {
  TV: 0,
  TV_SHORT: 1,
  MOVIE: 2,
  ONA: 3,
  OVA: 4,
  SPECIAL: 5,
  MUSIC: 6,
};

type ProjectionFeedEntry = {
  title: string;
  firstAired: string | null;
  animeSeason: string | null;
  animeSeasonYear: number | null;
  anilistFormat: string | null;
  anilistId: number | null;
  malId: number | null;
};

function getProjectionChronologyValue(
  entry: Pick<ProjectionFeedEntry, "firstAired" | "animeSeason" | "animeSeasonYear">
) {
  const firstAired = entry.firstAired?.trim();
  if (firstAired) {
    const match = firstAired.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const asDate = Date.UTC(
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10) - 1,
        Number.parseInt(match[3], 10)
      );
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
    const monthOffset = projectionSeasonMonthOffsetByName[season] ?? 0;
    return Date.UTC(entry.animeSeasonYear, monthOffset, 1);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getProjectionFormatWeight(entry: Pick<ProjectionFeedEntry, "anilistFormat">) {
  const format = entry.anilistFormat?.toUpperCase();
  if (!format) {
    return 99;
  }
  return projectionFormatWeightByType[format] ?? 99;
}

function isProjectionMainlineAnime(entry: Pick<ProjectionFeedEntry, "anilistFormat">) {
  const format = entry.anilistFormat?.toUpperCase();
  if (!format) {
    return true;
  }
  return projectionMainlineFormats.has(format);
}

function sortProjectionAnimeCandidates(a: ProjectionFeedEntry, b: ProjectionFeedEntry) {
  const chronologyA = getProjectionChronologyValue(a);
  const chronologyB = getProjectionChronologyValue(b);
  if (chronologyA !== chronologyB) {
    return chronologyA - chronologyB;
  }

  const formatA = getProjectionFormatWeight(a);
  const formatB = getProjectionFormatWeight(b);
  if (formatA !== formatB) {
    return formatA - formatB;
  }

  if (a.title !== b.title) {
    return a.title.localeCompare(b.title);
  }

  const idA = a.anilistId ?? a.malId ?? Number.MAX_SAFE_INTEGER;
  const idB = b.anilistId ?? b.malId ?? Number.MAX_SAFE_INTEGER;
  return idA - idB;
}

type WatchlistEntryLike = {
  status: UserShowStatus;
  watchedEpisodes: number;
  remainingEpisodes: number | null;
  autoPausedAt?: number | null;
};

function isCompletedWatchlistEntry(
  entry: Pick<WatchlistEntryLike, "status" | "remainingEpisodes">
) {
  return (
    entry.status === "completed" ||
    (typeof entry.remainingEpisodes === "number" && entry.remainingEpisodes <= 0)
  );
}

function hasWatchlistProgress(entry: Pick<WatchlistEntryLike, "watchedEpisodes">) {
  return entry.watchedEpisodes > 0;
}

function shouldShowHomeFeedWatchlistEntry(
  entry: Pick<WatchlistEntryLike, "status" | "watchedEpisodes" | "remainingEpisodes">
) {
  return (
    isHomeFeedDisplayableEntry(entry) &&
    (hasWatchlistProgress(entry) || entry.status === "watching")
  );
}

function isHomeFeedPausedSectionEntry(
  entry: Pick<
    WatchlistEntryLike,
    "status" | "watchedEpisodes" | "remainingEpisodes" | "autoPausedAt"
  >,
  pausedSectionMode: HomePausedSectionMode
) {
  return (
    entry.status === "paused" &&
    typeof entry.remainingEpisodes === "number" &&
    entry.remainingEpisodes > 0 &&
    hasWatchlistProgress(entry) &&
    (pausedSectionMode === "all_paused" || typeof entry.autoPausedAt === "number")
  );
}

function isHomeFeedNotStartedSectionEntry(
  entry: Pick<WatchlistEntryLike, "status" | "watchedEpisodes" | "remainingEpisodes">
) {
  return (
    !isCompletedWatchlistEntry(entry) &&
    !hasWatchlistProgress(entry) &&
    entry.status !== "watching" &&
    entry.status !== "paused" &&
    entry.status !== "dropped"
  );
}

type AnimeFranchiseSelectionEntry = ProjectionFeedEntry &
  WatchlistEntryLike & {
    isAutoTracked: boolean;
    lastWatchedAt: number;
  };

type AnimeFranchiseProgressEntry = AnimeFranchiseSelectionEntry & {
  autoPausedAt: number | null;
  userShowId: Id<"userShows">;
};

function canAdvanceFromCompletedWatchlistEntry(
  entry: Pick<WatchlistEntryLike, "status" | "remainingEpisodes">
) {
  return !isCompletedWatchlistEntry(entry) && entry.status !== "dropped";
}

function selectAnimeFranchiseRepresentative<T extends AnimeFranchiseSelectionEntry>(
  entries: T[],
  options: {
    isMainlineEntry: (entry: T) => boolean;
    preferMainlineOnly: boolean;
    sortEntries: (a: T, b: T) => number;
  }
): { entry: T; lastActivityAt: number } | null {
  if (entries.length === 0) {
    return null;
  }

  const mainlineEntries = entries.filter((entry) => options.isMainlineEntry(entry));
  const timeline =
    options.preferMainlineOnly && mainlineEntries.length > 0 ? mainlineEntries : entries;
  const orderedTimeline = [...timeline].sort(options.sortEntries);

  if (orderedTimeline.length === 0) {
    return null;
  }

  let anchorIndex = -1;
  for (let index = orderedTimeline.length - 1; index >= 0; index -= 1) {
    const entry = orderedTimeline[index];
    if (hasWatchlistProgress(entry) || isCompletedWatchlistEntry(entry)) {
      anchorIndex = index;
      break;
    }
  }

  if (anchorIndex >= 0) {
    const anchor = orderedTimeline[anchorIndex];
    if (!isCompletedWatchlistEntry(anchor)) {
      return { entry: anchor, lastActivityAt: anchor.lastWatchedAt };
    }

    const nextEntry = orderedTimeline
      .slice(anchorIndex + 1)
      .find((entry) => canAdvanceFromCompletedWatchlistEntry(entry));

    if (nextEntry) {
      return { entry: nextEntry, lastActivityAt: anchor.lastWatchedAt };
    }
  }

  const manualCandidates = orderedTimeline.filter(
    (entry) => canAdvanceFromCompletedWatchlistEntry(entry) && !entry.isAutoTracked
  );
  if (manualCandidates.length > 0) {
    const [selectedEntry] = [...manualCandidates].sort((a, b) => {
      if (a.lastWatchedAt !== b.lastWatchedAt) {
        return b.lastWatchedAt - a.lastWatchedAt;
      }
      return options.sortEntries(a, b);
    });

    return { entry: selectedEntry, lastActivityAt: selectedEntry.lastWatchedAt };
  }

  const fallbackEntry = orderedTimeline.find((entry) =>
    canAdvanceFromCompletedWatchlistEntry(entry)
  );

  return fallbackEntry
    ? { entry: fallbackEntry, lastActivityAt: fallbackEntry.lastWatchedAt }
    : null;
}

function isHomeFeedDisplayableEntry(
  entry: Pick<WatchlistEntryLike, "status" | "remainingEpisodes">
) {
  return (
    entry.remainingEpisodes != null &&
    entry.status !== "paused" &&
    entry.status !== "dropped" &&
    !isCompletedWatchlistEntry(entry)
  );
}

function selectHomeAnimeFranchiseRepresentative<T extends AnimeFranchiseSelectionEntry>(
  entries: T[],
  options: {
    isMainlineEntry: (entry: T) => boolean;
    pausedSectionMode: HomePausedSectionMode;
    preferMainlineOnly: boolean;
    sortEntries: (a: T, b: T) => number;
  }
): { entry: T; lastActivityAt: number } | null {
  if (entries.length === 0) {
    return null;
  }

  const mainlineEntries = entries.filter((entry) => options.isMainlineEntry(entry));
  const timeline =
    options.preferMainlineOnly && mainlineEntries.length > 0 ? mainlineEntries : entries;
  const orderedTimeline = [...timeline].sort(options.sortEntries);

  if (orderedTimeline.length === 0) {
    return null;
  }

  const activeProgressEntries = orderedTimeline.filter(
    (entry) => isHomeFeedDisplayableEntry(entry) && hasWatchlistProgress(entry)
  );
  if (activeProgressEntries.length > 0) {
    const entry = activeProgressEntries[activeProgressEntries.length - 1];
    return { entry, lastActivityAt: entry.lastWatchedAt };
  }

  let completedAnchorIndex = -1;
  for (let index = orderedTimeline.length - 1; index >= 0; index -= 1) {
    if (isCompletedWatchlistEntry(orderedTimeline[index])) {
      completedAnchorIndex = index;
      break;
    }
  }

  if (completedAnchorIndex >= 0) {
    const completedAnchor = orderedTimeline[completedAnchorIndex];
    const nextEntry = orderedTimeline.slice(completedAnchorIndex + 1).find(
      (entry) => isHomeFeedDisplayableEntry(entry) && (entry.isAutoTracked || hasWatchlistProgress(entry))
    );

    if (nextEntry) {
      return { entry: nextEntry, lastActivityAt: completedAnchor.lastWatchedAt };
    }
  }

  const hasManualWatchlistDisplayable = orderedTimeline.some(
    (entry) => shouldShowHomeFeedWatchlistEntry(entry) && !entry.isAutoTracked
  );
  const autoTrackedDisplayable = hasManualWatchlistDisplayable
    ? undefined
    : orderedTimeline.find(
        (entry) => isHomeFeedDisplayableEntry(entry) && entry.isAutoTracked
      );
  if (autoTrackedDisplayable) {
    return {
      entry: autoTrackedDisplayable,
      lastActivityAt: autoTrackedDisplayable.lastWatchedAt,
    };
  }

  const displayableEntry = orderedTimeline.find((entry) =>
    shouldShowHomeFeedWatchlistEntry(entry)
  );
  if (displayableEntry) {
    return {
      entry: displayableEntry,
      lastActivityAt: displayableEntry.lastWatchedAt,
    };
  }

  const pausedSectionDisplayable = orderedTimeline
    .filter((entry) => isHomeFeedPausedSectionEntry(entry, options.pausedSectionMode))
    .sort((a, b) => {
      const autoPausedDelta =
        Number(typeof b.autoPausedAt === "number") - Number(typeof a.autoPausedAt === "number");
      if (autoPausedDelta !== 0) {
        return autoPausedDelta;
      }

      const pausedAtDelta = (b.autoPausedAt ?? 0) - (a.autoPausedAt ?? 0);
      if (pausedAtDelta !== 0) {
        return pausedAtDelta;
      }

      if (a.lastWatchedAt !== b.lastWatchedAt) {
        return b.lastWatchedAt - a.lastWatchedAt;
      }

      return options.sortEntries(a, b);
    })[0];
  if (pausedSectionDisplayable) {
    return {
      entry: pausedSectionDisplayable,
      lastActivityAt: pausedSectionDisplayable.lastWatchedAt,
    };
  }

  const notStartedDisplayable = orderedTimeline
    .filter((entry) => isHomeFeedNotStartedSectionEntry(entry))
    .sort((a, b) => {
      if (a.lastWatchedAt !== b.lastWatchedAt) {
        return b.lastWatchedAt - a.lastWatchedAt;
      }

      return options.sortEntries(a, b);
    })[0];
  if (notStartedDisplayable) {
    return {
      entry: notStartedDisplayable,
      lastActivityAt: notStartedDisplayable.lastWatchedAt,
    };
  }

  return null;
}

function findNextMainlineAnimeEntryToActivate<T extends AnimeFranchiseProgressEntry>(
  entries: T[],
  sortEntries: (a: T, b: T) => number,
  isMainlineEntry: (entry: T) => boolean
) {
  const orderedMainline = [...entries].filter(isMainlineEntry).sort(sortEntries);

  let completedAnchorIndex = -1;
  for (let index = orderedMainline.length - 1; index >= 0; index -= 1) {
    if (isCompletedWatchlistEntry(orderedMainline[index])) {
      completedAnchorIndex = index;
      break;
    }
  }

  if (completedAnchorIndex < 0) {
    return null;
  }

  return (
    orderedMainline
      .slice(completedAnchorIndex + 1)
      .find(
        (entry) =>
          !isCompletedWatchlistEntry(entry) &&
          entry.status !== "dropped" &&
          (entry.status !== "paused" || entry.autoPausedAt !== null)
      ) ??
    null
  );
}

function getExternalShowIdFromProjection(p: {
  mediaType: string;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  imdbId?: string;
}) {
  if (p.mediaType === "anime") {
    if (typeof p.anilistId === "number") {
      return `anilist:anime:${p.anilistId}`;
    }
    if (typeof p.malId === "number") {
      return `jikan:anime:${p.malId}`;
    }
  }
  if (typeof p.tmdbId === "number") {
    return `tmdb:${p.mediaType}:${p.tmdbId}`;
  }
  if (typeof p.tvmazeId === "number") {
    return `tvmaze:tv:${p.tvmazeId}`;
  }
  if (typeof p.imdbId === "string") {
    return `imdb:${p.mediaType}:${p.imdbId}`;
  }
  return null;
}

function getShowRouteId(show: {
  mediaType: "tv" | "anime" | "movie";
  tmdbId?: number | null;
  anilistId?: number | null;
  malId?: number | null;
  tvmazeId?: number | null;
}) {
  if (show.mediaType === "anime") {
    if (typeof show.anilistId === "number") {
      return `anilist:anime:${show.anilistId}`;
    }
    if (typeof show.malId === "number") {
      return `jikan:anime:${show.malId}`;
    }
  }

  if (typeof show.tmdbId === "number") {
    return `tmdb:${show.mediaType}:${show.tmdbId}`;
  }

  if (show.mediaType === "tv" && typeof show.tvmazeId === "number") {
    return `tvmaze:tv:${show.tvmazeId}`;
  }

  return null;
}

export const getHomeFeed = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const typedUserId = userId as Id<"users">;

    const [tvProjections, animeProjections, pausedUserShows, homeSettings, franchiseSettings] =
      await Promise.all([
        ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", typedUserId).eq("mediaType", "tv")
          )
          .collect(),
        ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", typedUserId).eq("mediaType", "anime")
          )
          .collect(),
        ctx.db
          .query("userShows")
          .withIndex("by_user_status", (q) =>
            q.eq("userId", typedUserId).eq("status", "paused")
          )
          .collect(),
        ctx.db
          .query("userAnimeHomeSettings")
          .withIndex("by_user", (q) => q.eq("userId", typedUserId))
          .unique(),
        ctx.db
          .query("userAnimeFranchiseSettings")
          .withIndex("by_user", (q) => q.eq("userId", typedUserId))
          .take(200),
      ]);

    const globalRelationMode =
      (homeSettings?.relationMode as AnimeHomeRelationMode | undefined) ??
      DEFAULT_ANIME_HOME_RELATION_MODE;
    const pausedSectionMode =
      (homeSettings?.pausedSectionMode as HomePausedSectionMode | undefined) ??
      DEFAULT_HOME_PAUSED_SECTION_MODE;
    const relationModeByRoot = new Map<number, AnimeHomeRelationMode>();
    for (const row of franchiseSettings) {
      relationModeByRoot.set(
        row.relationRootAnilistId,
        row.relationMode as AnimeHomeRelationMode
      );
    }
    const autoPausedAtByUserShowId = new Map<Id<"userShows">, number | null>();
    const pausedUserShowsForSection = pausedUserShows.filter(
      (userShow) =>
        pausedSectionMode === "all_paused" || typeof userShow.autoPausedAt === "number"
    );
    for (const userShow of pausedUserShowsForSection) {
      autoPausedAtByUserShowId.set(userShow._id, userShow.autoPausedAt ?? null);
    }

    const nonMovies = [...tvProjections, ...animeProjections];

    type HomeFeedProjectionItem = {
      id: string;
      title: string;
      mediaType: "tv" | "anime" | "movie";
      posterUrl: string | null;
      backdropUrl: string | null;
      overview: string | null;
      firstAired: string | null;
      tmdbId: number | null;
      anilistId: number | null;
      malId: number | null;
      tvmazeId: number | null;
      imdbId: string | null;
      status: UserShowStatus;
      isAutoTracked: boolean;
      trackingState: "not_started" | "in_progress" | "upcoming" | "tba";
      relationRootAnilistId: number | null;
      anilistFormat: string | null;
      animeSeason: string | null;
      animeSeasonYear: number | null;
      watchedEpisodes: number;
      totalEpisodes: number | null;
      remainingEpisodes: number | null;
      progressPercent: number | null;
      lastWatchedAt: number;
      autoPausedAt: number | null;
    };

    const hydrated: HomeFeedProjectionItem[] = [];
    for (const projection of nonMovies) {
      const externalId = getExternalShowIdFromProjection(projection);
      if (!externalId) {
        continue;
      }

      const watchedCount = projection.watchedEpisodesCount;
      const totalEpisodes = projection.totalEpisodes ?? null;
      const remainingEpisodes = projection.remainingEpisodes ?? null;

      const progressPercent =
        totalEpisodes && totalEpisodes > 0
          ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
          : null;

      const trackingState =
        totalEpisodes === null
          ? watchedCount > 0
            ? "in_progress"
            : "tba"
          : watchedCount === 0
            ? "not_started"
            : "in_progress";

      hydrated.push({
        id: externalId,
        title: projection.title,
        mediaType: projection.mediaType,
        posterUrl: projection.posterUrl ?? null,
        backdropUrl: projection.backdropUrl ?? null,
        overview: null,
        firstAired: projection.firstAired ?? null,
        tmdbId: projection.tmdbId ?? null,
        anilistId: projection.anilistId ?? null,
        malId: projection.malId ?? null,
        tvmazeId: projection.tvmazeId ?? null,
        imdbId: projection.imdbId ?? null,
        status: projection.status,
        isAutoTracked: projection.isAutoTracked ?? false,
        trackingState,
        relationRootAnilistId: projection.relationRootAnilistId ?? null,
        anilistFormat: projection.anilistFormat ?? null,
        animeSeason: projection.animeSeason ?? null,
        animeSeasonYear: projection.animeSeasonYear ?? null,
        watchedEpisodes: watchedCount,
        totalEpisodes,
        remainingEpisodes,
        progressPercent,
        lastWatchedAt: projection.lastWatchedAt,
        autoPausedAt: autoPausedAtByUserShowId.get(projection.userShowId) ?? null,
      });
    }

    const groupedAnime = new Map<string, HomeFeedProjectionItem[]>();
    const selectedEntries: HomeFeedProjectionItem[] = [];

    for (const item of hydrated) {
      if (item.mediaType !== "anime") {
        if (
          shouldShowHomeFeedWatchlistEntry(item) ||
          isHomeFeedPausedSectionEntry(item, pausedSectionMode) ||
          isHomeFeedNotStartedSectionEntry(item)
        ) {
          selectedEntries.push(item);
        }
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
      const relationRootAnilistId =
        typeof entries[0]?.relationRootAnilistId === "number"
          ? entries[0].relationRootAnilistId
          : null;
      const effectiveRelationMode =
        relationRootAnilistId !== null
          ? relationModeByRoot.get(relationRootAnilistId) ?? globalRelationMode
          : globalRelationMode;

      const selected = selectHomeAnimeFranchiseRepresentative(entries, {
        isMainlineEntry: isProjectionMainlineAnime,
        pausedSectionMode,
        preferMainlineOnly: effectiveRelationMode === "core_only",
        sortEntries: sortProjectionAnimeCandidates,
      });

      if (!selected) {
        continue;
      }

      selectedEntries.push({
        ...selected.entry,
        lastWatchedAt: selected.lastActivityAt,
      });
    }

    const selectedActiveEntries = selectedEntries
      .filter(
        (entry) =>
          !isHomeFeedPausedSectionEntry(entry, pausedSectionMode) &&
          !isHomeFeedNotStartedSectionEntry(entry)
      )
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
      .slice(0, HOME_FEED_MAX_RESULTS);
    const selectedPausedEntries = selectedEntries
      .filter((entry) => isHomeFeedPausedSectionEntry(entry, pausedSectionMode))
      .sort((a, b) => {
        const autoPausedDelta =
          Number(typeof b.autoPausedAt === "number") - Number(typeof a.autoPausedAt === "number");
        if (autoPausedDelta !== 0) {
          return autoPausedDelta;
        }

        const pausedAtDelta = (b.autoPausedAt ?? 0) - (a.autoPausedAt ?? 0);
        if (pausedAtDelta !== 0) {
          return pausedAtDelta;
        }

        return b.lastWatchedAt - a.lastWatchedAt;
      })
      .slice(0, HOME_FEED_MAX_RESULTS);
    const selectedNotStartedEntries = selectedEntries
      .filter((entry) => isHomeFeedNotStartedSectionEntry(entry))
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
      .slice(0, HOME_FEED_MAX_RESULTS);

    return [...selectedActiveEntries, ...selectedPausedEntries, ...selectedNotStartedEntries].map(
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

export const getDistinctTrackedUserIds = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.max(1, Math.min(args.pageSize ?? 512, 512));
    const page = await ctx.db.query("userShows").paginate({
      numItems: safePageSize,
      cursor: args.cursor ?? null,
    });

    const userIds = Array.from(
      new Set(page.page.map((row) => row.userId))
    );

    return {
      userIds,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const getUserShowsByUserIdForAudit = internalQuery({
  args: {
    userId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate(args.paginationOpts),
});

export const dailyReconcileProjections = internalAction({
  args: {},
  handler: async (ctx) => {
    let backfillCursor: string | undefined;
    let backfillIsDone = false;
    let backfillRounds = 0;

    while (!backfillIsDone) {
      const backfillResult: {
        patched: number;
        total: number;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runMutation(
        internal.shows.backfillUserShowsMediaType,
        { cursor: backfillCursor }
      );
      backfillRounds += 1;
      backfillCursor = backfillResult.nextCursor ?? undefined;
      backfillIsDone = backfillResult.isDone;
    }

    const trackedUserIds = new Set<Id<"users">>();
    let trackedCursor: string | undefined;
    let trackedIsDone = false;

    while (!trackedIsDone) {
      const trackedPage = await ctx.runQuery(
        internal.shows.getDistinctTrackedUserIds,
        {
          cursor: trackedCursor,
          pageSize: 512,
        }
      );

      for (const userId of trackedPage.userIds) {
        trackedUserIds.add(userId as Id<"users">);
      }

      trackedCursor = trackedPage.continueCursor ?? undefined;
      trackedIsDone = trackedPage.isDone;
    }

    let rebuilt = 0;
    for (const userId of trackedUserIds) {
      await ctx.runAction(internal.shows.rebuildUserShowTrackingAggregatesForUser, {
        userId,
      });

      let deleteDone = false;
      while (!deleteDone) {
        const deleteBatch: {
          deleted: number;
          created: number;
          nextCursor: string | null;
          isDone: boolean;
        } = await ctx.runMutation(internal.shows.rebuildFeedProjectionsForUser, {
          userId,
          phase: "delete",
          pageSize: 256,
        });

        deleteDone = deleteBatch.isDone;
      }

      let createCursor: string | undefined;
      let createDone = false;
      while (!createDone) {
        const createBatch: {
          deleted: number;
          created: number;
          nextCursor: string | null;
          isDone: boolean;
        } = await ctx.runMutation(internal.shows.rebuildFeedProjectionsForUser, {
          userId,
          phase: "create",
          cursor: createCursor,
          pageSize: 256,
        });

        createCursor = createBatch.nextCursor ?? undefined;
        createDone = createBatch.isDone;
      }

      rebuilt += 1;
    }

    return {
      usersRebuilt: rebuilt,
      backfillRounds,
    };
  },
});

async function getUserAnimeHomeSettingsFromDb(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const existing = await ctx.db
    .query("userAnimeHomeSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  return {
    relationMode:
      existing?.relationMode ?? DEFAULT_ANIME_HOME_RELATION_MODE,
    completionBehavior:
      existing?.completionBehavior ?? DEFAULT_ANIME_COMPLETION_BEHAVIOR,
    pausedSectionMode:
      (existing?.pausedSectionMode as HomePausedSectionMode | undefined) ??
      DEFAULT_HOME_PAUSED_SECTION_MODE,
  } as {
    relationMode: AnimeHomeRelationMode;
    completionBehavior: AnimeCompletionBehavior;
    pausedSectionMode: HomePausedSectionMode;
  };
}

async function getFranchiseRelationModeFromDb(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  relationRootAnilistId: number
) {
  const existing = await ctx.db
    .query("userAnimeFranchiseSettings")
    .withIndex("by_user_root", (q) =>
      q.eq("userId", userId).eq("relationRootAnilistId", relationRootAnilistId)
    )
    .unique();

  return (existing?.relationMode ?? null) as AnimeHomeRelationMode | null;
}

async function getEffectiveAnimeRelationModeFromDb(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  relationRootAnilistId: number
) {
  const [homeSettings, franchiseMode] = await Promise.all([
    getUserAnimeHomeSettingsFromDb(ctx, userId),
    getFranchiseRelationModeFromDb(ctx, userId, relationRootAnilistId),
  ]);

  return (franchiseMode ?? homeSettings.relationMode) as AnimeHomeRelationMode;
}

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
    titleLower: incoming.title.toLowerCase().trim(),
    tmdbId: incoming.tmdbId ?? existing?.tmdbId,
    tvdbId: incoming.tvdbId ?? existing?.tvdbId,
    anilistId: incoming.anilistId ?? existing?.anilistId,
    malId: incoming.malId ?? existing?.malId,
    tvmazeId: incoming.tvmazeId ?? existing?.tvmazeId,
    imdbId: incoming.imdbId ?? existing?.imdbId,
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
  titleLower?: string;
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

type ShowProgressMeta = Pick<
  ShowPayload,
  "mediaType" | "status" | "totalEpisodes" | "totalSeasons"
>;

type TrackedWatchedEpisodeLike = Pick<
  Doc<"watchedEpisodes">,
  "season" | "episode" | "watchedAt" | "runtime" | "watchCount" | "watchHistory"
>;

function getEpisodeLastWatchedAt(entry: TrackedWatchedEpisodeLike) {
  const watchHistory = entry.watchHistory ?? [];
  if (watchHistory.length > 0) {
    return watchHistory[watchHistory.length - 1];
  }
  return entry.watchedAt;
}

function isWatchedEpisodeWithinKnownShowBounds(
  show: ShowProgressMeta,
  entry: Pick<TrackedWatchedEpisodeLike, "season" | "episode">
) {
  if (show.mediaType === "movie" && entry.season === 0 && entry.episode === 0) {
    return true;
  }

  if (
    !Number.isFinite(entry.season) ||
    entry.season < 1 ||
    !Number.isFinite(entry.episode) ||
    entry.episode < 1
  ) {
    return false;
  }

  const totalSeasons = normalizePositiveEpisodeCount(show.totalSeasons);
  if (typeof totalSeasons === "number" && entry.season > totalSeasons) {
    return false;
  }

  const totalEpisodes = normalizePositiveEpisodeCount(show.totalEpisodes);
  const isSingleSeasonShow = show.mediaType === "anime" || totalSeasons === 1;
  if (
    isSingleSeasonShow &&
    typeof totalEpisodes === "number" &&
    entry.season === 1 &&
    entry.episode > totalEpisodes
  ) {
    return false;
  }

  return true;
}

function filterWatchedEpisodesWithinKnownShowBounds<T extends TrackedWatchedEpisodeLike>(
  watchedEpisodes: T[],
  show: ShowProgressMeta
) {
  return watchedEpisodes.filter((entry) =>
    isWatchedEpisodeWithinKnownShowBounds(show, entry)
  );
}

function shouldAutoCompleteShowFromProgress(
  show: ShowProgressMeta,
  watchedEpisodesCount: number
) {
  if (show.mediaType === "movie") {
    return watchedEpisodesCount > 0;
  }

  const totalEpisodes = normalizePositiveEpisodeCount(show.totalEpisodes);
  if (typeof totalEpisodes !== "number") {
    return false;
  }

  if (watchedEpisodesCount < totalEpisodes) {
    return false;
  }

  return isTerminalLifecycleStatus(show.status);
}

function getDerivedUserShowStatusFromProgress(
  currentStatus: UserShowStatus | null | undefined,
  show: ShowProgressMeta,
  watchedEpisodesCount: number
): UserShowStatus {
  if (shouldAutoCompleteShowFromProgress(show, watchedEpisodesCount)) {
    return "completed";
  }

  if (currentStatus === "dropped") {
    return "dropped";
  }

  return watchedEpisodesCount > 0 ? "watching" : "plan_to_watch";
}

function computeWatchedEpisodeAggregates(
  watchedEpisodes: TrackedWatchedEpisodeLike[],
  show?: ShowProgressMeta
): UserShowTrackingAggregates {
  let watchedTotalCount = 0;
  let watchedRuntimeMinutes = 0;
  let lastWatchedAt: number | undefined;
  const uniqueEpisodeKeys = new Set<string>();
  const relevantEpisodes = show
    ? filterWatchedEpisodesWithinKnownShowBounds(watchedEpisodes, show)
    : watchedEpisodes;

  for (const entry of relevantEpisodes) {
    uniqueEpisodeKeys.add(`${entry.season}:${entry.episode}`);

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
    watchedEpisodesCount: uniqueEpisodeKeys.size,
    watchedTotalCount,
    watchedRuntimeMinutes,
    lastWatchedAt,
  };
}

async function refreshUserShowTrackingAggregates(
  ctx: MutationCtx,
  userId: Id<"users">,
  showId: Id<"shows">,
  options: { deriveStatus?: boolean } = {}
) {
  const { deriveStatus = true } = options;
  const userShow = await ctx.db
    .query("userShows")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
    .unique();

  if (!userShow) {
    return null;
  }

  const show = await ctx.db.get(userShow.showId);
  if (!show) {
    return null;
  }

  const watchedEpisodes = await ctx.db
    .query("watchedEpisodes")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
    .collect();

  const aggregates = computeWatchedEpisodeAggregates(watchedEpisodes, show);
  const now = Date.now();
  const patch: Partial<Doc<"userShows">> = {
    watchedEpisodesCount: aggregates.watchedEpisodesCount,
    watchedTotalCount: aggregates.watchedTotalCount,
    watchedRuntimeMinutes: aggregates.watchedRuntimeMinutes,
    lastWatchedAt: aggregates.lastWatchedAt,
  };
  let nextStatus = userShow.status;

  if (deriveStatus) {
    nextStatus = getDerivedUserShowStatusFromProgress(
      userShow.status,
      {
        mediaType: show.mediaType,
        status: show.status,
        totalEpisodes: show.totalEpisodes,
        totalSeasons: show.totalSeasons,
      },
      aggregates.watchedEpisodesCount
    );
  }

  if (nextStatus !== userShow.status) {
    patch.status = nextStatus;
    patch.statusChangedAt = now;

    if (nextStatus === "completed") {
      patch.completedAt = now;
      patch.droppedAt = undefined;
      patch.autoPausedAt = undefined;
    } else {
      if (userShow.completedAt) {
        patch.completedAt = undefined;
      }
      if (userShow.droppedAt && nextStatus !== "dropped") {
        patch.droppedAt = undefined;
      }
      if (userShow.autoPausedAt && nextStatus !== "paused") {
        patch.autoPausedAt = undefined;
      }
    }
  }

  await ctx.db.patch(userShow._id, patch);

  // Keep feed projection in sync with the updated tracking aggregates.
  await upsertFeedProjectionForUserShow(ctx, userShow._id);

  return {
    ...aggregates,
    status: nextStatus,
  };
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

function hasConflictingLookupIdentity(
  candidate: Doc<"shows">,
  args: {
    tmdbId?: number;
    tvdbId?: number;
    anilistId?: number;
    malId?: number;
    tvmazeId?: number;
    imdbId?: string;
  }
) {
  if (
    typeof args.tmdbId === "number" &&
    typeof candidate.tmdbId === "number" &&
    candidate.tmdbId !== args.tmdbId
  ) {
    return true;
  }

  if (
    typeof args.tvdbId === "number" &&
    typeof candidate.tvdbId === "number" &&
    candidate.tvdbId !== args.tvdbId
  ) {
    return true;
  }

  if (
    typeof args.anilistId === "number" &&
    typeof candidate.anilistId === "number" &&
    candidate.anilistId !== args.anilistId
  ) {
    return true;
  }

  if (
    typeof args.malId === "number" &&
    typeof candidate.malId === "number" &&
    candidate.malId !== args.malId
  ) {
    return true;
  }

  if (
    typeof args.tvmazeId === "number" &&
    typeof candidate.tvmazeId === "number" &&
    candidate.tvmazeId !== args.tvmazeId
  ) {
    return true;
  }

  const requestedImdbId = args.imdbId?.trim().toLowerCase();
  const candidateImdbId = candidate.imdbId?.trim().toLowerCase();
  if (requestedImdbId && candidateImdbId && candidateImdbId !== requestedImdbId) {
    return true;
  }

  return false;
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

  // Same-title remakes/reboots must not overwrite an existing row that is already
  // tied to a different external ID.
  const compatibleTitleMatches = titleMatches.filter(
    (candidate) => !hasConflictingLookupIdentity(candidate, args)
  );

  if (compatibleTitleMatches.length === 0) {
    return null;
  }

  const requestedYear = extractLookupYear(args.firstAired);
  if (typeof requestedYear !== "number") {
    return pickBestLookupCandidate(compatibleTitleMatches, mediaType);
  }

  const yearMatches = compatibleTitleMatches.filter(
    (candidate) => extractLookupYear(candidate.firstAired) === requestedYear
  );

  if (yearMatches.length === 0) {
    return null;
  }

  return pickBestLookupCandidate(yearMatches, mediaType);
}

export const findShowByLookupForRefresh = internalQuery({
  args: showLookupInput,
  handler: async (ctx, args) => findShowByLookup(ctx, args),
});

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

async function fetchLatestNormalizedShowForExistingShow(show: Doc<"shows">) {
  if (show.mediaType === "anime") {
    if (typeof show.anilistId === "number") {
      try {
        return await getAniListMediaById(show.anilistId);
      } catch (error) {
        if (typeof show.malId !== "number" && typeof show.tmdbId !== "number") {
          throw error;
        }
      }
    }

    if (typeof show.malId === "number") {
      try {
        return await getJikanAnime(show.malId);
      } catch (error) {
        if (typeof show.tmdbId !== "number") {
          throw error;
        }
      }
    }
  }

  if (typeof show.tmdbId === "number") {
    const details = await getTmdbShowDetails(
      show.mediaType === "movie" ? "movie" : "tv",
      show.tmdbId
    );
    return normalizeTmdbShowDetails(
      show.mediaType === "movie" ? "movie" : "tv",
      details
    );
  }

  return null;
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

function shouldIncludeRelationType(
  relationType: string,
  includeAllRelations: boolean
) {
  if (includeAllRelations) {
    return true;
  }
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

async function buildAnimeRelationPayloads(
  rootAnilistId: number,
  includeAllRelations: boolean
) {
  const now = Date.now();
  const queue: number[] = [rootAnilistId];
  const visited = new Set<number>();
  const payloadByAnilistId = new Map<number, ShowPayload>();
  const relatedIdsByAnilistId = new Map<number, Set<number>>();
  let isPartial = false;

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
      isPartial = true;
      if (isAniListRateLimitError(error)) {
        console.warn("AniList relation graph rate limited; skipping relation expansion", {
          currentAnilistId,
        });
      } else {
        console.error("Failed to fetch AniList relation graph", {
          currentAnilistId,
          error,
        });
      }
      continue;
    }

    if (!graph?.root.anilistId) {
      continue;
    }

    const included = graph.relations.filter((entry) =>
      shouldIncludeRelationType(entry.relationType, includeAllRelations)
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
    isPartial,
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
  rootAnilistId: number,
  includeAllRelations = false
): Promise<AnimeRelationSyncResult> {
  const { shows, syncedAt, isPartial } = await buildAnimeRelationPayloads(
    rootAnilistId,
    includeAllRelations
  );
  if (shows.length === 0 || isPartial) {
    return {
      rootAnilistId,
      synced: false,
      discoveredShows: shows.length,
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

  await ctx.runMutation(internal.shows.ensureNextMainlineAnimeEntryActive, {
    userId,
    relationRootAnilistId: rootAnilistId,
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
        await upsertFeedProjectionForUserShow(ctx, existingUserShow._id);
        continue;
      }

      const newUserShowId = await ctx.db.insert("userShows", {
        userId: args.userId,
        showId,
        status: "plan_to_watch",
        mediaType: "anime" as const,
        watchedEpisodesCount: 0,
        watchedTotalCount: 0,
        watchedRuntimeMinutes: 0,
        isAutoTracked: !isRoot,
        relationRootAnilistId: args.rootAnilistId,
        ...(isRoot ? { lastRelationSyncAt: args.syncedAt } : {}),
        addedAt: now,
      });

      await upsertFeedProjectionForUserShow(ctx, newUserShowId);
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

export const ensureNextMainlineAnimeEntryActive = internalMutation({
  args: {
    userId: v.id("users"),
    relationRootAnilistId: v.number(),
  },
  handler: async (ctx, args) => {
    const settings = await getUserAnimeHomeSettingsFromDb(ctx, args.userId);
    if (settings.completionBehavior !== "auto_pause_others_keep_next") {
      return { activated: false, userShowId: null as Id<"userShows"> | null };
    }

    const relatedUserShows = await ctx.db
      .query("userShows")
      .withIndex("by_user_relation_root", (q) =>
        q.eq("userId", args.userId).eq("relationRootAnilistId", args.relationRootAnilistId)
      )
      .collect();

    const entries = (
      await Promise.all(
        relatedUserShows.map(async (userShow) => {
          const show = await ctx.db.get(userShow.showId);
          if (!show || show.mediaType !== "anime") {
            return null;
          }

          const watchedEpisodes = Math.max(
            0,
            Math.floor(userShow.watchedEpisodesCount ?? 0)
          );
          const totalEpisodes =
            typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
          const remainingEpisodes =
            totalEpisodes === null ? null : Math.max(totalEpisodes - watchedEpisodes, 0);

          return {
            userShowId: userShow._id,
            title: show.title,
            firstAired: show.firstAired ?? null,
            animeSeason: show.animeSeason ?? null,
            animeSeasonYear: show.animeSeasonYear ?? null,
            anilistFormat: show.anilistFormat ?? null,
            anilistId: show.anilistId ?? null,
            malId: show.malId ?? null,
            status: userShow.status,
            watchedEpisodes,
            remainingEpisodes,
            isAutoTracked: userShow.isAutoTracked ?? false,
            lastWatchedAt: userShow.lastWatchedAt ?? userShow.addedAt,
            autoPausedAt: userShow.autoPausedAt ?? null,
          };
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const nextEntry = findNextMainlineAnimeEntryToActivate(
      entries,
      sortProjectionAnimeCandidates,
      isProjectionMainlineAnime
    );

    if (!nextEntry) {
      return { activated: false, userShowId: null as Id<"userShows"> | null };
    }

    if (nextEntry.status !== "paused") {
      return { activated: false, userShowId: nextEntry.userShowId };
    }

    if (nextEntry.autoPausedAt === null) {
      return { activated: false, userShowId: nextEntry.userShowId };
    }

    const nextStatus: UserShowStatus = hasWatchlistProgress(nextEntry)
      ? "watching"
      : "plan_to_watch";

    await ctx.db.patch(nextEntry.userShowId, {
      status: nextStatus,
      statusChangedAt: Date.now(),
      droppedAt: undefined,
      completedAt: undefined,
      autoPausedAt: undefined,
    });
    await upsertFeedProjectionForUserShow(ctx, nextEntry.userShowId);

    return {
      activated: true,
      userShowId: nextEntry.userShowId,
      status: nextStatus,
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
      const effectiveRelationMode: AnimeHomeRelationMode = await ctx.runQuery(
        internal.shows.getEffectiveAnimeRelationModeForRootForUser,
        {
          userId,
          relationRootAnilistId: rootAnilistId,
        }
      );

      const syncResult = await syncAnimeRelationRoot(
        ctx,
        userId,
        rootAnilistId,
        effectiveRelationMode === "all_relations"
      );
      return {
        ...addResult,
        ...syncResult,
        rootAnilistId,
      };
    } catch (error) {
      console.error("Failed anime relation sync after watchlist add", {
        userId,
        rootAnilistId,
        error,
      });
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
    const syncSettings: {
      globalRelationMode: AnimeHomeRelationMode;
      franchiseModes: {
        relationRootAnilistId: number;
        relationMode: AnimeHomeRelationMode;
      }[];
    } = await ctx.runQuery(internal.shows.getAnimeRelationSyncSettingsForUser, {
      userId,
    });

    const relationModeByRoot = new Map<number, AnimeHomeRelationMode>();
    for (const row of syncSettings.franchiseModes) {
      relationModeByRoot.set(row.relationRootAnilistId, row.relationMode);
    }

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
      const relationMode =
        relationModeByRoot.get(candidate.rootAnilistId) ??
        syncSettings.globalRelationMode;
      const result = await syncAnimeRelationRoot(
        ctx,
        userId,
        candidate.rootAnilistId,
        relationMode === "all_relations"
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

export const getAnimeRelationSyncSettingsForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const homeSettings = await getUserAnimeHomeSettingsFromDb(ctx, args.userId);
    const franchiseRows = await ctx.db
      .query("userAnimeFranchiseSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return {
      globalRelationMode: homeSettings.relationMode,
      franchiseModes: franchiseRows.map((row) => ({
        relationRootAnilistId: row.relationRootAnilistId,
        relationMode: row.relationMode as AnimeHomeRelationMode,
      })),
    };
  },
});

export const getEffectiveAnimeRelationModeForRootForUser = internalQuery({
  args: {
    userId: v.id("users"),
    relationRootAnilistId: v.number(),
  },
  handler: async (ctx, args) => {
    return getEffectiveAnimeRelationModeFromDb(
      ctx,
      args.userId,
      args.relationRootAnilistId
    );
  },
});

export const getUserAnimeHomeSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    return getUserAnimeHomeSettingsFromDb(ctx, userId);
  },
});

export const setUserAnimeHomeSettings = mutation({
  args: {
    relationMode: v.optional(animeHomeRelationModeValidator),
    completionBehavior: v.optional(animeCompletionBehaviorValidator),
    pausedSectionMode: v.optional(homePausedSectionModeValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const existing = await ctx.db
      .query("userAnimeHomeSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const current = existing
      ? {
          relationMode: existing.relationMode as AnimeHomeRelationMode,
          completionBehavior: existing.completionBehavior as AnimeCompletionBehavior,
          pausedSectionMode:
            (existing.pausedSectionMode as HomePausedSectionMode | undefined) ??
            DEFAULT_HOME_PAUSED_SECTION_MODE,
        }
      : {
          relationMode: DEFAULT_ANIME_HOME_RELATION_MODE,
          completionBehavior: DEFAULT_ANIME_COMPLETION_BEHAVIOR,
          pausedSectionMode: DEFAULT_HOME_PAUSED_SECTION_MODE,
        };

    const next = {
      relationMode: args.relationMode ?? current.relationMode,
      completionBehavior: args.completionBehavior ?? current.completionBehavior,
      pausedSectionMode: args.pausedSectionMode ?? current.pausedSectionMode,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, next);
    } else {
      await ctx.db.insert("userAnimeHomeSettings", {
        userId,
        ...next,
      });
    }

    return {
      relationMode: next.relationMode,
      completionBehavior: next.completionBehavior,
      pausedSectionMode: next.pausedSectionMode,
    };
  },
});

export const getAnimeFranchiseHomeSettings = query({
  args: {
    relationRootAnilistId: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const homeSettings = await getUserAnimeHomeSettingsFromDb(ctx, userId);
    const franchiseRelationMode = await getFranchiseRelationModeFromDb(
      ctx,
      userId,
      args.relationRootAnilistId
    );

    return {
      globalRelationMode: homeSettings.relationMode,
      franchiseRelationMode,
      effectiveRelationMode:
        franchiseRelationMode ?? homeSettings.relationMode,
      completionBehavior: homeSettings.completionBehavior,
    };
  },
});

export const setAnimeFranchiseRelationMode = mutation({
  args: {
    relationRootAnilistId: v.number(),
    relationMode: v.union(v.literal("inherit"), animeHomeRelationModeValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const existing = await ctx.db
      .query("userAnimeFranchiseSettings")
      .withIndex("by_user_root", (q) =>
        q.eq("userId", userId).eq("relationRootAnilistId", args.relationRootAnilistId)
      )
      .unique();

    if (args.relationMode === "inherit") {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return { relationMode: null };
    }

    const payload = {
      relationMode: args.relationMode,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("userAnimeFranchiseSettings", {
        userId,
        relationRootAnilistId: args.relationRootAnilistId,
        ...payload,
      });
    }

    return { relationMode: args.relationMode };
  },
});

export const syncAnimeRelationsForRoot = action({
  args: {
    relationRootAnilistId: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    AnimeRelationSyncResult & { relationMode: AnimeHomeRelationMode }
  > => {
    const userId = await getCurrentUserId(ctx);
    const effectiveRelationMode: AnimeHomeRelationMode = await ctx.runQuery(
      internal.shows.getEffectiveAnimeRelationModeForRootForUser,
      {
        userId,
        relationRootAnilistId: args.relationRootAnilistId,
      }
    );

    const result = await syncAnimeRelationRoot(
      ctx,
      userId,
      args.relationRootAnilistId,
      effectiveRelationMode === "all_relations"
    );

    return {
      ...result,
      relationMode: effectiveRelationMode,
    };
  },
});

export const pruneUserAnimeFranchiseEntries = internalMutation({
  args: {
    userId: v.id("users"),
    relationRootAnilistId: v.number(),
    allowedAnilistIds: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const allowedAnilistIds = new Set(args.allowedAnilistIds);
    const relatedUserShows = await ctx.db
      .query("userShows")
      .withIndex("by_user_relation_root", (q) =>
        q.eq("userId", args.userId).eq("relationRootAnilistId", args.relationRootAnilistId)
      )
      .collect();

    let removedCount = 0;

    for (const userShow of relatedUserShows) {
      if (!userShow.isAutoTracked) {
        continue;
      }

      const watchedEpisodesCount = userShow.watchedEpisodesCount ?? 0;
      if (watchedEpisodesCount > 0) {
        continue;
      }

      if (userShow.status !== "plan_to_watch") {
        continue;
      }

      const show = await ctx.db.get(userShow.showId);
      const showAnilistId = show?.anilistId;
      if (typeof showAnilistId === "number" && allowedAnilistIds.has(showAnilistId)) {
        continue;
      }

      const watchedEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", args.userId).eq("showId", userShow.showId)
        )
        .collect();

      for (const entry of watchedEpisodes) {
        await ctx.db.delete(entry._id);
      }

      await deleteFeedProjectionForUserShow(ctx, userShow._id);
      await ctx.db.delete(userShow._id);
      removedCount += 1;
    }

    return {
      removedCount,
      scanned: relatedUserShows.length,
    };
  },
});

export const pruneAnimeFranchiseToCoreRelations = action({
  args: {
    relationRootAnilistId: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ removedCount: number; scanned: number }> => {
    const userId = await getCurrentUserId(ctx);
    const { shows } = await buildAnimeRelationPayloads(args.relationRootAnilistId, false);
    const allowedAnilistIds = shows
      .map((show) => show.anilistId)
      .filter((value): value is number => typeof value === "number");

    return ctx.runMutation(internal.shows.pruneUserAnimeFranchiseEntries, {
      userId,
      relationRootAnilistId: args.relationRootAnilistId,
      allowedAnilistIds,
    });
  },
});

export const upsertShow = mutation({
  args: showInput,
  handler: async (ctx, args) => {
    await getCurrentUserId(ctx);
    return ensureShow(ctx, args);
  },
});

export const getShowById = internalQuery({
  args: {
    showId: v.id("shows"),
  },
  handler: async (ctx, args) => ctx.db.get(args.showId),
});

export const upsertShowByInternalId = internalMutation({
  args: {
    showId: v.id("shows"),
    show: v.object(showInput),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.showId);
    if (!existing) {
      throw new Error("Show not found");
    }

    const payload = buildShowPatch(args.show, existing);
    await ctx.db.patch(args.showId, payload);
    return args.showId;
  },
});

async function refreshShowMetadataAndRepairTracking(
  ctx: ActionCtx,
  showId: Id<"shows">,
  options?: {
    repairUserId?: Id<"users">;
  }
): Promise<
  | {
      refreshed: false;
      repairedUsers: number;
      externalShowId: string | null;
      reason: "show_not_found" | "unsupported_show_source" | "not_tracked" | "throttled";
    }
  | {
      refreshed: true;
      repairedUsers: number;
      externalShowId: string | null;
      totalEpisodes: number | null;
      totalSeasons: number | null;
      status: string | null;
      reason: "ok";
    }
> {
  const show = await ctx.runQuery(internal.shows.getShowById, { showId });
  if (!show) {
    return {
      refreshed: false,
      repairedUsers: 0,
      externalShowId: null,
      reason: "show_not_found" as const,
    };
  }

  if (Date.now() - show.lastUpdated < REFRESH_THROTTLE_MS) {
    console.info("Skipping tracked show metadata refresh because show was updated recently", {
      showId,
      lastUpdated: show.lastUpdated,
    });

    return {
      refreshed: false,
      repairedUsers: 0,
      externalShowId: getShowRouteId(show),
      reason: "throttled" as const,
    };
  }

  const latest = await fetchLatestNormalizedShowForExistingShow(show);
  if (!latest) {
    return {
      refreshed: false,
      repairedUsers: 0,
      externalShowId: getShowRouteId(show),
      reason: "unsupported_show_source" as const,
    };
  }

  const userShows = await ctx.runQuery(internal.shows.findUserShowByShowId, {
    showId,
  });
  const targetUserShows =
    options?.repairUserId !== undefined
      ? userShows.filter((userShow) => userShow.userId === options.repairUserId)
      : userShows;

  if (targetUserShows.length === 0) {
    return {
      refreshed: false,
      repairedUsers: 0,
      externalShowId: getShowRouteId({
        mediaType: latest.mediaType,
        tmdbId: latest.tmdbId,
        anilistId: latest.anilistId,
        malId: latest.malId,
        tvmazeId: latest.tvmazeId,
      }),
      reason: "not_tracked" as const,
    };
  }

  const refreshedShowId = await ctx.runMutation(internal.shows.upsertShowByInternalId, {
    showId,
    show: buildShowPayloadFromNormalized(latest, {
      tvdbId: latest.tvdbId ?? show.tvdbId,
    }),
  });

  const repairedUsers = new Set<string>();
  if (options?.repairUserId !== undefined) {
    await ctx.runAction(internal.shows.rebuildUserShowTrackingAggregatesForUser, {
      userId: options.repairUserId,
    });
    repairedUsers.add(String(options.repairUserId));
  } else {
    for (const userShow of targetUserShows) {
      await ctx.runAction(internal.shows.rebuildUserShowTrackingAggregatesForUser, {
        userId: userShow.userId,
      });
      repairedUsers.add(String(userShow.userId));
    }

    await ctx.runAction(internal.shows.runRefreshProjectionsForShow, {
      showId: refreshedShowId,
    });
  }

  return {
    refreshed: true,
    repairedUsers: repairedUsers.size,
    externalShowId: getShowRouteId({
      mediaType: latest.mediaType,
      tmdbId: latest.tmdbId,
      anilistId: latest.anilistId,
      malId: latest.malId,
      tvmazeId: latest.tvmazeId,
    }),
    totalEpisodes: latest.totalEpisodes ?? null,
    totalSeasons: latest.totalSeasons ?? null,
    status: latest.status ?? null,
    reason: "ok" as const,
  };
}

export const refreshTrackedShowMetadata = action({
  args: showLookupInput,
  handler: async (ctx, args): ReturnType<typeof refreshShowMetadataAndRepairTracking> => {
    const userId = await getCurrentUserId(ctx);
    const show = await ctx.runQuery(internal.shows.findShowByLookupForRefresh, args);
    if (!show) {
      return {
        refreshed: false,
        repairedUsers: 0,
        externalShowId: null,
        reason: "show_not_found" as const,
      };
    }

    return refreshShowMetadataAndRepairTracking(ctx, show._id, {
      repairUserId: userId,
    });
  },
});

export const repairShowMetadataById = internalAction({
  args: {
    showId: v.id("shows"),
  },
  handler: async (ctx, args): ReturnType<typeof refreshShowMetadataAndRepairTracking> => {
    return refreshShowMetadataAndRepairTracking(ctx, args.showId);
  },
});

export const auditTrackedShowHealth = action({
  args: {
    continueCursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    scanned: number;
    continueCursor: string | null;
    isDone: boolean;
    issues: Array<{
      externalShowId: string | null;
      title: string;
      mediaType: "tv" | "anime" | "movie";
      status: UserShowStatus;
      watchedEpisodesCount: number;
      storedTotalEpisodes: number | null;
      liveTotalEpisodes: number | null;
      staleMetadata: boolean;
      shouldResumeFromAutoPause: boolean;
      homeVisibilityRisk: boolean;
      notes: string[];
    }>;
  }> => {
    const userId = await getCurrentUserId(ctx);
    const pageSize = Math.max(1, Math.min(args.pageSize ?? AUDIT_PAGE_SIZE_DEFAULT, AUDIT_PAGE_SIZE_MAX));
    const userShowsPage: {
      page: Array<Doc<"userShows">>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.shows.getUserShowsByUserIdForAudit, {
      userId,
      paginationOpts: {
        cursor: args.continueCursor ?? null,
        numItems: pageSize,
      },
    });

    const today = new Date();
    const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const endDateObj = new Date(today);
    endDateObj.setDate(endDateObj.getDate() + 365);
    const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-${String(endDateObj.getDate()).padStart(2, "0")}`;

    const futureCounts: Array<{ routeId: string; futureCount: number }> = await ctx.runQuery(
      api.schedule.getFutureUpcomingCountsForWatchlist,
      {
        startDate,
        endDate,
        mediaFilter: "tv",
      }
    );
    const futureCountByRoute = new Map(
      futureCounts.map((entry) => [entry.routeId, entry.futureCount] as const)
    );

    const results: Array<{
      externalShowId: string | null;
      title: string;
      mediaType: "tv" | "anime" | "movie";
      status: UserShowStatus;
      watchedEpisodesCount: number;
      storedTotalEpisodes: number | null;
      liveTotalEpisodes: number | null;
      staleMetadata: boolean;
      shouldResumeFromAutoPause: boolean;
      homeVisibilityRisk: boolean;
      notes: string[];
    }> = [];

    for (const userShow of userShowsPage.page) {
      const show: Doc<"shows"> | null = await ctx.runQuery(internal.shows.getShowById, {
        showId: userShow.showId,
      });
      if (!show) {
        continue;
      }

      let latest: NormalizedShow | null = null;
      const wasRecentlyUpdated = Date.now() - show.lastUpdated < AUDIT_LIVE_LOOKUP_FRESH_MS;
      if (wasRecentlyUpdated) {
        latest = null;
      } else {
        try {
          latest = await fetchLatestNormalizedShowForExistingShow(show);
        } catch (error) {
          results.push({
            externalShowId: getShowRouteId(show),
            title: show.title,
            mediaType: show.mediaType,
            status: userShow.status,
            watchedEpisodesCount: Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0)),
            storedTotalEpisodes:
              typeof show.totalEpisodes === "number" ? show.totalEpisodes : null,
            liveTotalEpisodes: null,
            staleMetadata: false,
            shouldResumeFromAutoPause: false,
            homeVisibilityRisk: false,
            notes: [
              "metadata refresh failed during audit",
              error instanceof Error ? error.message : "Unknown error",
            ],
          });
          continue;
        }
      }
      const watchedEpisodesCount = Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0));
      const storedTotalEpisodes = typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
      const liveTotalEpisodes = typeof latest?.totalEpisodes === "number" ? latest.totalEpisodes : null;
      const staleMetadata =
        liveTotalEpisodes !== null && storedTotalEpisodes !== liveTotalEpisodes;
      const shouldResumeFromAutoPause =
        userShow.status === "paused" &&
        typeof userShow.autoPausedAt === "number" &&
        liveTotalEpisodes !== null &&
        watchedEpisodesCount < liveTotalEpisodes;

      let homeVisibilityRisk = false;
      const notes: string[] = [];

      if (staleMetadata) {
        notes.push(`stored total ${storedTotalEpisodes ?? "unknown"} vs live ${liveTotalEpisodes}`);
      }

      if (wasRecentlyUpdated) {
        notes.push("skipped live provider lookup because metadata is still fresh");
      }

      if (shouldResumeFromAutoPause) {
        notes.push("auto-paused despite new episodes now existing");
      }

      if (show.mediaType === "tv" && typeof show.tmdbId === "number") {
        const routeId = `tmdb:tv:${show.tmdbId}`;
        const remainingEpisodes =
          storedTotalEpisodes === null ? null : Math.max(storedTotalEpisodes - watchedEpisodesCount, 0);
        const futureUpcomingCount = futureCountByRoute.get(routeId) ?? 0;
        const futureCountValue =
          typeof futureUpcomingCount === "number" ? futureUpcomingCount : 0;

        if (
          userShow.status === "watching" &&
          liveTotalEpisodes !== null &&
          watchedEpisodesCount < liveTotalEpisodes &&
          (remainingEpisodes === 0 ||
            (typeof remainingEpisodes === "number" &&
              futureCountValue >= Math.max(remainingEpisodes, 1)))
        ) {
          homeVisibilityRisk = true;
          notes.push("TV home feed may hide this due to stale totals or future-count filter");
        }
      }

      if (staleMetadata || shouldResumeFromAutoPause || homeVisibilityRisk) {
        results.push({
          externalShowId: getShowRouteId(show),
          title: show.title,
          mediaType: show.mediaType,
          status: userShow.status,
          watchedEpisodesCount,
          storedTotalEpisodes,
          liveTotalEpisodes,
          staleMetadata,
          shouldResumeFromAutoPause,
          homeVisibilityRisk,
          notes,
        });
      }
    }

    return {
      scanned: userShowsPage.page.length,
      continueCursor: userShowsPage.isDone ? null : userShowsPage.continueCursor,
      isDone: userShowsPage.isDone,
      issues: results,
    };
  },
});

export const findShowByTitle = internalQuery({
  args: {
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const normalizedSearch = args.title.toLowerCase().trim();
    if (!normalizedSearch) {
      return null;
    }

    const matches = await ctx.db
      .query("shows")
      .withIndex("by_title", (q) => q.eq("titleLower", normalizedSearch))
      .collect();

    return pickBestLookupCandidate(matches);
  },
});

export const deleteShowAndUserData = internalMutation({
  args: {
    showId: v.id("shows"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, reason: "unauthenticated" };
    }

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("showId", args.showId)
      )
      .unique();

    if (!userShow) {
      return { success: false, reason: "userShow not found" };
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("showId", args.showId)
      )
      .collect();

    const feedProjections = await ctx.db
      .query("feedProjections")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("showId", args.showId)
      )
      .collect();

    for (const entry of watchedEpisodes) {
      await ctx.db.delete(entry._id);
    }

    for (const entry of feedProjections) {
      await ctx.db.delete(entry._id);
    }

    await ctx.db.delete(userShow._id);

    return {
      success: true,
      watchedEpisodesDeleted: watchedEpisodes.length,
      feedProjectionsDeleted: feedProjections.length,
    };
  },
});

export const findUserShowByShowId = internalQuery({
  args: {
    showId: v.id("shows"),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("userShows")
      .withIndex("by_showId", (q) => q.eq("showId", args.showId))
      .collect(),
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
        watchedEpisodes: 0,
        isFavorite: false,
        relationRootAnilistId: null,
      };
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return {
        showId: null,
        inWatchlist: false,
        status: null,
        watchedEpisodes: 0,
        isFavorite: false,
        relationRootAnilistId: null,
      };
    }

    const userShow = await ctx.db
      .query("userShows")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .unique();

    const favoriteEntry = await ctx.db
      .query("userFavorites")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .unique();

    let watchedEpisodesCount = userShow?.watchedEpisodesCount;
    const shouldRecomputeWatchedEpisodesCount =
      userShow !== null &&
      (watchedEpisodesCount == null ||
        (typeof watchedEpisodesCount === "number" &&
          typeof show.totalEpisodes === "number" &&
          watchedEpisodesCount > show.totalEpisodes));

    if (shouldRecomputeWatchedEpisodesCount && userShow) {
      const watchedEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
        .take(5000);

      watchedEpisodesCount = computeWatchedEpisodeAggregates(
        watchedEpisodes,
        show
      ).watchedEpisodesCount;
    }

    const resolvedWatchedEpisodesCount = Math.max(
      0,
      Math.floor(watchedEpisodesCount ?? 0)
    );

    // Return just the count, not all episode keys (to avoid 1MB limit)
    // Episode keys will be loaded per-season via getWatchedEpisodesForSeason
    return {
      showId: getExternalShowId(show),
      inWatchlist: userShow !== null,
      status: userShow?.status ?? null,
      watchedEpisodes: resolvedWatchedEpisodesCount,
      isFavorite: favoriteEntry !== null,
      relationRootAnilistId:
        userShow?.relationRootAnilistId ?? show.rootAnilistId ?? show.anilistId ?? null,
    };
  },
});

export const getWatchedEpisodesForSeason = query({
  args: {
    ...showLookupInput,
    season: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args)) {
      return [] as string[];
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return [] as string[];
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show_season_episode", (q) =>
        q.eq("userId", userId).eq("showId", show._id).eq("season", args.season)
      )
      .collect();

    return watchedEpisodes.map((entry) => `${entry.season}:${entry.episode}`);
  },
});

export const getWatchedSeasonProgress = query({
  args: showLookupInput,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args)) {
      return [] as { season: number; watchedEpisodes: number }[];
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return [] as { season: number; watchedEpisodes: number }[];
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .take(5000);

    const watchedBySeason = new Map<number, Set<number>>();
    for (const entry of filterWatchedEpisodesWithinKnownShowBounds(watchedEpisodes, show)) {
      const episodesForSeason = watchedBySeason.get(entry.season) ?? new Set<number>();
      episodesForSeason.add(entry.episode);
      watchedBySeason.set(entry.season, episodesForSeason);
    }

    return Array.from(watchedBySeason.entries())
      .map(([season, episodeSet]) => ({
        season,
        watchedEpisodes: episodeSet.size,
      }))
      .sort((a, b) => a.season - b.season);
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

        const totalEpisodes =
          typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
        const watchedCountRaw = Math.max(
          0,
          Math.floor(userShow.watchedEpisodesCount ?? 0)
        );
        const watchedCount =
          typeof totalEpisodes === "number"
            ? Math.min(watchedCountRaw, totalEpisodes)
            : watchedCountRaw;
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
  args: {
    status: v.optional(userShowStatusValidator),
    mediaType: v.optional(
      v.union(v.literal("tv"), v.literal("anime"), v.literal("movie"))
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const userShows =
      args.status && args.mediaType
        ? await ctx.db
            .query("userShows")
            .withIndex("by_user_status_mediaType", (q) =>
              q
                .eq("userId", userId)
                .eq("status", args.status!)
                .eq("mediaType", args.mediaType!)
            )
            .collect()
        : args.status
          ? await ctx.db
              .query("userShows")
              .withIndex("by_user_status", (q) =>
                q.eq("userId", userId).eq("status", args.status!)
              )
              .collect()
          : args.mediaType
            ? await ctx.db
                .query("userShows")
                .withIndex("by_user_mediaType", (q) =>
                  q.eq("userId", userId).eq("mediaType", args.mediaType!)
                )
                .collect()
            : await ctx.db
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
          isAutoTracked: userShow.isAutoTracked ?? false,
          posterUrl: show.posterUrl ?? null,
          backdropUrl: show.backdropUrl ?? null,
          overview: show.overview ?? null,
          firstAired: show.firstAired ?? null,
          tmdbId: show.tmdbId ?? null,
          anilistId: show.anilistId ?? null,
          malId: show.malId ?? null,
          relationRootAnilistId:
            userShow.relationRootAnilistId ?? show.rootAnilistId ?? show.anilistId ?? null,
          anilistFormat: show.anilistFormat ?? null,
          animeSeason: show.animeSeason ?? null,
          animeSeasonYear: show.animeSeasonYear ?? null,
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

/**
 * Returns counts of tracked shows grouped by status and media type.
 * Used by the Library screen to render status filter chip badges
 * without needing to hydrate full show documents.
 *
 * When userShows.mediaType is denormalized (after backfill), this avoids
 * reading any show documents at all. For un-migrated rows it falls back to
 * a batch show lookup.
 */
export const getLibraryCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {} as Record<string, Record<string, number>>;
    }
    const typedUserId = userId as Id<"users">;

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", typedUserId))
      .collect();

    // Collect show IDs that still need a show-doc lookup (no denormalized mediaType).
    const missingMediaTypeIds: Id<"shows">[] = [];
    for (const us of userShows) {
      if (!us.mediaType) {
        missingMediaTypeIds.push(us.showId);
      }
    }

    const mediaTypeByShowId = new Map<string, string>();
    if (missingMediaTypeIds.length > 0) {
      const uniqueIds = [...new Set(missingMediaTypeIds)];
      const showDocs = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));
      for (let i = 0; i < uniqueIds.length; i++) {
        const doc = showDocs[i];
        if (doc) {
          mediaTypeByShowId.set(uniqueIds[i].toString(), doc.mediaType);
        }
      }
    }

    const counts: Record<string, Record<string, number>> = {};
    // counts[mediaType][status] = number

    for (const us of userShows) {
      const mt = us.mediaType ?? mediaTypeByShowId.get(us.showId.toString());
      if (!mt) continue;
      if (!counts[mt]) counts[mt] = {};
      counts[mt][us.status] = (counts[mt][us.status] ?? 0) + 1;
    }

    return counts;
  },
});

/**
 * Backfill mediaType on existing userShows rows that predate the
 * denormalization. Run once after deploying the schema change.
 */
export const backfillUserShowsMediaType = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.limit ?? 500, 500));
    const rows = await ctx.db.query("userShows").paginate({
      numItems: pageSize,
      cursor: args.cursor ?? null,
    });

    let patched = 0;
    for (const row of rows.page) {
      if (row.mediaType) continue;
      const show = await ctx.db.get(row.showId);
      if (!show) continue;
      await ctx.db.patch(row._id, { mediaType: show.mediaType });
      patched++;
    }

    return {
      patched,
      total: rows.page.length,
      nextCursor: rows.continueCursor,
      isDone: rows.isDone,
    };
  },
});

/**
 * Lightweight query returning only the external IDs and tracking state needed
 * by Discover and Recommendations screens to build tracked-status maps.
 */
export const getTrackedIds = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const typedUserId = userId as Id<"users">;

    const safeLimit = Math.max(1, Math.min(args.limit ?? 1000, 2000));
    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", typedUserId))
      .take(safeLimit);

    type TrackedProjection = {
      mediaType: "tv" | "movie" | "anime";
      tmdbId: number | null;
      anilistId: number | null;
      status: UserShowStatus;
      watchedEpisodesCount: number;
      totalEpisodes: number | null;
      updatedAt: number;
    };

    const isWatchedProjection = (projection: TrackedProjection) => {
      if (projection.status === "completed") return true;
      if (projection.watchedEpisodesCount <= 0) return false;
      return (
        projection.totalEpisodes === null ||
        projection.watchedEpisodesCount >= projection.totalEpisodes
      );
    };

    const shouldPreferProjection = (
      next: TrackedProjection,
      current: TrackedProjection
    ) => {
      const nextWatched = isWatchedProjection(next);
      const currentWatched = isWatchedProjection(current);
      if (nextWatched !== currentWatched) return nextWatched;
      if (next.watchedEpisodesCount !== current.watchedEpisodesCount) {
        return next.watchedEpisodesCount > current.watchedEpisodesCount;
      }
      return next.updatedAt > current.updatedAt;
    };

    const deduped = new Map<string, TrackedProjection>();

    for (const userShow of userShows) {
      const show = await ctx.db.get(userShow.showId);
      if (!show) continue;

      const mediaType = show.mediaType;
      const key =
        mediaType === "anime"
          ? `anime:${show.anilistId ?? show.malId ?? show._id}`
          : `${mediaType}:${show.tmdbId ?? show._id}`;

      const candidate = {
        mediaType,
        tmdbId: show.tmdbId ?? null,
        anilistId: show.anilistId ?? null,
        status: userShow.status,
        watchedEpisodesCount: Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0)),
        totalEpisodes: show.totalEpisodes ?? null,
        updatedAt: userShow.lastWatchedAt ?? userShow.statusChangedAt ?? userShow.addedAt,
      };
      const existing = deduped.get(key);

      if (!existing || shouldPreferProjection(candidate, existing)) {
        deduped.set(key, candidate);
      }
    }

    return Array.from(deduped.values()).map(({ updatedAt: _updatedAt, ...item }) => item);
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
        await upsertFeedProjectionForUserShow(ctx, existing._id);
      }
      return { status: existing.status };
    }

    const userShowId = await ctx.db.insert("userShows", {
      userId,
      showId,
      status: "plan_to_watch",
      mediaType: args.mediaType,
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

    await upsertFeedProjectionForUserShow(ctx, userShowId);

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

    // Delete feed projection before deleting the userShow.
    await deleteFeedProjectionForUserShow(ctx, userShow._id);
    await ctx.db.delete(userShow._id);

    return {
      removed: true,
      watchedEpisodesRemoved: watchedEpisodes.length,
    };
  },
});

export const setFavoriteStatus = mutation({
  args: {
    show: v.object(showInput),
    isFavorite: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const showId = await ensureShowRecordId(ctx, args.show);

    const existingFavorite = await ctx.db
      .query("userFavorites")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", showId))
      .unique();

    if (args.isFavorite) {
      if (!existingFavorite) {
        await ctx.db.insert("userFavorites", {
          userId,
          showId,
          mediaType: args.show.mediaType,
          addedAt: Date.now(),
        });
      }

      return { isFavorite: true };
    }

    if (existingFavorite) {
      await ctx.db.delete(existingFavorite._id);
    }

    return { isFavorite: false };
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
        mediaType: args.show.mediaType,
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

      const newUserShowId = await ctx.db.insert("userShows", insertData);
      await upsertFeedProjectionForUserShow(ctx, newUserShowId);

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

    // Update feed projection with the new status.
    await upsertFeedProjectionForUserShow(ctx, existing._id);

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
          mediaType: item.show.mediaType,
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

      const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId, {
        deriveStatus: false,
      });

      const watchedEpisodesCount = Math.max(
        0,
        Math.floor(refreshed?.watchedEpisodesCount ?? item.watchedEpisodes.length)
      );
      const normalizedImportStatus = getImportedStatusFromProgress(
        item.status,
        item.show,
        watchedEpisodesCount
      );

      if (normalizedImportStatus !== item.status || normalizedImportStatus === "paused") {
        const importStatusPatch: Partial<Doc<"userShows">> = {
          completedAt: normalizedImportStatus === "completed" ? now : undefined,
          droppedAt: normalizedImportStatus === "dropped" ? now : undefined,
          autoPausedAt: undefined,
        };

        if (normalizedImportStatus !== item.status) {
          importStatusPatch.status = normalizedImportStatus;
          importStatusPatch.statusChangedAt = now;
        }

        await ctx.db.patch(userShowId, importStatusPatch);
        await upsertFeedProjectionForUserShow(ctx, userShowId);
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
        mediaType: args.show.mediaType,
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

        // If status was "completed", always change to "watching" when unwatching
        // This handles cases where episode counts might be inaccurate due to data issues
        if (userShow && userShow.status === "completed") {
          await ctx.db.patch(userShow._id, {
            status: "watching",
            statusChangedAt: Date.now(),
            completedAt: undefined,
          });
        }

        const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

        return {
          watched: false,
          watchedEpisodes: refreshed?.watchedEpisodesCount ?? 0,
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

    const totalWatched = computeWatchedEpisodeAggregates(
      [
        ...watchedEpisodes,
        {
          season: args.season,
          episode: args.episode,
          watchedAt: now,
          runtime: args.runtime ?? args.show.episodeRuntime,
          watchCount: 1,
          watchHistory: [now],
        },
      ],
      args.show
    ).watchedEpisodesCount;
    const nextStatus = getDerivedUserShowStatusFromProgress(
      userShow?.status,
      args.show,
      totalWatched
    );
    const statusChanged = userShow?.status !== nextStatus;

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
        mediaType: args.show.mediaType,
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

    const insertedEpisodesForAggregate = uniqueEpisodes.map((entry) => ({
      season: entry.season,
      episode: entry.episode,
      watchedAt: now,
      runtime: entry.runtime ?? args.show.episodeRuntime,
      watchCount: 1,
      watchHistory: [now],
    }));
    const totalWatched = computeWatchedEpisodeAggregates(
      [...watchedEpisodes, ...insertedEpisodesForAggregate],
      args.show
    ).watchedEpisodesCount;
    const nextStatus = getDerivedUserShowStatusFromProgress(
      userShow?.status,
      args.show,
      totalWatched
    );

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

export const batchMarkEpisodesWatched = mutation({
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
        mediaType: args.show.mediaType,
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

    const existingKeys = new Set(
      watchedEpisodes.map((entry) => `${entry.season}:${entry.episode}`)
    );

    const uniqueEpisodes = Array.from(
      new Map(args.episodes.map((entry) => [`${entry.season}:${entry.episode}`, entry])).values()
    );

    let addedCount = 0;
    for (const entry of uniqueEpisodes) {
      const key = `${entry.season}:${entry.episode}`;
      if (existingKeys.has(key)) {
        continue;
      }

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
      addedCount += 1;
    }

    if (addedCount === 0) {
      const currentWatchedEpisodes =
        typeof userShow?.watchedEpisodesCount === "number"
          ? userShow.watchedEpisodesCount
          : computeWatchedEpisodeAggregates(watchedEpisodes, args.show).watchedEpisodesCount;

      return {
        processedCount: uniqueEpisodes.length,
        addedCount,
        watchedEpisodes: currentWatchedEpisodes,
        status:
          userShow?.status ??
          getDerivedUserShowStatusFromProgress(null, args.show, currentWatchedEpisodes),
      };
    }

    const addedEpisodesForAggregate = uniqueEpisodes
      .filter((entry) => !existingKeys.has(`${entry.season}:${entry.episode}`))
      .map((entry) => ({
        season: entry.season,
        episode: entry.episode,
        watchedAt: now,
        runtime: entry.runtime ?? args.show.episodeRuntime,
        watchCount: 1,
        watchHistory: [now],
      }));
    const totalWatched = computeWatchedEpisodeAggregates(
      [...watchedEpisodes, ...addedEpisodesForAggregate],
      args.show
    ).watchedEpisodesCount;
    const nextStatus = getDerivedUserShowStatusFromProgress(
      userShow?.status,
      args.show,
      totalWatched
    );

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
      addedCount,
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
        mediaType: args.show.mediaType,
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

    const addedSeasonEpisodesForAggregate = uniqueEpisodes
      .filter((entry) => !existingSeasonEpisodes.has(entry.episode))
      .map((entry) => ({
        season: args.season,
        episode: entry.episode,
        watchedAt: now,
        runtime: entry.runtime ?? args.show.episodeRuntime,
        watchCount: 1,
        watchHistory: [now],
      }));
    const totalWatched = computeWatchedEpisodeAggregates(
      [...watchedEpisodes, ...addedSeasonEpisodesForAggregate],
      args.show
    ).watchedEpisodesCount;
    const nextStatus = getDerivedUserShowStatusFromProgress(
      userShow?.status,
      args.show,
      totalWatched
    );

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

    // If status was "completed", always change to "watching" when unwatching any episodes
    if (userShow && removedCount > 0 && userShow.status === "completed") {
      await ctx.db.patch(userShow._id, {
        status: "watching",
        statusChangedAt: Date.now(),
        completedAt: undefined,
      });
    }

    const refreshed = await refreshUserShowTrackingAggregates(ctx, userId, showId);

    return {
      removedCount,
      watchedEpisodes: refreshed?.watchedEpisodesCount ?? 0,
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

export const clearRelatedAnimeWatched = mutation({
  args: {
    show: v.object(showLookupInput),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args.show)) {
      return { removedCount: 0, showsCleared: 0 };
    }

    const sourceShow = await findShowByLookup(ctx, args.show);
    if (!sourceShow || sourceShow.mediaType !== "anime") {
      return { removedCount: 0, showsCleared: 0 };
    }

    const relationRootAnilistId = sourceShow.rootAnilistId ?? sourceShow.anilistId;
    if (typeof relationRootAnilistId !== "number") {
      return { removedCount: 0, showsCleared: 0 };
    }

    const relatedUserShows = await ctx.db
      .query("userShows")
      .withIndex("by_user_relation_root", (q) =>
        q.eq("userId", userId).eq("relationRootAnilistId", relationRootAnilistId)
      )
      .take(RELATION_SYNC_MAX_GRAPH_NODES);

    let removedCount = 0;
    let showsCleared = 0;
    const now = Date.now();
    const WATCHED_EPISODE_DELETE_BATCH_SIZE = 256;
    const MAX_TOTAL_DELETES = 2000;

    for (const userShow of relatedUserShows) {
      if (removedCount >= MAX_TOTAL_DELETES) {
        break;
      }

      let removedForShow = 0;
      while (removedCount + removedForShow < MAX_TOTAL_DELETES) {
        const watchedEpisodes = await ctx.db
          .query("watchedEpisodes")
          .withIndex("by_user_show", (q) =>
            q.eq("userId", userId).eq("showId", userShow.showId)
          )
          .take(WATCHED_EPISODE_DELETE_BATCH_SIZE);

        if (watchedEpisodes.length === 0) {
          break;
        }

        const deleteBudget = MAX_TOTAL_DELETES - removedCount - removedForShow;
        const toDelete = watchedEpisodes.slice(0, Math.min(deleteBudget, watchedEpisodes.length));

        for (const entry of toDelete) {
          await ctx.db.delete(entry._id);
        }

        removedForShow += toDelete.length;

        if (toDelete.length < watchedEpisodes.length) {
          break;
        }
      }

      const remainingEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", userId).eq("showId", userShow.showId)
        )
        .first();

      if (!remainingEpisodes) {
        if (userShow.status === "watching" || userShow.status === "completed") {
          await ctx.db.patch(userShow._id, {
            status: "plan_to_watch",
            statusChangedAt: now,
            completedAt: undefined,
            autoPausedAt: undefined,
          });
        }

        await refreshUserShowTrackingAggregates(ctx, userId, userShow.showId);
        showsCleared += 1;
      }

      removedCount += removedForShow;
    }

    return { removedCount, showsCleared, hitCap: removedCount >= MAX_TOTAL_DELETES };
  },
});

export const pauseOtherRelatedAnimeEntries = mutation({
  args: {
    show: v.object(showLookupInput),
    keepNext: v.optional(v.object(showLookupInput)),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!hasLookupArgs(args.show)) {
      return { pausedCount: 0, relatedCount: 0 };
    }

    const sourceShow = await findShowByLookup(ctx, args.show);
    if (!sourceShow || sourceShow.mediaType !== "anime") {
      return { pausedCount: 0, relatedCount: 0 };
    }

    const relationRootAnilistId = sourceShow.rootAnilistId ?? sourceShow.anilistId;
    if (typeof relationRootAnilistId !== "number") {
      return { pausedCount: 0, relatedCount: 0 };
    }

    let keepShowId: Id<"shows"> | null = null;
    if (args.keepNext && hasLookupArgs(args.keepNext)) {
      const keepShow = await findShowByLookup(ctx, args.keepNext);
      if (keepShow && keepShow.mediaType === "anime") {
        keepShowId = keepShow._id;
      }
    }

    const relatedUserShows = await ctx.db
      .query("userShows")
      .withIndex("by_user_relation_root", (q) =>
        q.eq("userId", userId).eq("relationRootAnilistId", relationRootAnilistId)
      )
      .collect();

    const relatedEntries = (
      await Promise.all(
        relatedUserShows.map(async (userShow) => {
          const show = await ctx.db.get(userShow.showId);
          if (!show || show.mediaType !== "anime") {
            return null;
          }

          const watchedEpisodes = Math.max(
            0,
            Math.floor(userShow.watchedEpisodesCount ?? 0)
          );
          const totalEpisodes =
            typeof show.totalEpisodes === "number" ? show.totalEpisodes : null;
          const remainingEpisodes =
            totalEpisodes === null ? null : Math.max(totalEpisodes - watchedEpisodes, 0);

          return {
            userShowId: userShow._id,
            showId: userShow.showId,
            title: show.title,
            firstAired: show.firstAired ?? null,
            animeSeason: show.animeSeason ?? null,
            animeSeasonYear: show.animeSeasonYear ?? null,
            anilistFormat: show.anilistFormat ?? null,
            anilistId: show.anilistId ?? null,
            malId: show.malId ?? null,
            status: userShow.status,
            watchedEpisodes,
            remainingEpisodes,
            isAutoTracked: userShow.isAutoTracked ?? false,
            lastWatchedAt: userShow.lastWatchedAt ?? userShow.addedAt,
            autoPausedAt: userShow.autoPausedAt ?? null,
          };
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const requestedKeepEntry =
      keepShowId !== null
        ? relatedEntries.find((entry) => entry.showId === keepShowId) ?? null
        : null;
    const effectiveKeepEntry =
      requestedKeepEntry &&
      requestedKeepEntry.status !== "completed" &&
      requestedKeepEntry.status !== "dropped" &&
      (requestedKeepEntry.status !== "paused" || requestedKeepEntry.autoPausedAt !== null)
        ? requestedKeepEntry
        : findNextMainlineAnimeEntryToActivate(
            relatedEntries,
            sortProjectionAnimeCandidates,
            isProjectionMainlineAnime
          );

    let pausedCount = 0;
    const now = Date.now();

    for (const userShow of relatedUserShows) {
      if (userShow.showId === sourceShow._id) continue;
      if (effectiveKeepEntry && userShow._id === effectiveKeepEntry.userShowId) continue;
      if (
        userShow.status === "paused" ||
        userShow.status === "completed" ||
        userShow.status === "dropped"
      ) {
        continue;
      }

      await ctx.db.patch(userShow._id, {
        status: "paused",
        statusChangedAt: now,
        completedAt: undefined,
        droppedAt: undefined,
        autoPausedAt: now,
      });
      await upsertFeedProjectionForUserShow(ctx, userShow._id);
      pausedCount += 1;
    }

    if (effectiveKeepEntry) {
      const keepUserShow = relatedUserShows.find(
        (userShow) => userShow._id === effectiveKeepEntry.userShowId
      );
      if (
        keepUserShow &&
        keepUserShow.status === "paused" &&
        keepUserShow.autoPausedAt
      ) {
        const nextStatus: UserShowStatus =
          (keepUserShow.watchedEpisodesCount ?? 0) > 0 ? "watching" : "plan_to_watch";
        await ctx.db.patch(keepUserShow._id, {
          status: nextStatus,
          statusChangedAt: now,
          droppedAt: undefined,
          completedAt: undefined,
          autoPausedAt: undefined,
        });
        await upsertFeedProjectionForUserShow(ctx, keepUserShow._id);
      }
    }

    return {
      pausedCount,
      relatedCount: relatedUserShows.length,
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

    const allUserShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .collect();

    // Pre-filter movies using denormalized mediaType when available.
    // This avoids hydrating show docs for movies (which are always excluded).
    const userShows = allUserShows.filter((us) => us.mediaType !== "movie");

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

        const storedWatchedCount = Math.max(
          0,
          Math.floor(userShow.watchedEpisodesCount ?? 0)
        );

        const shouldRecomputeWatchedCount =
          storedWatchedCount > 0 &&
          typeof totalEpisodes === "number" &&
          storedWatchedCount > totalEpisodes;

        let watchedCount = storedWatchedCount;

        if (shouldRecomputeWatchedCount) {
          const watchedEpisodes = await ctx.db
            .query("watchedEpisodes")
            .withIndex("by_user_show", (q) =>
              q.eq("userId", userId as Id<"users">).eq("showId", show._id)
            )
            .take(5000);

          watchedCount = computeWatchedEpisodeAggregates(
            watchedEpisodes,
            show
          ).watchedEpisodesCount;
        }

        if (typeof totalEpisodes === "number") {
          watchedCount = Math.min(watchedCount, totalEpisodes);
        }

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
              ? "in_progress"
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
      const selected = selectAnimeFranchiseRepresentative(entries, {
        isMainlineEntry: isMainlineAnime,
        preferMainlineOnly: true,
        sortEntries: sortAnimeCandidates,
      });

      if (!selected) {
        continue;
      }

      selectedEntries.push({
        ...selected.entry,
        lastWatchedAt: selected.lastActivityAt,
      });
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

    const feedProjections =
      remaining > 0
        ? await ctx.db
            .query("feedProjections")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .take(remaining)
        : [];

    for (const entry of feedProjections) {
      await ctx.db.delete(entry._id);
    }

    remaining -= feedProjections.length;

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
      feedProjections.length +
      userShows.length +
      userFavorites.length +
      customLists.length;

    return {
      removedUserShows: userShows.length,
      removedWatchedEpisodes: watchedEpisodes.length,
      removedFeedProjections: feedProjections.length,
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
    let removedFeedProjections = 0;
    let removedFavorites = 0;
    let removedLists = 0;
    let batches = 0;

    while (batches < RESET_USER_DATA_MAX_BATCHES) {
      const batchResult: {
        removedUserShows: number;
        removedWatchedEpisodes: number;
        removedFeedProjections: number;
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
      removedFeedProjections += batchResult.removedFeedProjections;
      removedFavorites += batchResult.removedFavorites;
      removedLists += batchResult.removedLists;
      batches += 1;

      if (!batchResult.hasMore || batchResult.deletedTotal === 0) {
        return {
          removedUserShows,
          removedWatchedEpisodes,
          removedFeedProjections,
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
      removedFeedProjections,
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

    const feedProjections =
      remaining > 0 ? await ctx.db.query("feedProjections").take(remaining) : [];
    for (const entry of feedProjections) {
      await ctx.db.delete(entry._id);
    }
    remaining -= feedProjections.length;

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
      feedProjections.length +
      userShows.length +
      userFavorites.length +
      customLists.length +
      shows.length +
      scheduleCache.length;

    return {
      removedWatchedEpisodes: watchedEpisodes.length,
      removedFeedProjections: feedProjections.length,
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
    let removedFeedProjections = 0;
    let removedUserShows = 0;
    let removedFavorites = 0;
    let removedLists = 0;
    let removedShows = 0;
    let removedScheduleCache = 0;
    let batches = 0;

    while (batches < RESET_GLOBAL_MEDIA_MAX_BATCHES) {
      const batchResult: {
        removedWatchedEpisodes: number;
        removedFeedProjections: number;
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
      removedFeedProjections += batchResult.removedFeedProjections;
      removedUserShows += batchResult.removedUserShows;
      removedFavorites += batchResult.removedFavorites;
      removedLists += batchResult.removedLists;
      removedShows += batchResult.removedShows;
      removedScheduleCache += batchResult.removedScheduleCache;
      batches += 1;

      if (!batchResult.hasMore || batchResult.deletedTotal === 0) {
        return {
          removedWatchedEpisodes,
          removedFeedProjections,
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
      removedFeedProjections,
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

      const show = await ctx.db.get(userShow.showId);
      if (!show) {
        continue;
      }

      const watchedEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", args.userId).eq("showId", userShow.showId)
        )
        .collect();

      const aggregates = computeWatchedEpisodeAggregates(watchedEpisodes, show);
      const patch: Partial<Doc<"userShows">> = {
        watchedEpisodesCount: aggregates.watchedEpisodesCount,
        watchedTotalCount: aggregates.watchedTotalCount,
        watchedRuntimeMinutes: aggregates.watchedRuntimeMinutes,
        lastWatchedAt: aggregates.lastWatchedAt ?? userShow.lastWatchedAt,
      };

      if (
        userShow.status === "watching" ||
        userShow.status === "plan_to_watch" ||
        userShow.status === "completed"
      ) {
        const nextStatus = getDerivedUserShowStatusFromProgress(
          userShow.status,
          {
            mediaType: show.mediaType,
            status: show.status,
            totalEpisodes: show.totalEpisodes,
            totalSeasons: show.totalSeasons,
          },
          aggregates.watchedEpisodesCount
        );

        if (nextStatus !== userShow.status) {
          patch.status = nextStatus;
          patch.statusChangedAt = Date.now();
          patch.completedAt = nextStatus === "completed" ? Date.now() : undefined;
          if (userShow.status === "completed" && nextStatus !== "completed") {
            patch.completedAt = undefined;
          }
        }
      }

      await ctx.db.patch(userShowId, patch);
      await upsertFeedProjectionForUserShow(ctx, userShowId);

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
        mediaType: args.show.mediaType,
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
    const addedRangeEpisodesForAggregate: TrackedWatchedEpisodeLike[] = [];

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
        addedRangeEpisodesForAggregate.push({
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

    const totalWatched = computeWatchedEpisodeAggregates(
      [...watchedEpisodes, ...addedRangeEpisodesForAggregate],
      args.show
    ).watchedEpisodesCount;
    const nextStatus = getDerivedUserShowStatusFromProgress(
      userShow?.status,
      args.show,
      totalWatched
    );

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
        const newUserShowId = await ctx.db.insert("userShows", {
          userId,
          showId,
          status: "completed",
          mediaType: args.show.mediaType ?? ("movie" as const),
          watchedEpisodesCount: 0,
          watchedTotalCount: 0,
          watchedRuntimeMinutes: 0,
          addedAt: now,
          lastWatchedAt: now,
        });
        await upsertFeedProjectionForUserShow(ctx, newUserShowId);
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
      return [];
    }

    const show = await findShowByLookup(ctx, args);
    if (!show) {
      return [];
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("showId", show._id))
      .take(5000);

    return watchedEpisodes.map((entry) => ({
      season: entry.season,
      episode: entry.episode,
      count: entry.watchCount ?? 1,
    }));
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

function isCaughtUpOnOngoingShow(
  show: Pick<Doc<"shows">, "mediaType" | "status" | "totalEpisodes">,
  watchedEpisodesCount: number
) {
  if (show.mediaType === "movie") {
    return false;
  }

  const totalEpisodes = normalizePositiveEpisodeCount(show.totalEpisodes);
  if (typeof totalEpisodes !== "number") {
    return false;
  }

  if (watchedEpisodesCount < totalEpisodes) {
    return false;
  }

  return !isTerminalLifecycleStatus(show.status);
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
      const show = await ctx.db.get(userShow.showId);
      if (
        show &&
        isCaughtUpOnOngoingShow(show, Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0)))
      ) {
        continue;
      }

      // Double-check the condition
      if (shouldAutoPause(userShow.status, userShow.lastWatchedAt, now)) {
        await ctx.db.patch(userShow._id, {
          status: "paused",
          statusChangedAt: now,
          autoPausedAt: now,
        });
        await upsertFeedProjectionForUserShow(ctx, userShow._id);
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

  const show = await ctx.db.get(showId);
  if (!show) return;
  
  const watchedEpisodes = await ctx.db
    .query("watchedEpisodes")
    .withIndex("by_user_show", (q) => 
      q.eq("userId", userShow.userId).eq("showId", showId)
    )
    .collect();
  
  const now = Date.now();
  const watchedCount = computeWatchedEpisodeAggregates(watchedEpisodes, {
    mediaType: show.mediaType,
    status: show.status,
    totalEpisodes: totalEpisodes ?? show.totalEpisodes,
    totalSeasons: show.totalSeasons,
  }).watchedEpisodesCount;
  const nextStatus = getDerivedUserShowStatusFromProgress(
    userShow.status,
    {
      mediaType: show.mediaType,
      status: show.status,
      totalEpisodes: totalEpisodes ?? show.totalEpisodes,
      totalSeasons: show.totalSeasons,
    },
    watchedCount
  );

  if (nextStatus === "completed" && userShow.status !== "completed") {
    await ctx.db.patch(userShowId, {
      status: nextStatus,
      statusChangedAt: now,
      completedAt: now,
    });
    await upsertFeedProjectionForUserShow(ctx, userShowId);
    return;
  }

  if (nextStatus !== userShow.status && nextStatus !== "completed") {
    await ctx.db.patch(userShowId, {
      status: nextStatus,
      statusChangedAt: now,
      completedAt: userShow.status === "completed" ? undefined : userShow.completedAt,
    });
    await upsertFeedProjectionForUserShow(ctx, userShowId);
    return;
  }
}

/**
 * Get recommended shows based on user's watch history
 * Returns shows that are similar to what the user has watched
 */
type RecommendationSeed = {
  id: string;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
  mediaType: "tv" | "movie" | "anime";
  title: string;
  activityAt: number;
  watchedCount: number;
};

function buildRecommendationSeedFromProjection(
  projection: Doc<"feedProjections">
): RecommendationSeed | null {
  const watchedCount = projection.watchedEpisodesCount ?? 0;
  const activityAt = projection.lastWatchedAt;

  if (projection.mediaType === "anime") {
    if (
      typeof projection.anilistId !== "number" &&
      typeof projection.malId !== "number"
    ) {
      return null;
    }

    return {
      id:
        typeof projection.anilistId === "number"
          ? `anilist:anime:${projection.anilistId}`
          : `jikan:anime:${projection.malId}`,
      anilistId: projection.anilistId,
      malId: projection.malId,
      mediaType: "anime",
      title: projection.title,
      activityAt,
      watchedCount,
    };
  }

  if (
    (projection.mediaType === "tv" || projection.mediaType === "movie") &&
    typeof projection.tmdbId === "number"
  ) {
    return {
      id: `tmdb:${projection.mediaType}:${projection.tmdbId}`,
      tmdbId: projection.tmdbId,
      mediaType: projection.mediaType,
      title: projection.title,
      activityAt,
      watchedCount,
    };
  }

  return null;
}

function dedupeAndSortRecommendationSeeds(seeds: RecommendationSeed[]) {
  const dedupedById = new Map<string, RecommendationSeed>();

  for (const seed of seeds) {
    const key =
      seed.mediaType === "anime"
        ? `anime:${seed.anilistId ?? seed.malId}`
        : `${seed.mediaType}:${seed.tmdbId ?? seed.id}`;
    const existing = dedupedById.get(key);
    if (!existing || seed.activityAt > existing.activityAt) {
      dedupedById.set(key, seed);
    }
  }

  return Array.from(dedupedById.values()).sort((a, b) => {
    if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt;
    if (b.watchedCount !== a.watchedCount) return b.watchedCount - a.watchedCount;
    return a.title.localeCompare(b.title);
  });
}

function toPublicRecommendationSeed(seed: RecommendationSeed) {
  return {
    id: seed.id,
    tmdbId: seed.tmdbId,
    anilistId: seed.anilistId,
    malId: seed.malId,
    mediaType: seed.mediaType,
    title: seed.title,
  };
}

async function getRecommendationSeedsForUser(ctx: QueryCtx, userId: Id<"users">) {
  const projections = await ctx.db
    .query("feedProjections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const seeds = projections
    .filter((projection) => {
      const watchedCount = projection.watchedEpisodesCount ?? 0;
      return (
        watchedCount > 0 ||
        projection.status === "watching" ||
        projection.status === "completed"
      );
    })
    .map(buildRecommendationSeedFromProjection)
    .filter((seed): seed is RecommendationSeed => seed !== null);

  return dedupeAndSortRecommendationSeeds(seeds);
}

export const getRecommendationSeedsByMedia = query({
  args: {
    limitPerType: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      return {
        tv: [] as ReturnType<typeof toPublicRecommendationSeed>[],
        anime: [] as ReturnType<typeof toPublicRecommendationSeed>[],
        movie: [] as ReturnType<typeof toPublicRecommendationSeed>[],
      };
    }

    const limitPerType = Math.max(1, Math.min(args.limitPerType ?? 10, 30));
    const grouped = {
      tv: [] as ReturnType<typeof toPublicRecommendationSeed>[],
      anime: [] as ReturnType<typeof toPublicRecommendationSeed>[],
      movie: [] as ReturnType<typeof toPublicRecommendationSeed>[],
    };

    const seeds = await getRecommendationSeedsForUser(ctx, userId as Id<"users">);
    for (const seed of seeds) {
      const bucket = grouped[seed.mediaType];
      if (bucket.length >= limitPerType) {
        continue;
      }
      bucket.push(toPublicRecommendationSeed(seed));
    }

    return grouped;
  },
});

export const getRecommendations = query({
  args: {
    mediaType: v.optional(v.union(v.literal("tv"), v.literal("movie"), v.literal("anime"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    
    // Return empty if not authenticated
    if (!userId) {
      return [];
    }

    const limit = Math.max(1, Math.min(args.limit ?? 8, 20));

    const seeds = await getRecommendationSeedsForUser(ctx, userId as Id<"users">);
    const filteredSeeds = args.mediaType
      ? seeds.filter((seed) => seed.mediaType === args.mediaType)
      : seeds;

    return filteredSeeds.slice(0, limit).map(toPublicRecommendationSeed);
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

export const debugShowCounts = internalQuery({
  args: {
    showId: v.id("shows"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        totalRecords: 0,
        uniqueEpisodes: 0,
        uniqueList: [],
      };
    }

    const watchedEpisodes = await ctx.db
      .query("watchedEpisodes")
      .withIndex("by_user_show", (q) => q.eq("userId", args.userId).eq("showId", args.showId))
      .collect();
    
    const uniqueEpisodes = new Set(
      watchedEpisodes.map((ep) => `${ep.season}:${ep.episode}`)
    );
    
    return {
      totalRecords: watchedEpisodes.length,
      uniqueEpisodes: uniqueEpisodes.size,
      uniqueList: Array.from(uniqueEpisodes).slice(0, 20),
    };
  },
});

// Action version for imperative calls from frontend
export const getWatchedEpisodesForSeasonAction = action({
  args: {
    tmdbId: v.optional(v.number()),
    tvdbId: v.optional(v.number()),
    anilistId: v.optional(v.number()),
    malId: v.optional(v.number()),
    tvmazeId: v.optional(v.number()),
    mediaType: v.optional(v.union(v.literal("tv"), v.literal("anime"), v.literal("movie"))),
    season: v.number(),
  },
  handler: async (ctx, args): Promise<string[]> => {
    return ctx.runQuery(api.shows.getWatchedEpisodesForSeason, args);
  },
});

// Migration: Backfill titleLower for existing shows that don't have it
export const backfillTitleLower = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const BATCH_SIZE = 100;
    const shows = await ctx.db
      .query("shows")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let processedCount = 0;
    let updatedCount = 0;

    for (const show of shows.page) {
      processedCount++;
      if (!show.titleLower && show.title) {
        await ctx.db.patch(show._id, {
          titleLower: show.title.toLowerCase().trim(),
        });
        updatedCount++;
      }
    }

    return {
      nextCursor: shows.continueCursor,
      isDone: shows.isDone,
      processedCount,
      updatedCount,
    };
  },
});

export const runBackfillTitleLower = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;
    let processedCount = 0;
    let updatedCount = 0;
    let rounds = 0;

    while (!isDone) {
      const batch: {
        nextCursor: string | null;
        isDone: boolean;
        processedCount: number;
        updatedCount: number;
      } = await ctx.runMutation(internal.shows.backfillTitleLower, {
        cursor,
      });

      processedCount += batch.processedCount;
      updatedCount += batch.updatedCount;
      cursor = batch.nextCursor ?? undefined;
      isDone = batch.isDone;
      rounds += 1;
    }

    return {
      processedCount,
      updatedCount,
      rounds,
    };
  },
});
