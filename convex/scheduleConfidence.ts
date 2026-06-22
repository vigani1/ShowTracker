import { mutation, query } from "@/convex/_generated/server";
import type { MutationCtx, QueryCtx } from "@/convex/_generated/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

const IMPORT_BATCH_LIMIT = 200;
const APPLY_DELTA_LIMIT = 50;
const SCHEDULE_PROJECTION_EVENT_LIMIT = 1000;
const SCHEDULE_PROJECTION_COUNT_LIMIT = 1000;
const SCHEDULE_PROJECTION_MAX_WINDOW_DAYS = 180;
const SCHEDULE_CONFIDENCE_TOKEN_ENV = "SCHEDULE_CONFIDENCE_IMPORT_TOKEN";
const WATCHED_EPISODE_ANCHOR_LIMIT = 128;
const SYNTHETIC_PREFIX = "SC Synthetic";
const SYNTHETIC_NOW = Date.UTC(2026, 4, 14, 12, 0, 0);
const SYNTHETIC_SCHEDULE_CACHE_DATES = [
  "2026-05-15",
  "2026-05-16",
  "2026-05-20",
  "2026-05-23",
  "2026-05-30",
];
const SCHEDULE_MOVE_PRUNE_WINDOW_DAYS = 45;
const STALE_PROVIDER_PRUNE_PAST_DAYS = 45;
const STALE_PROVIDER_PRUNE_FUTURE_DAYS = 120;
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

const mediaTypeValidator = v.union(
  v.literal("tv"),
  v.literal("anime"),
  v.literal("movie")
);

const matchConfidenceValidator = v.union(
  v.literal("direct_id"),
  v.literal("bridged_id"),
  v.literal("verified_title"),
  v.literal("title_fallback"),
  v.literal("missing_provider")
);

const releaseStateValidator = v.union(
  v.literal("available_now"),
  v.literal("upcoming"),
  v.literal("caught_up"),
  v.literal("unknown")
);

const providerIdsValidator = v.object({
  tmdbId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  malId: v.optional(v.number()),
  imdbId: v.optional(v.string()),
});
const scheduleMediaFilterValidator = v.optional(
  v.union(v.literal("tv"), v.literal("anime"))
);

const episodeFactValidator = v.object({
  seasonNumber: v.number(),
  episodeNumber: v.number(),
  name: v.optional(v.string()),
  airDate: v.optional(v.string()),
  airTimestamp: v.optional(v.number()),
});

const projectionRepairValidator = v.object({
  reason: v.string(),
  importedWatchableEpisodes: v.optional(v.number()),
  providerReleasedEpisodes: v.optional(v.number()),
  providerTotalEpisodes: v.optional(v.number()),
});

const scheduleCacheProviderPruneValidator = v.object({
  sourceProvider: v.string(),
  providerShowId: v.string(),
  episodes: v.array(episodeFactValidator),
});

const releaseDeltaValidator = v.object({
  canonicalKey: v.string(),
  title: v.string(),
  mediaType: mediaTypeValidator,
  providerIds: providerIdsValidator,
  matchConfidence: matchConfidenceValidator,
  releaseState: releaseStateValidator,
  releasedEpisodes: v.optional(v.number()),
  totalEpisodes: v.optional(v.number()),
  latestReleased: v.optional(episodeFactValidator),
  nextScheduled: v.optional(episodeFactValidator),
  upcomingEpisodes: v.optional(v.array(episodeFactValidator)),
  clearStaleEpisodeSignal: v.optional(v.boolean()),
  scheduleCacheProviderPrunes: v.optional(v.array(scheduleCacheProviderPruneValidator)),
  scheduleCacheMaintenance: v.optional(v.boolean()),
  scheduleCacheMaintenanceVersion: v.optional(v.number()),
  projectionRepair: v.optional(projectionRepairValidator),
  sourceProvider: v.optional(v.string()),
  reconciledAt: v.number(),
});

const projectionMediaTypeValidator = v.union(v.literal("tv"), v.literal("anime"));

const scheduleProjectionEventValidator = v.object({
  showId: v.id("shows"),
  userShowId: v.id("userShows"),
  feedProjectionId: v.id("feedProjections"),
  date: v.string(),
  routeId: v.string(),
  mediaType: projectionMediaTypeValidator,
  sourceMediaType: projectionMediaTypeValidator,
  sourceProvider: v.optional(v.string()),
  showTitle: v.string(),
  posterUrl: v.optional(v.string()),
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  malId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  imdbId: v.optional(v.string()),
  seasonNumber: v.number(),
  episodeNumber: v.number(),
  episodeName: v.optional(v.string()),
  airDate: v.optional(v.string()),
  airtimeMs: v.number(),
  seriesDedupeKey: v.string(),
  episodeDedupeKey: v.string(),
  sameTrackedShowDayKey: v.string(),
  sourceMatchesTracked: v.boolean(),
  matchConfidence: v.union(
    v.literal("direct_id"),
    v.literal("bridged_id"),
    v.literal("verified_title"),
    v.literal("title_fallback")
  ),
  projectionUpdatedAt: v.number(),
  reconciledAt: v.number(),
  updatedAt: v.number(),
});

const watchlistFutureCountProjectionValidator = v.object({
  mediaFilter: v.union(v.literal("all"), v.literal("tv"), v.literal("anime")),
  routeId: v.string(),
  availableCount: v.number(),
  futureCount: v.number(),
  unavailableCount: v.number(),
  projectionUpdatedAt: v.number(),
  reconciledAt: v.number(),
  updatedAt: v.number(),
});

type SyntheticCase = {
  key: string;
  title: string;
  mediaType: "tv" | "anime";
  status: "watching" | "completed" | "plan_to_watch";
  watchedEpisodesCount: number;
  totalEpisodes: number;
  releasedEpisodes: number;
  tmdbId?: number;
  tvmazeId?: number;
  anilistId?: number;
  malId?: number;
  imdbId?: string;
  firstAired: string;
  lastWatchedAt: number;
  newEpisodeSignalAt?: number;
};

const syntheticCases: SyntheticCase[] = [
  {
    key: "direct",
    title: `${SYNTHETIC_PREFIX} Direct Provider Match`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 4,
    totalEpisodes: 4,
    releasedEpisodes: 4,
    tmdbId: 981001,
    tvmazeId: 991001,
    imdbId: "tt9810011",
    firstAired: "2021-01-01",
    lastWatchedAt: Date.UTC(2025, 0, 1),
  },
  {
    key: "bridged",
    title: `${SYNTHETIC_PREFIX} Bridged Provider Match`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 2,
    totalEpisodes: 2,
    releasedEpisodes: 2,
    tmdbId: 981002,
    imdbId: "tt9810022",
    firstAired: "2020-03-10",
    lastWatchedAt: Date.UTC(2024, 1, 1),
  },
  {
    key: "global",
    title: `${SYNTHETIC_PREFIX} Global Web Release`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 7,
    totalEpisodes: 7,
    releasedEpisodes: 7,
    tmdbId: 981003,
    tvmazeId: 991003,
    firstAired: "2019-05-15",
    lastWatchedAt: Date.UTC(2023, 6, 1),
  },
  {
    key: "future",
    title: `${SYNTHETIC_PREFIX} Future Anime`,
    mediaType: "anime",
    status: "watching",
    watchedEpisodesCount: 10,
    totalEpisodes: 12,
    releasedEpisodes: 10,
    anilistId: 981004,
    malId: 971004,
    firstAired: "2026-04-01",
    lastWatchedAt: Date.UTC(2026, 4, 1),
  },
  {
    key: "stale_future_signal",
    title: `${SYNTHETIC_PREFIX} Stale Future Signal Clear`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 1201,
    totalEpisodes: 1202,
    releasedEpisodes: 1201,
    tmdbId: 981010,
    tvmazeId: 991010,
    imdbId: "tt9810100",
    firstAired: "1996-01-08",
    lastWatchedAt: Date.UTC(2026, 4, 9, 13, 0, 0),
    newEpisodeSignalAt: Date.UTC(2026, 4, 16, 13, 0, 0),
  },
  {
    key: "completed_old",
    title: `${SYNTHETIC_PREFIX} Completed Old Show Returns`,
    mediaType: "tv",
    status: "completed",
    watchedEpisodesCount: 12,
    totalEpisodes: 12,
    releasedEpisodes: 12,
    tmdbId: 981005,
    tvmazeId: 991005,
    firstAired: "1998-09-22",
    lastWatchedAt: Date.UTC(2018, 0, 1),
  },
  {
    key: "stale_projection",
    title: `${SYNTHETIC_PREFIX} Stale Projection Repair`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 20,
    totalEpisodes: 21,
    releasedEpisodes: 21,
    tmdbId: 981006,
    tvmazeId: 991006,
    firstAired: "2010-02-05",
    lastWatchedAt: Date.UTC(2021, 2, 1),
  },
  {
    key: "missing_provider",
    title: `${SYNTHETIC_PREFIX} Missing Provider Link`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 1,
    totalEpisodes: 2,
    releasedEpisodes: 1,
    firstAired: "2024-01-01",
    lastWatchedAt: Date.UTC(2024, 0, 15),
  },
  {
    key: "title_fallback",
    title: `${SYNTHETIC_PREFIX} Title Fallback Only`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 2,
    totalEpisodes: 2,
    releasedEpisodes: 2,
    firstAired: "2023-06-01",
    lastWatchedAt: Date.UTC(2023, 6, 1),
  },
  {
    key: "conflicting_provider",
    title: `${SYNTHETIC_PREFIX} Conflicting Provider Audit`,
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 3,
    totalEpisodes: 3,
    releasedEpisodes: 3,
    tmdbId: 981009,
    tvmazeId: 991009,
    firstAired: "2022-02-02",
    lastWatchedAt: Date.UTC(2022, 3, 1),
  },
];

function requireImportToken(importToken: string) {
  const expected = process.env[SCHEDULE_CONFIDENCE_TOKEN_ENV]?.trim();
  if (!expected) {
    throw new Error(`${SCHEDULE_CONFIDENCE_TOKEN_ENV} is not configured.`);
  }
  if (importToken !== expected) {
    throw new Error("Invalid schedule confidence import token.");
  }
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAnimeSeasonTitleVariant(
  scheduleNormalizedTitle: string,
  trackedNormalizedTitle: string
) {
  if (
    !scheduleNormalizedTitle ||
    !trackedNormalizedTitle ||
    scheduleNormalizedTitle === trackedNormalizedTitle ||
    !scheduleNormalizedTitle.startsWith(trackedNormalizedTitle)
  ) {
    return false;
  }

  const suffix = scheduleNormalizedTitle.slice(trackedNormalizedTitle.length);

  return /^(?:s\d+|season\d*|\d+(?:st|nd|rd|th)?season|part\d*|cour\d*|finalseason)/.test(
    suffix
  );
}

function clampOptionalCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function positiveOptionalCount(value: number | undefined) {
  const count = clampOptionalCount(value);
  return typeof count === "number" && count > 0 ? count : undefined;
}

function isTerminalLifecycleStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();
  return normalized ? TERMINAL_SHOW_LIFECYCLE_STATUSES.has(normalized) : false;
}

function getWatchableEpisodeCountForShow(
  show: Pick<
    Doc<"shows">,
    "mediaType" | "status" | "releasedEpisodes" | "totalEpisodes"
  >
) {
  const totalEpisodes = positiveOptionalCount(show.totalEpisodes);
  const releasedEpisodes = clampOptionalCount(show.releasedEpisodes);

  if (
    show.mediaType !== "movie" &&
    isTerminalLifecycleStatus(show.status) &&
    typeof totalEpisodes === "number"
  ) {
    return typeof releasedEpisodes === "number" && releasedEpisodes > 0
      ? Math.min(releasedEpisodes, totalEpisodes)
      : totalEpisodes;
  }

  if (typeof releasedEpisodes === "number") {
    return typeof totalEpisodes === "number"
      ? Math.min(releasedEpisodes, totalEpisodes)
      : releasedEpisodes;
  }

  return totalEpisodes;
}

function getEpisodeLastWatchedAt(
  entry: Pick<Doc<"watchedEpisodes">, "watchedAt" | "watchHistory">
) {
  const latestHistoryEntry = Array.isArray(entry.watchHistory)
    ? entry.watchHistory
        .filter((value) => typeof value === "number" && Number.isFinite(value))
        .reduce<number | undefined>(
          (latest, value) =>
            typeof latest === "number" ? Math.max(latest, value) : value,
          undefined
        )
    : undefined;

  if (typeof latestHistoryEntry === "number") {
    return latestHistoryEntry;
  }

  return typeof entry.watchedAt === "number" && Number.isFinite(entry.watchedAt)
    ? entry.watchedAt
    : undefined;
}

function isWatchedEpisodeWithinKnownShowBounds(
  show: Pick<Doc<"shows">, "mediaType" | "totalEpisodes" | "totalSeasons">,
  entry: Pick<Doc<"watchedEpisodes">, "season" | "episode">
) {
  if (
    !Number.isFinite(entry.season) ||
    entry.season < 1 ||
    !Number.isFinite(entry.episode) ||
    entry.episode < 1
  ) {
    return false;
  }

  const totalSeasons = positiveOptionalCount(show.totalSeasons);
  if (typeof totalSeasons === "number" && entry.season > totalSeasons) {
    return false;
  }

  const totalEpisodes = positiveOptionalCount(show.totalEpisodes);
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

function computeWatchedEpisodeAggregates(
  watchedEpisodes: Doc<"watchedEpisodes">[],
  show: Pick<Doc<"shows">, "mediaType" | "totalEpisodes" | "totalSeasons">
) {
  const uniqueEpisodeKeys = new Set<string>();
  let watchedTotalCount = 0;
  let watchedRuntimeMinutes = 0;
  let lastWatchedAt: number | undefined;

  for (const entry of watchedEpisodes) {
    if (!isWatchedEpisodeWithinKnownShowBounds(show, entry)) {
      continue;
    }

    uniqueEpisodeKeys.add(`${entry.season}:${entry.episode}`);

    const watchCount = entry.watchCount ?? 1;
    watchedTotalCount += watchCount;

    const runtime = typeof entry.runtime === "number" ? entry.runtime : 0;
    watchedRuntimeMinutes += runtime * watchCount;

    const episodeLastWatchedAt = getEpisodeLastWatchedAt(entry);
    if (
      typeof episodeLastWatchedAt === "number" &&
      (typeof lastWatchedAt !== "number" ||
        episodeLastWatchedAt > lastWatchedAt)
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

async function computeTrackingAggregatesForUserShow(
  ctx: QueryCtx | MutationCtx,
  userShow: Doc<"userShows">,
  show: Pick<Doc<"shows">, "mediaType" | "totalEpisodes" | "totalSeasons">
) {
  const watchedEpisodes = await ctx.db
    .query("watchedEpisodes")
    .withIndex("by_user_show", (q) =>
      q.eq("userId", userShow.userId).eq("showId", userShow.showId)
    )
    .collect();

  return computeWatchedEpisodeAggregates(watchedEpisodes, show);
}

function shouldRepairTrackingAggregatesForShowPatch(
  previousShow: Doc<"shows">,
  patchedShow: Doc<"shows">
) {
  if (previousShow.mediaType !== "tv" && previousShow.mediaType !== "anime") {
    return false;
  }

  const previousTotal = positiveOptionalCount(previousShow.totalEpisodes);
  const nextTotal = positiveOptionalCount(patchedShow.totalEpisodes);
  return (
    typeof previousTotal === "number" &&
    typeof nextTotal === "number" &&
    nextTotal > previousTotal
  );
}

function addTrackingAggregatePatch(
  patch: Partial<Doc<"userShows">>,
  userShow: Doc<"userShows">,
  aggregate: ReturnType<typeof computeWatchedEpisodeAggregates>
) {
  let changed = false;
  changed =
    setChangedField(
      patch,
      userShow,
      "watchedEpisodesCount",
      aggregate.watchedEpisodesCount
    ) || changed;
  changed =
    setChangedField(
      patch,
      userShow,
      "watchedTotalCount",
      aggregate.watchedTotalCount
    ) || changed;
  changed =
    setChangedField(
      patch,
      userShow,
      "watchedRuntimeMinutes",
      aggregate.watchedRuntimeMinutes
    ) || changed;
  changed =
    setChangedField(patch, userShow, "lastWatchedAt", aggregate.lastWatchedAt) ||
    changed;
  return changed;
}

function maybeClearCaughtUpSignalFromAggregate(
  patch: Partial<Doc<"userShows">>,
  userShow: Doc<"userShows">,
  show: Pick<
    Doc<"shows">,
    "mediaType" | "status" | "releasedEpisodes" | "totalEpisodes"
  >,
  aggregate: ReturnType<typeof computeWatchedEpisodeAggregates>
) {
  if (Object.prototype.hasOwnProperty.call(patch, "newEpisodeSignalAt")) {
    return false;
  }

  const watchableEpisodes = getWatchableEpisodeCountForShow(show);
  if (
    typeof watchableEpisodes !== "number" ||
    aggregate.watchedEpisodesCount < watchableEpisodes ||
    typeof userShow.newEpisodeSignalAt !== "number"
  ) {
    return false;
  }

  const lastWatchedAt = aggregate.lastWatchedAt ?? userShow.addedAt ?? 0;
  if (userShow.newEpisodeSignalAt <= lastWatchedAt) {
    return false;
  }

  patch.newEpisodeSignalAt = undefined;
  return true;
}

function parseDateKey(value: string | undefined) {
  if (!value) {
    return null;
  }
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct?.[1]) {
    return direct[1];
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function parseStrictDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function getDateKeySpanDays(startDate: string, endDate: string) {
  const start = parseStrictDateKey(startDate);
  const end = parseStrictDateKey(endDate);
  if (!start || !end) {
    return null;
  }
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function assertProjectionWindow(startDate: string, endDate: string, label: string) {
  const spanDays = getDateKeySpanDays(startDate, endDate);
  if (spanDays === null || spanDays < 1) {
    throw new Error(`Invalid ${label} projection window.`);
  }
  if (spanDays > SCHEDULE_PROJECTION_MAX_WINDOW_DAYS) {
    throw new Error(
      `${label} projection window cannot exceed ${SCHEDULE_PROJECTION_MAX_WINDOW_DAYS} days.`
    );
  }
}

function addDaysToDateKey(dateKey: string, days: number) {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return dateKey;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getEpisodeSignalAt(episode: {
  airDate?: string;
  airTimestamp?: number;
}) {
  if (typeof episode.airTimestamp === "number" && Number.isFinite(episode.airTimestamp)) {
    return episode.airTimestamp;
  }
  if (episode.airDate) {
    const parsed = new Date(episode.airDate);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.getTime();
    }
  }
  return Date.now();
}

function isSameValue(a: unknown, b: unknown) {
  return Object.is(a ?? null, b ?? null);
}

function setChangedField<T extends Record<string, unknown>, K extends keyof T>(
  patch: Partial<T>,
  current: T,
  key: K,
  value: T[K]
) {
  if (!isSameValue(current[key], value)) {
    patch[key] = value;
    return true;
  }
  return false;
}

function getRouteProviderShowId(delta: {
  title: string;
  mediaType: "tv" | "anime" | "movie";
  providerIds: {
    tvmazeId?: number;
    anilistId?: number;
    malId?: number;
    tmdbId?: number;
    imdbId?: string;
  };
}) {
  if (delta.mediaType === "anime") {
    if (typeof delta.providerIds.anilistId === "number") {
      return `anilist:${delta.providerIds.anilistId}`;
    }
    if (typeof delta.providerIds.malId === "number") {
      return `jikan:${delta.providerIds.malId}`;
    }
  }
  if (delta.mediaType === "tv" && typeof delta.providerIds.tvmazeId === "number") {
    return `tvmaze:${delta.providerIds.tvmazeId}`;
  }
  if (
    (delta.mediaType === "tv" || delta.mediaType === "movie") &&
    typeof delta.providerIds.tmdbId === "number"
  ) {
    return `tmdb:${delta.mediaType}:${delta.providerIds.tmdbId}`;
  }
  if (typeof delta.providerIds.imdbId === "string") {
    return `imdb:${delta.mediaType}:${delta.providerIds.imdbId}`;
  }
  return `title:${delta.mediaType}:${normalizeTitle(delta.title)}`;
}

function getRouteProviderShowIds(delta: {
  title: string;
  mediaType: "tv" | "anime" | "movie";
  providerIds: {
    tvmazeId?: number;
    anilistId?: number;
    malId?: number;
    tmdbId?: number;
    imdbId?: string;
  };
}) {
  const ids = new Set<string>();
  const primaryId = getRouteProviderShowId(delta);
  ids.add(primaryId);

  if (delta.mediaType === "anime") {
    if (typeof delta.providerIds.anilistId === "number") {
      ids.add(`anilist:${delta.providerIds.anilistId}`);
    }
    if (typeof delta.providerIds.malId === "number") {
      ids.add(`jikan:${delta.providerIds.malId}`);
    }
  }

  if (delta.mediaType === "tv" || delta.mediaType === "movie") {
    if (typeof delta.providerIds.tmdbId === "number") {
      ids.add(`tmdb:${delta.mediaType}:${delta.providerIds.tmdbId}`);
      ids.add(`tmdb:${delta.providerIds.tmdbId}`);
    }
  }

  if (delta.mediaType === "tv" && typeof delta.providerIds.tvmazeId === "number") {
    ids.add(`tvmaze:${delta.providerIds.tvmazeId}`);
  }

  if (typeof delta.providerIds.imdbId === "string") {
    ids.add(`imdb:${delta.mediaType}:${delta.providerIds.imdbId}`);
  }

  ids.add(`title:${delta.mediaType}:${normalizeTitle(delta.title)}`);
  return ids;
}

function getDurableRouteProviderShowIds(delta: {
  mediaType: "tv" | "anime" | "movie";
  providerIds: {
    tvmazeId?: number;
    anilistId?: number;
    malId?: number;
    tmdbId?: number;
    imdbId?: string;
  };
}) {
  const ids = new Set<string>();

  if (delta.mediaType === "anime") {
    if (typeof delta.providerIds.anilistId === "number") {
      ids.add(`anilist:${delta.providerIds.anilistId}`);
    }
    if (typeof delta.providerIds.malId === "number") {
      ids.add(`jikan:${delta.providerIds.malId}`);
    }
  }

  if (delta.mediaType === "tv" || delta.mediaType === "movie") {
    if (typeof delta.providerIds.tmdbId === "number") {
      ids.add(`tmdb:${delta.mediaType}:${delta.providerIds.tmdbId}`);
    }
  }

  if (delta.mediaType === "tv" && typeof delta.providerIds.tvmazeId === "number") {
    ids.add(`tvmaze:${delta.providerIds.tvmazeId}`);
  }

  if (typeof delta.providerIds.imdbId === "string") {
    ids.add(`imdb:${delta.mediaType}:${delta.providerIds.imdbId}`);
  }

  return ids;
}

function getScheduleCacheProviderPruneShowIds(delta: {
  mediaType: "tv" | "anime" | "movie";
  providerIds: {
    tvmazeId?: number;
    anilistId?: number;
    malId?: number;
    tmdbId?: number;
    imdbId?: string;
  };
}) {
  const ids = getDurableRouteProviderShowIds(delta);
  if (
    (delta.mediaType === "tv" || delta.mediaType === "movie") &&
    typeof delta.providerIds.tmdbId === "number"
  ) {
    ids.add(`tmdb:${delta.providerIds.tmdbId}`);
  }
  return ids;
}

async function findShowByProviderIds(
  ctx: QueryCtx | MutationCtx,
  delta: {
    mediaType: "tv" | "anime" | "movie";
    providerIds: {
      tmdbId?: number;
      tvmazeId?: number;
      anilistId?: number;
      malId?: number;
    };
  }
) {
  const candidates: Array<Promise<Doc<"shows"> | null>> = [];
  if (typeof delta.providerIds.tmdbId === "number") {
    candidates.push(
      ctx.db
        .query("shows")
        .withIndex("by_tmdbId", (q) => q.eq("tmdbId", delta.providerIds.tmdbId))
        .first()
    );
  }
  if (typeof delta.providerIds.anilistId === "number") {
    candidates.push(
      ctx.db
        .query("shows")
        .withIndex("by_anilistId", (q) =>
          q.eq("anilistId", delta.providerIds.anilistId)
        )
        .first()
    );
  }
  if (typeof delta.providerIds.malId === "number") {
    candidates.push(
      ctx.db
        .query("shows")
        .withIndex("by_malId", (q) => q.eq("malId", delta.providerIds.malId))
        .first()
    );
  }
  if (typeof delta.providerIds.tvmazeId === "number") {
    candidates.push(
      ctx.db
        .query("shows")
        .withIndex("by_tvmazeId", (q) =>
          q.eq("tvmazeId", delta.providerIds.tvmazeId)
        )
        .first()
    );
  }

  for (const candidate of await Promise.all(candidates)) {
    if (candidate && candidate.mediaType === delta.mediaType) {
      return candidate;
    }
  }

  return null;
}

function buildProjectionFields(
  userShow: Doc<"userShows">,
  show: Doc<"shows">
) {
  const watchedCount = Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0));
  const totalEpisodes =
    typeof show.totalEpisodes === "number" ? show.totalEpisodes : undefined;
  const watchableEpisodes = getWatchableEpisodeCountForShow(show);
  const remainingEpisodes =
    typeof watchableEpisodes === "number"
      ? Math.max(watchableEpisodes - watchedCount, 0)
      : undefined;
  const lastWatchedAt = userShow.lastWatchedAt ?? userShow.addedAt;
  const newEpisodeSignalAt = userShow.newEpisodeSignalAt;

  return {
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
    lastWatchedAt,
    newEpisodeSignalAt,
    homeSortAt: Math.max(
      lastWatchedAt,
      typeof newEpisodeSignalAt === "number" ? newEpisodeSignalAt : 0
    ),
    autoPausedAt: userShow.autoPausedAt,
  };
}

type BaseProjectionFields = ReturnType<typeof buildProjectionFields>;

const SCHEDULE_PROJECTION_IDENTITY_KEYS: Array<keyof BaseProjectionFields> = [
  "title",
  "mediaType",
  "tmdbId",
  "anilistId",
  "malId",
  "tvmazeId",
  "imdbId",
  "firstAired",
];

function buildScheduleProjectionKey(
  userShow: Doc<"userShows">,
  fields: BaseProjectionFields
) {
  return JSON.stringify([
    userShow.showId,
    userShow._id,
    ...SCHEDULE_PROJECTION_IDENTITY_KEYS.map((key) => fields[key] ?? null),
  ]);
}

function hasScheduleProjectionIdentityChanges(
  userShow: Doc<"userShows">,
  existing: Doc<"feedProjections">,
  fields: BaseProjectionFields
) {
  if (existing.showId !== userShow.showId || existing.userShowId !== userShow._id) {
    return true;
  }
  return SCHEDULE_PROJECTION_IDENTITY_KEYS.some((key) => existing[key] !== fields[key]);
}

function withScheduleProjectionStamp(
  userShow: Doc<"userShows">,
  fields: BaseProjectionFields,
  existing: Doc<"feedProjections"> | null,
  now: number
) {
  const identityChanged = existing
    ? hasScheduleProjectionIdentityChanges(userShow, existing, fields)
    : true;
  return {
    ...fields,
    scheduleProjectionKey: buildScheduleProjectionKey(userShow, fields),
    scheduleProjectionUpdatedAt: identityChanged
      ? now
      : existing?.scheduleProjectionUpdatedAt ?? 0,
  };
}

async function findSyntheticUserId(ctx: QueryCtx | MutationCtx) {
  const projection = await ctx.db.query("feedProjections").first();
  if (projection) {
    return projection.userId;
  }
  const userShow = await ctx.db.query("userShows").first();
  if (userShow) {
    return userShow.userId;
  }
  return null;
}

function syntheticTitleLower(title: string) {
  return title.toLowerCase();
}

async function deleteSyntheticRows(ctx: MutationCtx) {
  const allShows = await ctx.db.query("shows").take(2000);
  const syntheticShows = allShows.filter((show) => show.title.startsWith(SYNTHETIC_PREFIX));
  const syntheticShowIds = new Set(syntheticShows.map((show) => show._id));
  let deletedShows = 0;
  let deletedUserShows = 0;
  let deletedWatchedEpisodes = 0;
  let deletedFeedProjections = 0;
  let cleanedScheduleRows = 0;

  for (const projection of await ctx.db.query("feedProjections").take(5000)) {
    if (
      syntheticShowIds.has(projection.showId) ||
      projection.title.startsWith(SYNTHETIC_PREFIX)
    ) {
      await ctx.db.delete(projection._id);
      deletedFeedProjections += 1;
    }
  }

  for (const userShow of await ctx.db.query("userShows").take(5000)) {
    if (syntheticShowIds.has(userShow.showId)) {
      await ctx.db.delete(userShow._id);
      deletedUserShows += 1;
    }
  }

  for (const watchedEpisode of await ctx.db.query("watchedEpisodes").take(10000)) {
    if (syntheticShowIds.has(watchedEpisode.showId)) {
      await ctx.db.delete(watchedEpisode._id);
      deletedWatchedEpisodes += 1;
    }
  }

  const normalizedPrefix = normalizeTitle(SYNTHETIC_PREFIX);
  for (const row of await ctx.db.query("scheduleCache").take(2000)) {
    const entries = parseCompactScheduleEntries(row.episodes);
    const filtered = entries.filter(
      (entry) => !entry.normalizedTitle.startsWith(normalizedPrefix)
    );
    if (filtered.length !== entries.length) {
      await ctx.db.patch(row._id, {
        episodes: JSON.stringify(filtered),
        lastUpdated: Date.now(),
      });
      cleanedScheduleRows += 1;
    }
  }

  for (const show of syntheticShows) {
    await ctx.db.delete(show._id);
    deletedShows += 1;
  }

  return {
    deletedShows,
    deletedUserShows,
    deletedWatchedEpisodes,
    deletedFeedProjections,
    cleanedScheduleRows,
  };
}

async function upsertSyntheticScheduleCacheEntry(
  ctx: MutationCtx,
  args: {
    date: string;
    mediaType: "tv" | "anime";
    showId: string;
    normalizedTitle: string;
    episode: {
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    };
  }
) {
  const rows = await ctx.db
    .query("scheduleCache")
    .withIndex("by_date_type", (q) =>
      q.eq("date", args.date).eq("mediaType", args.mediaType)
    )
    .collect();
  const [row, ...duplicates] = rows;
  const existingEntries = row ? parseCompactScheduleEntries(row.episodes) : [];
  const entries = existingEntries.filter(
    (entry) =>
      !(
        entry.showId === args.showId &&
        entry.episode.seasonNumber === args.episode.seasonNumber &&
        entry.episode.episodeNumber === args.episode.episodeNumber
      )
  );

  entries.push({
    showId: args.showId,
    normalizedTitle: args.normalizedTitle,
    episode: args.episode,
  });

  const payload = {
    date: args.date,
    mediaType: args.mediaType,
    episodes: serializeCompactScheduleEntries(entries),
    lastUpdated: Date.now(),
  };

  if (row) {
    await ctx.db.patch(row._id, payload);
  } else {
    await ctx.db.insert("scheduleCache", payload);
  }

  for (const duplicate of duplicates) {
    await ctx.db.delete(duplicate._id);
  }
}

async function patchProjectionForUserShow(
  ctx: MutationCtx,
  userShow: Doc<"userShows">,
  show: Doc<"shows">
) {
  const projection = await ctx.db
    .query("feedProjections")
      .withIndex("by_userShow", (q) => q.eq("userShowId", userShow._id))
      .unique();

  const now = Date.now();
  const fields = withScheduleProjectionStamp(
    userShow,
    buildProjectionFields(userShow, show),
    projection,
    now
  );
  if (!projection) {
    await ctx.db.insert("feedProjections", {
      userId: userShow.userId,
      showId: userShow.showId,
      userShowId: userShow._id,
      ...fields,
      updatedAt: now,
    });
    return true;
  }

  const patch: Partial<Doc<"feedProjections">> = {};
  for (const [key, value] of Object.entries(fields)) {
    const typedKey = key as keyof Doc<"feedProjections">;
    if (!isSameValue(projection[typedKey], value)) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return false;
  }

  patch.updatedAt = now;
  await ctx.db.patch(projection._id, patch);
  return true;
}

async function pruneMovedScheduleCacheEntries(
  ctx: MutationCtx,
  args: {
    mediaType: "tv" | "anime";
    normalizedTitle: string;
    totalEpisodes?: number;
    durableRouteProviderShowIds: Set<string>;
    factsByDate: Map<
      string,
      Array<{
        seasonNumber: number;
        episodeNumber: number;
        name?: string;
        airDate?: string;
      }>
    >;
  }
) {
  if (args.durableRouteProviderShowIds.size === 0) {
    return 0;
  }

  const dates = Array.from(args.factsByDate.keys()).sort();
  if (dates.length === 0) {
    return 0;
  }

  const desiredDatesByEpisodeNumber = new Map<string, Set<string>>();
  const desiredDatesByEpisodeName = new Map<string, Set<string>>();

  for (const [date, facts] of args.factsByDate) {
    for (const fact of facts) {
      const numberKey = `${fact.seasonNumber}:${fact.episodeNumber}`;
      const numberDates = desiredDatesByEpisodeNumber.get(numberKey) ?? new Set<string>();
      numberDates.add(date);
      desiredDatesByEpisodeNumber.set(numberKey, numberDates);

      const nameKey = normalizeTitle(fact.name ?? "");
      if (nameKey) {
        const nameDates = desiredDatesByEpisodeName.get(nameKey) ?? new Set<string>();
        nameDates.add(date);
        desiredDatesByEpisodeName.set(nameKey, nameDates);
      }
    }
  }

  const startDate = addDaysToDateKey(
    dates[0],
    -SCHEDULE_MOVE_PRUNE_WINDOW_DAYS
  );
  const endDate = addDaysToDateKey(
    dates[dates.length - 1],
    SCHEDULE_MOVE_PRUNE_WINDOW_DAYS
  );
  const mediaTypes =
    args.mediaType === "tv"
      ? (["tv", "anime"] as const)
      : (["anime", "tv"] as const);
  const rows = (
    await Promise.all(
      mediaTypes.map((mediaType) =>
        ctx.db
          .query("scheduleCache")
          .withIndex("by_type_date", (q) =>
            q.eq("mediaType", mediaType).gte("date", startDate).lte("date", endDate)
          )
          .collect()
      )
    )
  ).flat();

  let rowsUpdated = 0;
  for (const row of rows) {
    const existingEntries = parseCompactScheduleEntries(row.episodes);
    const entries = existingEntries.filter((entry) => {
      const isDurableSameShow = args.durableRouteProviderShowIds.has(entry.showId);
      const isExactTitleMatch =
        entry.normalizedTitle === args.normalizedTitle &&
        args.normalizedTitle.length > 0;
      const isSeasonTitleVariantMatch =
        args.normalizedTitle.length > 0 &&
        isAnimeSeasonTitleVariant(entry.normalizedTitle, args.normalizedTitle);
      const isTrustedTitleMatch = isExactTitleMatch || isSeasonTitleVariantMatch;

      if (!isDurableSameShow && !isTrustedTitleMatch) {
        return true;
      }

      const episodeNumberKey = `${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
      if (
        isTrustedTitleMatch &&
        typeof args.totalEpisodes === "number" &&
        entry.episode.episodeNumber > args.totalEpisodes
      ) {
        return false;
      }

      const desiredNumberDates = desiredDatesByEpisodeNumber.get(episodeNumberKey);
      if (isDurableSameShow && desiredNumberDates && !desiredNumberDates.has(row.date)) {
        return false;
      }
      if (isTrustedTitleMatch && desiredNumberDates && !desiredNumberDates.has(row.date)) {
        return false;
      }

      const episodeNameKey = normalizeTitle(entry.episode.name ?? "");
      const desiredNameDates = episodeNameKey
        ? desiredDatesByEpisodeName.get(episodeNameKey)
        : undefined;
      if (isDurableSameShow && desiredNameDates && !desiredNameDates.has(row.date)) {
        return false;
      }
      if (isTrustedTitleMatch && desiredNameDates && !desiredNameDates.has(row.date)) {
        return false;
      }

      return true;
    });

    if (entries.length === existingEntries.length) {
      continue;
    }

    await ctx.db.patch(row._id, {
      episodes: serializeCompactScheduleEntries(entries),
      lastUpdated: Date.now(),
    });
    rowsUpdated += 1;
  }

  return rowsUpdated;
}

async function pruneStaleScheduleCacheProviderEntries(
  ctx: MutationCtx,
  delta: {
    mediaType: "tv" | "anime" | "movie";
    providerIds: {
      tvmazeId?: number;
      anilistId?: number;
      malId?: number;
      tmdbId?: number;
      imdbId?: string;
    };
  },
  prunes: Array<{
    sourceProvider: string;
    providerShowId: string;
    episodes: Array<{
      seasonNumber: number;
      episodeNumber: number;
    }>;
  }>,
  generatedAt: number
) {
  const mediaType = delta.mediaType;
  if (mediaType === "movie" || prunes.length === 0) {
    return 0;
  }

  const staleEpisodeKeys = new Set<string>();
  for (const prune of prunes) {
    for (const episode of prune.episodes) {
      if (
        Number.isFinite(episode.seasonNumber) &&
        Number.isFinite(episode.episodeNumber)
      ) {
        staleEpisodeKeys.add(`${episode.seasonNumber}:${episode.episodeNumber}`);
      }
    }
  }
  if (staleEpisodeKeys.size === 0) {
    return 0;
  }

  const routeProviderShowIds = getScheduleCacheProviderPruneShowIds(delta);
  if (routeProviderShowIds.size === 0) {
    return 0;
  }

  const generatedDate = new Date(generatedAt);
  if (!Number.isFinite(generatedDate.getTime())) {
    return 0;
  }
  const todayKey = generatedDate.toISOString().slice(0, 10);
  const startDate = addDaysToDateKey(todayKey, -STALE_PROVIDER_PRUNE_PAST_DAYS);
  const endDate = addDaysToDateKey(todayKey, STALE_PROVIDER_PRUNE_FUTURE_DAYS);
  const rows = await ctx.db
    .query("scheduleCache")
    .withIndex("by_type_date", (q) =>
      q.eq("mediaType", mediaType).gte("date", startDate).lte("date", endDate)
    )
    .collect();

  let rowsUpdated = 0;
  for (const row of rows) {
    const existingEntries = parseCompactScheduleEntries(row.episodes);
    const entries = existingEntries.filter((entry) => {
      if (!routeProviderShowIds.has(entry.showId)) {
        return true;
      }
      const episodeKey = `${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
      return !staleEpisodeKeys.has(episodeKey);
    });

    if (entries.length === existingEntries.length) {
      continue;
    }

    await ctx.db.patch(row._id, {
      episodes: serializeCompactScheduleEntries(entries),
      lastUpdated: Date.now(),
    });
    rowsUpdated += 1;
  }

  return rowsUpdated;
}

async function upsertScheduleCacheEntry(
  ctx: MutationCtx,
  delta: {
    title: string;
    mediaType: "tv" | "anime" | "movie";
    providerIds: {
      tvmazeId?: number;
      anilistId?: number;
      malId?: number;
      tmdbId?: number;
      imdbId?: string;
    };
    latestReleased?: {
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    };
    totalEpisodes?: number;
    nextScheduled?: {
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    };
    upcomingEpisodes?: Array<{
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    }>;
  }
) {
  if (delta.mediaType === "movie") {
    return { updated: 0, skippedUnchanged: 0 };
  }
  const mediaType = delta.mediaType;
  const showId = getRouteProviderShowId(delta);
  const routeProviderShowIds = getRouteProviderShowIds(delta);
  const durableRouteProviderShowIds = getDurableRouteProviderShowIds(delta);
  const normalizedTitle = normalizeTitle(delta.title);

  const upcomingFacts =
    delta.upcomingEpisodes && delta.upcomingEpisodes.length > 0
      ? delta.upcomingEpisodes
      : delta.nextScheduled
        ? [delta.nextScheduled]
        : [];
  const facts = [delta.latestReleased, ...upcomingFacts].filter(
    (fact): fact is {
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    } => Boolean(fact)
  );
  let rowsUpdated = 0;
  let skippedUnchanged = 0;
  const factsByDate = new Map<
    string,
    Array<{
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    }>
  >();

  for (const fact of facts) {
    const date = parseDateKey(fact.airDate);
    if (!date) {
      continue;
    }
    const existing = factsByDate.get(date) ?? [];
    const episodeKey = `${fact.seasonNumber}:${fact.episodeNumber}`;
    const alreadyQueued = existing.some(
      (queued) => `${queued.seasonNumber}:${queued.episodeNumber}` === episodeKey
    );
    if (!alreadyQueued) {
      existing.push(fact);
      factsByDate.set(date, existing);
    }
  }

  rowsUpdated += await pruneMovedScheduleCacheEntries(ctx, {
    mediaType,
    normalizedTitle,
    totalEpisodes: delta.totalEpisodes,
    durableRouteProviderShowIds,
    factsByDate,
  });

  for (const [date, dateFacts] of factsByDate) {
    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date_type", (q) => q.eq("date", date).eq("mediaType", mediaType))
      .collect();
    const [row, ...duplicates] = rows;
    const existingEntries = row ? parseCompactScheduleEntries(row.episodes) : [];
    const desiredEntries = dateFacts.map((fact) => ({
      showId,
      normalizedTitle,
      episode: {
        seasonNumber: fact.seasonNumber,
        episodeNumber: fact.episodeNumber,
        ...(fact.name ? { name: fact.name } : {}),
        ...(fact.airDate ? { airDate: fact.airDate } : {}),
      },
    }));
    const desiredEpisodeNumbers = new Set(
      desiredEntries.map(
        (entry) => `${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`
      )
    );
    const desiredEpisodeNames = new Set(
      desiredEntries
        .map((entry) => normalizeTitle(entry.episode.name ?? ""))
        .filter(Boolean)
    );
    const entries = existingEntries.filter((entry) => {
      const entryEpisodeNumber = `${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
      const entryEpisodeName = normalizeTitle(entry.episode.name ?? "");
      const sameNumber =
        routeProviderShowIds.has(entry.showId) &&
        desiredEpisodeNumbers.has(entryEpisodeNumber);
      const sameTitleEpisodeNumber =
        entry.normalizedTitle === normalizedTitle &&
        desiredEpisodeNumbers.has(entryEpisodeNumber);
      const sameNamedEpisode =
        entry.normalizedTitle === normalizedTitle &&
        entryEpisodeName.length > 0 &&
        desiredEpisodeNames.has(entryEpisodeName);
      const staleSameShowSameDate =
        (routeProviderShowIds.has(entry.showId) ||
          entry.normalizedTitle === normalizedTitle) &&
        !desiredEpisodeNumbers.has(entryEpisodeNumber) &&
        (!entryEpisodeName || !desiredEpisodeNames.has(entryEpisodeName));

      return (
        !sameNumber &&
        !sameTitleEpisodeNumber &&
        !sameNamedEpisode &&
        !staleSameShowSameDate
      );
    });
    entries.push(...desiredEntries);
    const nextEpisodes = serializeCompactScheduleEntries(entries);

    const payload = {
      date,
      mediaType,
      episodes: nextEpisodes,
      lastUpdated: Date.now(),
    };

    if (row) {
      if (row.episodes === nextEpisodes) {
        skippedUnchanged += 1;
      } else {
        await ctx.db.patch(row._id, payload);
        rowsUpdated += 1;
      }
      for (const duplicate of duplicates) {
        await ctx.db.delete(duplicate._id);
        rowsUpdated += 1;
      }
      continue;
    }

    await ctx.db.insert("scheduleCache", payload);
    rowsUpdated += 1;
  }

  return { updated: rowsUpdated, skippedUnchanged };
}

function serializeCompactScheduleEntries(
  entries: Array<{
    showId: string;
    normalizedTitle: string;
    episode: {
      seasonNumber: number;
      episodeNumber: number;
      name?: string;
      airDate?: string;
    };
  }>
) {
  const stableEntries = [...entries].sort((a, b) =>
    [
      a.showId,
      a.normalizedTitle,
      a.episode.seasonNumber,
      a.episode.episodeNumber,
      a.episode.name ?? "",
      a.episode.airDate ?? "",
    ]
      .join(":")
      .localeCompare(
        [
          b.showId,
          b.normalizedTitle,
          b.episode.seasonNumber,
          b.episode.episodeNumber,
          b.episode.name ?? "",
          b.episode.airDate ?? "",
        ].join(":")
      )
  );
  return JSON.stringify(stableEntries);
}

function parseCompactScheduleEntries(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is {
            showId: string;
            normalizedTitle: string;
            episode: {
              seasonNumber: number;
              episodeNumber: number;
              name?: string;
              airDate?: string;
            };
          } =>
            !!entry &&
            typeof entry.showId === "string" &&
            typeof entry.normalizedTitle === "string" &&
            typeof entry.episode?.seasonNumber === "number" &&
            typeof entry.episode?.episodeNumber === "number"
        )
      : [];
  } catch {
    return [];
  }
}

export const exportTrackedLibrary = query({
  args: {
    importToken: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const page = await ctx.db.query("feedProjections").paginate({
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, IMPORT_BATCH_LIMIT),
    });
    const shows = await Promise.all(
      page.page.map((projection) => ctx.db.get(projection.showId))
    );
    const watchedEpisodeAnchors = await Promise.all(
      page.page.map(async (projection) => {
        if (projection.mediaType !== "tv" && projection.mediaType !== "anime") {
          return [];
        }

        const rows = await ctx.db
          .query("watchedEpisodes")
          .withIndex("by_user_show_season_episode", (q) =>
            q.eq("userId", projection.userId).eq("showId", projection.showId)
          )
          .order("desc")
          .take(WATCHED_EPISODE_ANCHOR_LIMIT);

        return rows.map((row) => ({
          season: row.season,
          episode: row.episode,
        }));
      })
    );
    const showStatusById = new Map(
      page.page.map((projection, index) => [
        projection.showId,
        shows[index]?.status ?? null,
      ])
    );

    return {
      ...page,
      page: page.page.map((projection, index) => ({
        projectionId: projection._id,
        userId: projection.userId,
        showId: projection.showId,
        userShowId: projection.userShowId,
        title: projection.title,
        mediaType: projection.mediaType,
        posterUrl: projection.posterUrl ?? null,
        status: projection.status,
        showStatus: showStatusById.get(projection.showId) ?? null,
        watchedEpisodesCount: projection.watchedEpisodesCount,
        watchedEpisodeAnchors: watchedEpisodeAnchors[index],
        totalEpisodes: projection.totalEpisodes ?? null,
        remainingEpisodes: projection.remainingEpisodes ?? null,
        tmdbId: projection.tmdbId ?? null,
        tvmazeId: projection.tvmazeId ?? null,
        anilistId: projection.anilistId ?? null,
        malId: projection.malId ?? null,
        imdbId: projection.imdbId ?? null,
        firstAired: projection.firstAired ?? null,
        lastWatchedAt: projection.lastWatchedAt,
        newEpisodeSignalAt: projection.newEpisodeSignalAt ?? null,
      })),
    };
  },
});

export const exportScheduleCacheWindow = query({
  args: {
    importToken: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    assertProjectionWindow(args.startDate, args.endDate, "schedule cache export");

    const page = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) =>
        q.gte("date", args.startDate).lte("date", args.endDate)
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, IMPORT_BATCH_LIMIT),
      });

    return {
      ...page,
      page: page.page.map((row) => ({
        date: row.date,
        mediaType: row.mediaType,
        episodes: row.episodes,
        lastUpdated: row.lastUpdated,
      })),
    };
  },
});

async function getLatestFeedProjectionUpdatedAt(
  ctx: QueryCtx,
  userId: Id<"users">,
  mediaFilter?: "tv" | "anime"
) {
  if (mediaFilter) {
    const projection = await ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_updatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", mediaFilter)
      )
      .order("desc")
      .first();
    return projection?.updatedAt ?? 0;
  }

  const [tvProjection, animeProjection] = await Promise.all([
    ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_updatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", "tv")
      )
      .order("desc")
      .first(),
    ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_updatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", "anime")
      )
      .order("desc")
      .first(),
  ]);

  return Math.max(tvProjection?.updatedAt ?? 0, animeProjection?.updatedAt ?? 0);
}

async function getLatestScheduleProjectionUpdatedAt(
  ctx: QueryCtx,
  userId: Id<"users">,
  mediaFilter?: "tv" | "anime"
) {
  if (mediaFilter) {
    const projection = await ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_scheduleProjectionUpdatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", mediaFilter)
      )
      .order("desc")
      .first();
    return projection?.scheduleProjectionUpdatedAt ?? 0;
  }

  const [tvProjection, animeProjection] = await Promise.all([
    ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_scheduleProjectionUpdatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", "tv")
      )
      .order("desc")
      .first(),
    ctx.db
      .query("feedProjections")
      .withIndex("by_user_media_scheduleProjectionUpdatedAt", (q) =>
        q.eq("userId", userId).eq("mediaType", "anime")
      )
      .order("desc")
      .first(),
  ]);

  return Math.max(
    tvProjection?.scheduleProjectionUpdatedAt ?? 0,
    animeProjection?.scheduleProjectionUpdatedAt ?? 0
  );
}

async function getProjectedScheduleEventRows(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: "tv" | "anime";
  }
) {
  if (args.mediaFilter) {
    return ctx.db
      .query("userScheduleEvents")
      .withIndex("by_user_media_date", (q) =>
        q
          .eq("userId", args.userId)
          .eq("mediaType", args.mediaFilter!)
          .gte("date", args.startDate)
          .lte("date", args.endDate)
      )
      .collect();
  }

  return ctx.db
    .query("userScheduleEvents")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", args.userId).gte("date", args.startDate).lte("date", args.endDate)
    )
    .collect();
}

export const getScheduleProjectionDiagnostics = query({
  args: {
    importToken: v.string(),
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    mediaFilter: scheduleMediaFilterValidator,
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    assertProjectionWindow(args.startDate, args.endDate, "schedule diagnostics");

    const windows = await ctx.db
      .query("userScheduleProjectionWindows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const coveredWindow =
      windows
        .filter(
          (window) =>
            window.scheduleStartDate <= args.startDate &&
            window.scheduleEndDate >= args.endDate
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const [latestScheduleProjectionUpdatedAt, latestFeedProjectionUpdatedAt] =
      await Promise.all([
        getLatestScheduleProjectionUpdatedAt(ctx, args.userId, args.mediaFilter),
        getLatestFeedProjectionUpdatedAt(ctx, args.userId, args.mediaFilter),
      ]);
    const reason = !coveredWindow
      ? windows.length === 0
        ? "missing_window"
        : "outside_window"
      : latestScheduleProjectionUpdatedAt > coveredWindow.projectionUpdatedAt
        ? "stale_schedule_identity"
        : "active";
    const rows = await getProjectedScheduleEventRows(ctx, {
      userId: args.userId,
      startDate: args.startDate,
      endDate: args.endDate,
      mediaFilter: args.mediaFilter,
    });
    const projectionIds = Array.from(new Set(rows.map((row) => row.feedProjectionId)));
    const projections = await Promise.all(
      projectionIds.map((projectionId) => ctx.db.get(projectionId))
    );
    const currentProjectionIds = new Set(
      projections
        .filter(
          (projection): projection is Doc<"feedProjections"> =>
            !!projection && projection.userId === args.userId
        )
        .map((projection) => projection._id)
    );

    return {
      active: reason === "active",
      reason,
      queryPath: reason === "active" ? "projection" : "fallback",
      requestedStartDate: args.startDate,
      requestedEndDate: args.endDate,
      mediaFilter: args.mediaFilter ?? "all",
      latestScheduleProjectionUpdatedAt,
      latestFeedProjectionUpdatedAt,
      windowCount: windows.length,
      coveredWindow: coveredWindow
        ? {
            scheduleStartDate: coveredWindow.scheduleStartDate,
            scheduleEndDate: coveredWindow.scheduleEndDate,
            countWindowStartDate: coveredWindow.countWindowStartDate,
            countWindowEndDate: coveredWindow.countWindowEndDate,
            generatedAt: coveredWindow.generatedAt,
            projectionUpdatedAt: coveredWindow.projectionUpdatedAt,
            eventCount: coveredWindow.eventCount,
            countRowCount: coveredWindow.countRowCount,
            runId: coveredWindow.runId,
          }
        : null,
      projectedRowsInRange: rows.length,
      currentProjectedRowsInRange: rows.filter((row) =>
        currentProjectionIds.has(row.feedProjectionId)
      ).length,
    };
  },
});

export const replaceUserScheduleProjectionWindow = mutation({
  args: {
    importToken: v.string(),
    runId: v.string(),
    generatedAt: v.number(),
    userId: v.id("users"),
    scheduleStartDate: v.string(),
    scheduleEndDate: v.string(),
    countWindowStartDate: v.string(),
    countWindowEndDate: v.string(),
    events: v.array(scheduleProjectionEventValidator),
    counts: v.array(watchlistFutureCountProjectionValidator),
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    assertProjectionWindow(args.scheduleStartDate, args.scheduleEndDate, "schedule");
    assertProjectionWindow(args.countWindowStartDate, args.countWindowEndDate, "count");

    if (args.events.length > SCHEDULE_PROJECTION_EVENT_LIMIT) {
      throw new Error(
        `Apply at most ${SCHEDULE_PROJECTION_EVENT_LIMIT} schedule projection events per user.`
      );
    }
    if (args.counts.length > SCHEDULE_PROJECTION_COUNT_LIMIT) {
      throw new Error(
        `Apply at most ${SCHEDULE_PROJECTION_COUNT_LIMIT} future count projection rows per user.`
      );
    }

    let projectionUpdatedAt = args.generatedAt;
    for (const event of args.events) {
      if (!parseStrictDateKey(event.date)) {
        throw new Error(`Invalid schedule projection event date: ${event.date}`);
      }
      if (event.date < args.scheduleStartDate || event.date > args.scheduleEndDate) {
        throw new Error(`Schedule projection event date is outside the generated window.`);
      }
      if (!event.routeId.trim()) {
        throw new Error("Schedule projection event routeId cannot be empty.");
      }
      if (!Number.isFinite(event.airtimeMs)) {
        throw new Error("Schedule projection event airtimeMs must be finite.");
      }
      if (!Number.isFinite(event.seasonNumber) || !Number.isFinite(event.episodeNumber)) {
        throw new Error("Schedule projection event episode numbers must be finite.");
      }
      projectionUpdatedAt = Math.max(projectionUpdatedAt, event.projectionUpdatedAt);
    }

    for (const count of args.counts) {
      if (!count.routeId.trim()) {
        throw new Error("Future count projection routeId cannot be empty.");
      }
      for (const value of [
        count.availableCount,
        count.futureCount,
        count.unavailableCount,
      ]) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("Future count projection counts must be non-negative finite numbers.");
        }
      }
      projectionUpdatedAt = Math.max(projectionUpdatedAt, count.projectionUpdatedAt);
    }

    const existingEvents = await ctx.db
      .query("userScheduleEvents")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of existingEvents) {
      await ctx.db.delete(row._id);
    }

    const existingCounts = await ctx.db
      .query("watchlistFutureCountProjections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of existingCounts) {
      await ctx.db.delete(row._id);
    }

    const existingWindows = await ctx.db
      .query("userScheduleProjectionWindows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of existingWindows) {
      await ctx.db.delete(row._id);
    }

    for (const event of args.events) {
      await ctx.db.insert("userScheduleEvents", {
        userId: args.userId,
        ...event,
      });
    }

    for (const count of args.counts) {
      await ctx.db.insert("watchlistFutureCountProjections", {
        userId: args.userId,
        windowStartDate: args.countWindowStartDate,
        windowEndDate: args.countWindowEndDate,
        ...count,
      });
    }

    await ctx.db.insert("userScheduleProjectionWindows", {
      userId: args.userId,
      scheduleStartDate: args.scheduleStartDate,
      scheduleEndDate: args.scheduleEndDate,
      countWindowStartDate: args.countWindowStartDate,
      countWindowEndDate: args.countWindowEndDate,
      runId: args.runId,
      generatedAt: args.generatedAt,
      projectionUpdatedAt,
      eventCount: args.events.length,
      countRowCount: args.counts.length,
      updatedAt: Date.now(),
    });

    return {
      runId: args.runId,
      userId: args.userId,
      deletedEvents: existingEvents.length,
      deletedCounts: existingCounts.length,
      deletedWindows: existingWindows.length,
      insertedEvents: args.events.length,
      insertedCounts: args.counts.length,
      scheduleStartDate: args.scheduleStartDate,
      scheduleEndDate: args.scheduleEndDate,
      countWindowStartDate: args.countWindowStartDate,
      countWindowEndDate: args.countWindowEndDate,
    };
  },
});

export const applyReleaseDeltas = mutation({
  args: {
    importToken: v.string(),
    runId: v.string(),
    generatedAt: v.number(),
    deltas: v.array(releaseDeltaValidator),
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    if (args.deltas.length > APPLY_DELTA_LIMIT) {
      throw new Error(`Apply at most ${APPLY_DELTA_LIMIT} release deltas per call.`);
    }

    const result = {
      runId: args.runId,
      generatedAt: args.generatedAt,
      scanned: args.deltas.length,
      matchedShows: 0,
      missingShows: 0,
      patchedShows: 0,
      patchedUserShows: 0,
      patchedFeedProjections: 0,
      resumedCompletedShows: 0,
      resumedAutoPausedShows: 0,
      clearedStaleEpisodeSignals: 0,
      repairedStaleProjections: 0,
      repairedTrackingAggregates: 0,
      scheduleCacheRowsUpdated: 0,
      scheduleCacheRowsSkipped: 0,
      skippedTitleFallback: 0,
      skippedUnchangedShows: 0,
      skippedUnchangedUserShows: 0,
      skippedUnchangedFeedProjections: 0,
    };

    for (const delta of args.deltas) {
      if (delta.matchConfidence === "title_fallback") {
        result.skippedTitleFallback += 1;
        continue;
      }

      let scheduleCacheAlreadyMaintained = false;
      if (
        delta.scheduleCacheProviderPrunes &&
        delta.scheduleCacheProviderPrunes.length > 0
      ) {
        const prunedRows = await pruneStaleScheduleCacheProviderEntries(
          ctx,
          delta,
          delta.scheduleCacheProviderPrunes,
          args.generatedAt
        );
        result.scheduleCacheRowsUpdated += prunedRows;
        scheduleCacheAlreadyMaintained = prunedRows > 0;
      }
      if (delta.scheduleCacheMaintenance === true) {
        const scheduleCacheResult = await upsertScheduleCacheEntry(ctx, delta);
        result.scheduleCacheRowsUpdated += scheduleCacheResult.updated;
        result.scheduleCacheRowsSkipped += scheduleCacheResult.skippedUnchanged;
        scheduleCacheAlreadyMaintained = true;
      }

      const show = await findShowByProviderIds(ctx, delta);
      if (!show) {
        if (!scheduleCacheAlreadyMaintained) {
          result.missingShows += 1;
        }
        continue;
      }
      result.matchedShows += 1;

      const showPatch: Partial<Doc<"shows">> = {};
      const releasedEpisodes = clampOptionalCount(delta.releasedEpisodes);
      const totalEpisodes = clampOptionalCount(delta.totalEpisodes);
      if (typeof releasedEpisodes === "number") {
        const cappedReleasedEpisodes =
          typeof totalEpisodes === "number"
            ? Math.min(releasedEpisodes, totalEpisodes)
            : releasedEpisodes;
        setChangedField(showPatch, show, "releasedEpisodes", cappedReleasedEpisodes);
      }
      if (typeof totalEpisodes === "number") {
        setChangedField(showPatch, show, "totalEpisodes", totalEpisodes);
      }
      if (
        typeof delta.providerIds.tvmazeId === "number" &&
        typeof show.tvmazeId !== "number"
      ) {
        showPatch.tvmazeId = delta.providerIds.tvmazeId;
      }
      if (
        typeof delta.providerIds.imdbId === "string" &&
        typeof show.imdbId !== "string"
      ) {
        showPatch.imdbId = delta.providerIds.imdbId;
      }

      if (Object.keys(showPatch).length > 0) {
        showPatch.lastUpdated = Math.max(show.lastUpdated ?? 0, delta.reconciledAt);
        await ctx.db.patch(show._id, showPatch);
        result.patchedShows += 1;
      } else {
        result.skippedUnchangedShows += 1;
      }
      const patchedShow = { ...show, ...showPatch };
      const shouldRepairTrackingAggregates =
        shouldRepairTrackingAggregatesForShowPatch(show, patchedShow);

      if (!scheduleCacheAlreadyMaintained) {
        const scheduleCacheResult = await upsertScheduleCacheEntry(ctx, delta);
        result.scheduleCacheRowsUpdated += scheduleCacheResult.updated;
        result.scheduleCacheRowsSkipped += scheduleCacheResult.skippedUnchanged;
      }

      const signalAt = delta.latestReleased
        ? getEpisodeSignalAt(delta.latestReleased)
        : null;
      const shouldVisitUserShows =
        Object.keys(showPatch).length > 0 ||
        delta.clearStaleEpisodeSignal === true ||
        Boolean(delta.projectionRepair) ||
        delta.releaseState === "available_now";

      if (!shouldVisitUserShows) {
        continue;
      }

      const userShows = await ctx.db
        .query("userShows")
        .withIndex("by_showId", (q) => q.eq("showId", show._id))
        .take(1000);

      for (const userShow of userShows) {
        const userPatch: Partial<Doc<"userShows">> = {};
        const trackingAggregate = shouldRepairTrackingAggregates
          ? await computeTrackingAggregatesForUserShow(ctx, userShow, patchedShow)
          : null;

        if (
          trackingAggregate &&
          addTrackingAggregatePatch(userPatch, userShow, trackingAggregate)
        ) {
          result.repairedTrackingAggregates += 1;
        }

        const watchedCount =
          trackingAggregate?.watchedEpisodesCount ??
          Math.max(0, Math.floor(userShow.watchedEpisodesCount ?? 0));
        const lastWatchedAt =
          trackingAggregate?.lastWatchedAt ?? userShow.lastWatchedAt;
        const hasReleasedUnwatched =
          typeof releasedEpisodes === "number" && watchedCount < releasedEpisodes;

        if (hasReleasedUnwatched && signalAt !== null) {
          const nextSignalAt = Math.max(
            userShow.newEpisodeSignalAt ?? 0,
            signalAt
          );
          setChangedField(userPatch, userShow, "newEpisodeSignalAt", nextSignalAt);
          if (userShow.status === "completed") {
            userPatch.status = watchedCount > 0 ? "watching" : "plan_to_watch";
            userPatch.completedAt = undefined;
            userPatch.autoPausedAt = undefined;
            userPatch.droppedAt = undefined;
            userPatch.statusChangedAt = args.generatedAt;
            result.resumedCompletedShows += 1;
          } else if (
            userShow.status === "paused" &&
            typeof userShow.autoPausedAt === "number"
          ) {
            userPatch.status = watchedCount > 0 ? "watching" : "plan_to_watch";
            userPatch.completedAt = undefined;
            userPatch.autoPausedAt = undefined;
            userPatch.droppedAt = undefined;
            userPatch.statusChangedAt = args.generatedAt;
            result.resumedAutoPausedShows += 1;
          }
        } else if (
          delta.clearStaleEpisodeSignal === true &&
          typeof releasedEpisodes === "number" &&
          watchedCount >= releasedEpisodes &&
          typeof userShow.newEpisodeSignalAt === "number" &&
          userShow.newEpisodeSignalAt > (lastWatchedAt ?? userShow.addedAt ?? 0)
        ) {
          setChangedField(userPatch, userShow, "newEpisodeSignalAt", undefined);
          result.clearedStaleEpisodeSignals += 1;
        }

        if (trackingAggregate) {
          const cleared = maybeClearCaughtUpSignalFromAggregate(
            userPatch,
            userShow,
            patchedShow,
            trackingAggregate
          );
          if (cleared) {
            result.clearedStaleEpisodeSignals += 1;
          }
        }

        if (Object.keys(userPatch).length > 0) {
          await ctx.db.patch(userShow._id, userPatch);
          result.patchedUserShows += 1;
        } else {
          result.skippedUnchangedUserShows += 1;
        }

        const patchedUserShow = { ...userShow, ...userPatch };
        const projectionPatched = await patchProjectionForUserShow(
          ctx,
          patchedUserShow,
          patchedShow
        );
        if (projectionPatched) {
          result.patchedFeedProjections += 1;
          if (delta.projectionRepair) {
            result.repairedStaleProjections += 1;
          }
        } else {
          result.skippedUnchangedFeedProjections += 1;
        }
      }
    }

    return result;
  },
});

export const repairTrackingAggregatesForShow = mutation({
  args: {
    importToken: v.string(),
    mediaType: mediaTypeValidator,
    providerIds: providerIdsValidator,
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);

    const show = await findShowByProviderIds(ctx, {
      mediaType: args.mediaType,
      providerIds: args.providerIds,
    });
    if (!show) {
      return {
        matchedShow: false,
        scannedUserShows: 0,
        patchedUserShows: 0,
        repairedTrackingAggregates: 0,
        clearedStaleEpisodeSignals: 0,
        patchedFeedProjections: 0,
      };
    }

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_showId", (q) => q.eq("showId", show._id))
      .take(1000);

    const result = {
      matchedShow: true,
      showId: show._id,
      scannedUserShows: userShows.length,
      patchedUserShows: 0,
      repairedTrackingAggregates: 0,
      clearedStaleEpisodeSignals: 0,
      patchedFeedProjections: 0,
    };

    for (const userShow of userShows) {
      const aggregate = await computeTrackingAggregatesForUserShow(
        ctx,
        userShow,
        show
      );
      const userPatch: Partial<Doc<"userShows">> = {};

      if (addTrackingAggregatePatch(userPatch, userShow, aggregate)) {
        result.repairedTrackingAggregates += 1;
      }

      if (
        maybeClearCaughtUpSignalFromAggregate(
          userPatch,
          userShow,
          show,
          aggregate
        )
      ) {
        result.clearedStaleEpisodeSignals += 1;
      }

      if (Object.keys(userPatch).length > 0) {
        await ctx.db.patch(userShow._id, userPatch);
        result.patchedUserShows += 1;
      }

      const projectionPatched = await patchProjectionForUserShow(
        ctx,
        { ...userShow, ...userPatch },
        show
      );
      if (projectionPatched) {
        result.patchedFeedProjections += 1;
      }
    }

    return result;
  },
});

export const cleanupSyntheticDevCases = mutation({
  args: {
    importToken: v.string(),
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    return deleteSyntheticRows(ctx);
  },
});

export const seedSyntheticDevCases = mutation({
  args: {
    importToken: v.string(),
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const cleanup = args.reset ? await deleteSyntheticRows(ctx) : null;
    const userId = await findSyntheticUserId(ctx);
    if (!userId) {
      throw new Error("Cannot seed synthetic cases without an existing dev user.");
    }

    const created: Array<{
      key: string;
      showId: Id<"shows">;
      userShowId: Id<"userShows">;
      title: string;
      status: string;
      watchedEpisodesCount: number;
      totalEpisodes: number;
      releasedEpisodes: number;
    }> = [];

    for (const entry of syntheticCases) {
      const now = Date.now();
      const showId = await ctx.db.insert("shows", {
        title: entry.title,
        titleLower: syntheticTitleLower(entry.title),
        mediaType: entry.mediaType,
        tmdbId: entry.tmdbId,
        tvmazeId: entry.tvmazeId,
        anilistId: entry.anilistId,
        malId: entry.malId,
        imdbId: entry.imdbId,
        firstAired: entry.firstAired,
        status: entry.status === "completed" ? "ended" : "returning",
        totalEpisodes: entry.totalEpisodes,
        releasedEpisodes: entry.releasedEpisodes,
        totalSeasons: 1,
        lastUpdated: now,
      });

      const userShowId = await ctx.db.insert("userShows", {
        userId,
        showId,
        status: entry.status,
        mediaType: entry.mediaType,
        addedAt: entry.lastWatchedAt,
        lastWatchedAt: entry.lastWatchedAt,
        watchedEpisodesCount: entry.watchedEpisodesCount,
        watchedTotalCount: entry.watchedEpisodesCount,
        watchedRuntimeMinutes: entry.watchedEpisodesCount * 45,
        statusChangedAt: entry.lastWatchedAt,
        completedAt: entry.status === "completed" ? entry.lastWatchedAt : undefined,
        newEpisodeSignalAt: entry.newEpisodeSignalAt,
      });

      for (let episode = 1; episode <= entry.watchedEpisodesCount; episode += 1) {
        await ctx.db.insert("watchedEpisodes", {
          userId,
          showId,
          season: 1,
          episode,
          watchedAt: entry.lastWatchedAt + episode,
          runtime: 45,
          watchCount: 1,
          watchHistory: [entry.lastWatchedAt + episode],
        });
      }

      const show = await ctx.db.get(showId);
      const userShow = await ctx.db.get(userShowId);
      if (!show || !userShow) {
        throw new Error(`Failed to read seeded synthetic case ${entry.key}`);
      }
      await patchProjectionForUserShow(ctx, userShow, show);

      if (entry.key === "stale_projection") {
        const projection = await ctx.db
          .query("feedProjections")
          .withIndex("by_userShow", (q) => q.eq("userShowId", userShow._id))
          .unique();
        if (projection) {
          await ctx.db.patch(projection._id, {
            totalEpisodes: 20,
            remainingEpisodes: 0,
            updatedAt: now,
          });
        }
      }

      if (entry.key === "future" && typeof entry.anilistId === "number") {
        await upsertSyntheticScheduleCacheEntry(ctx, {
          date: "2026-05-15",
          mediaType: "anime",
          showId: `anilist:${entry.anilistId}`,
          normalizedTitle: normalizeTitle(entry.title),
          episode: {
            seasonNumber: 1,
            episodeNumber: 11,
            name: "Episode 11",
            airDate: "2026-05-15T09:00:00.000Z",
          },
        });
      }

      if (entry.key === "stale_future_signal") {
        await upsertSyntheticScheduleCacheEntry(ctx, {
          date: "2026-05-16",
          mediaType: "anime",
          showId: "anilist:999010",
          normalizedTitle: normalizeTitle(entry.title),
          episode: {
            seasonNumber: 1,
            episodeNumber: 1202,
            name: "Break Week Return",
            airDate: "2026-05-16T09:00:00.000Z",
          },
        });
        await upsertSyntheticScheduleCacheEntry(ctx, {
          date: "2026-05-23",
          mediaType: "anime",
          showId: "anilist:999010",
          normalizedTitle: normalizeTitle(entry.title),
          episode: {
            seasonNumber: 1,
            episodeNumber: 1203,
            name: "Episode 1203",
            airDate: "2026-05-23T09:00:00.000Z",
          },
        });
      }

      created.push({
        key: entry.key,
        showId,
        userShowId,
        title: entry.title,
        status: entry.status,
        watchedEpisodesCount: entry.watchedEpisodesCount,
        totalEpisodes: entry.totalEpisodes,
        releasedEpisodes: entry.releasedEpisodes,
      });
    }

    return {
      cleanup,
      userId,
      created,
    };
  },
});

export const getSyntheticDevCaseState = query({
  args: {
    importToken: v.string(),
  },
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const shows = (await ctx.db.query("shows").take(2000))
      .filter((show) => show.title.startsWith(SYNTHETIC_PREFIX))
      .sort((a, b) => a.title.localeCompare(b.title));
    const scheduleEntriesByNormalizedTitle = new Map<
      string,
      Array<{
        date: string;
        mediaType: "tv" | "anime";
        showId: string;
        seasonNumber: number;
        episodeNumber: number;
        airDate: string | null;
      }>
    >();

    for (const date of SYNTHETIC_SCHEDULE_CACHE_DATES) {
      const cacheRows = await ctx.db
        .query("scheduleCache")
        .withIndex("by_date", (q) => q.eq("date", date))
        .collect();
      for (const cacheRow of cacheRows) {
        for (const entry of parseCompactScheduleEntries(cacheRow.episodes)) {
          const rows = scheduleEntriesByNormalizedTitle.get(entry.normalizedTitle) ?? [];
          rows.push({
            date: cacheRow.date,
            mediaType: cacheRow.mediaType,
            showId: entry.showId,
            seasonNumber: entry.episode.seasonNumber,
            episodeNumber: entry.episode.episodeNumber,
            airDate: entry.episode.airDate ?? null,
          });
          scheduleEntriesByNormalizedTitle.set(entry.normalizedTitle, rows);
        }
      }
    }

    const rows = [];
    for (const show of shows) {
      const userShows = await ctx.db
        .query("userShows")
        .withIndex("by_showId", (q) => q.eq("showId", show._id))
        .collect();
      const watchedEpisodes =
        userShows.length > 0
          ? await ctx.db
              .query("watchedEpisodes")
              .withIndex("by_user_show", (q) =>
                q.eq("userId", userShows[0].userId).eq("showId", show._id)
              )
              .collect()
          : [];
      const projections = (await ctx.db.query("feedProjections").take(5000)).filter(
        (projection) => projection.showId === show._id
      );
      const normalizedTitle = normalizeTitle(show.title);
      const scheduleCacheEntries =
        scheduleEntriesByNormalizedTitle.get(normalizedTitle) ?? [];

      rows.push({
        showId: show._id,
        title: show.title,
        mediaType: show.mediaType,
        providerIds: {
          tmdbId: show.tmdbId ?? null,
          tvmazeId: show.tvmazeId ?? null,
          anilistId: show.anilistId ?? null,
          malId: show.malId ?? null,
          imdbId: show.imdbId ?? null,
        },
        totalEpisodes: show.totalEpisodes ?? null,
        releasedEpisodes: show.releasedEpisodes ?? null,
        watchedEpisodeRows: watchedEpisodes.length,
        scheduleCacheEntries,
        userShows: userShows.map((userShow) => ({
          userShowId: userShow._id,
          status: userShow.status,
          watchedEpisodesCount: userShow.watchedEpisodesCount ?? null,
          lastWatchedAt: userShow.lastWatchedAt ?? null,
          newEpisodeSignalAt: userShow.newEpisodeSignalAt ?? null,
          completedAt: userShow.completedAt ?? null,
        })),
        projections: projections.map((projection) => ({
          projectionId: projection._id,
          status: projection.status,
          watchedEpisodesCount: projection.watchedEpisodesCount,
          totalEpisodes: projection.totalEpisodes ?? null,
          remainingEpisodes: projection.remainingEpisodes ?? null,
          newEpisodeSignalAt: projection.newEpisodeSignalAt ?? null,
          homeSortAt: projection.homeSortAt ?? null,
        })),
      });
    }

    return {
      count: rows.length,
      rows,
    };
  },
});
