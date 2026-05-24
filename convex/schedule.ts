import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "@/convex/_generated/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "@/convex/_generated/server";
import { v } from "convex/values";
import { getAniListAiringSchedule } from "@/lib/api/anilist";
import {
  normalizeAniListScheduleEntry,
  normalizeTvMazeScheduleEntry,
} from "@/lib/api/normalize";
import type { NormalizedScheduleEntry } from "@/lib/api/types";
import { getTvMazeScheduleByDate } from "@/lib/api/tvmaze";
import { internal } from "@/convex/_generated/api";

const HYDRATE_BATCH_SIZE = 3;
const SCHEDULE_CACHE_FRESH_MS = 1000 * 60 * 60 * 6;
const MAX_ANILIST_SCHEDULE_PAGES = 8;
const ANILIST_SCHEDULE_RATE_LIMIT_COOLDOWN_MS = 90_000;
const ANILIST_SCHEDULE_RATE_LIMIT_KEY = "anilistSchedule";
const TVMAZE_SCHEDULE_RATE_LIMIT_PREFIX = "tvmazeSchedule";
const TVMAZE_SCHEDULE_RETRY_BASE_MS = 60_000;
const TVMAZE_SCHEDULE_RETRY_MAX_MS = 15 * 60_000;
const MAX_SCHEDULE_RANGE_DAYS = 120;
const HOME_SIGNAL_LOOKAHEAD_DAYS = 21;
const HOME_SIGNAL_PAST_CACHE_DAYS = 7;
const HOME_SIGNAL_MAX_MATCHES = 200;
const MONTHLY_SIGNAL_USER_PAGE_SIZE = 500;
const HOME_CACHED_SIGNAL_LOOKBACK_DAYS = 1;
const HOME_CACHED_SIGNAL_SYNC_BUCKET_MS = 1000 * 60 * 30;
const DAY_MS = 1000 * 60 * 60 * 24;

type DateCacheStatus = {
  tvCount: number;
  animeCount: number;
  hasFreshTv: boolean;
  hasFreshAnime: boolean;
};

type CompactScheduleEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
  airDate?: string;
};

type CompactScheduleEntry = {
  showId: string;
  normalizedTitle: string;
  episode: CompactScheduleEpisode;
};

type WatchlistFutureCountRow = {
  routeId: string;
  availableCount: number;
  futureCount: number;
  unavailableCount: number;
};

type ScheduleEpisodeNumberLike = {
  showId: Id<"shows">;
  seasonNumber: number;
  episodeNumber: number;
  episodeName?: string | null;
};

type ScheduledWatchlistItem = {
  id: string;
  title: string;
  mediaType: "tv" | "anime";
  posterUrl: string | null;
  tmdbId: number | null;
  anilistId: number | null;
  malId: number | null;
  tvmazeId: number | null;
  imdbId: string | null;
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
  isAutoTracked: boolean;
  trackingState: "not_started" | "in_progress" | "upcoming" | "tba";
  remainingEpisodes: number | null;
  watchedEpisodes: number;
  totalEpisodes: number | null;
  autoPausedAt?: number | null;
  lastWatchedAt?: number | null;
  newEpisodeSignalAt?: number | null;
};

type ScheduleMediaFilter = "tv" | "anime";

type ScheduleProjectionReason =
  | "active"
  | "missing_window"
  | "outside_window"
  | "stale_schedule_identity";

type ScheduleProjectionStatus = {
  active: boolean;
  reason: ScheduleProjectionReason;
  latestScheduleProjectionUpdatedAt: number;
  latestFeedProjectionUpdatedAt: number;
  window: Doc<"userScheduleProjectionWindows"> | null;
  windowCount: number;
};

type UpcomingScheduleEpisode = {
  routeId: string | null;
  showTitle: string;
  mediaType: "tv" | "anime";
  posterUrl?: string;
  daysUntil: number;
  episode: {
    seasonNumber: number;
    episodeNumber: number;
    name?: string;
    airDate?: string;
  };
};

type UpcomingScheduleGroup = {
  date: string;
  episodes: UpcomingScheduleEpisode[];
};

type HomeScheduleSignalMatch = {
  userShowId: Id<"userShows">;
  feedProjectionId: Id<"feedProjections">;
  signalAt: number;
  matchedEpisodes: number;
};

type HomeScheduleSignalCheck = {
  userShowId: Id<"userShows">;
  feedProjectionId: Id<"feedProjections">;
};

type HomeScheduleSignalEvaluation = {
  matches: HomeScheduleSignalMatch[];
  checked: HomeScheduleSignalCheck[];
};

type HomeScheduleSignalResult = {
  skipped: boolean;
  reason?:
    | "unauthenticated"
    | "already_ran_recently"
    | "already_ran_today"
    | "schedule_hydration_failed";
  hydratedDays?: number;
  refreshedDays?: number;
  failedHydrationDays?: number;
  matchedShows?: number;
  matchedEpisodes?: number;
  patchedUserShows?: number;
  patchedFeedProjections?: number;
  clearedUserShows?: number;
  clearedFeedProjections?: number;
};

type MonthlyHomeScheduleSignalResult = {
  skipped: boolean;
  reason?: "already_completed";
  month: string;
  startDate: string;
  endDate: string;
  scannedFeedProjections?: number;
  processedUsers?: number;
  hydratedDays?: number;
  refreshedDays?: number;
  failedHydrationDays?: number;
  matchedShows?: number;
  matchedEpisodes?: number;
  patchedUserShows?: number;
  patchedFeedProjections?: number;
};

export const getRateLimitState = internalQuery({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return {
      lastAttemptTime: existing?.lastAttemptTime ?? 0,
      nextRetryTime: existing?.nextRetryTime ?? 0,
      retryCount: existing?.retryCount ?? 0,
    };
  },
});

export const setRateLimitState = internalMutation({
  args: {
    key: v.string(),
    lastAttemptTime: v.number(),
    nextRetryTime: v.number(),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    const payload = {
      key: args.key,
      lastAttemptTime: args.lastAttemptTime,
      nextRetryTime: args.nextRetryTime,
      retryCount: args.retryCount,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return;
    }

    await ctx.db.insert("rateLimits", payload);
  },
});

function getErrorStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
    return (error as { status: number }).status;
  }

  if (
    "body" in error &&
    typeof (error as { body?: unknown }).body === "object" &&
    (error as { body?: unknown }).body !== null
  ) {
    const body = (error as { body: Record<string, unknown> }).body;
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const first = body.errors[0];
      if (
        typeof first === "object" &&
        first !== null &&
        "status" in first &&
        typeof (first as { status?: unknown }).status === "number"
      ) {
        return (first as { status: number }).status;
      }
    }
  }

  return null;
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseScheduleDateKey(dateString: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null;
  }

  const parsed = new Date(`${dateString}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return formatDate(parsed) === dateString ? parsed : null;
}

function parseRequiredScheduleDateKey(dateString: string, label: string) {
  const parsed = parseScheduleDateKey(dateString);
  if (!parsed) {
    throw new Error(`Invalid ${label}: ${dateString}`);
  }
  return {
    date: parsed,
    key: formatDate(parsed),
  };
}

function getScheduleRangeKeys(startDate: string, endDate: string) {
  const start = parseRequiredScheduleDateKey(startDate, "schedule start date");
  const end = parseRequiredScheduleDateKey(endDate, "schedule end date");
  if (end.date.getTime() < start.date.getTime()) {
    throw new Error("Schedule end date must be on or after start date");
  }

  const spanDays =
    Math.floor((end.date.getTime() - start.date.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (spanDays > MAX_SCHEDULE_RANGE_DAYS) {
    throw new Error(`Schedule range cannot exceed ${MAX_SCHEDULE_RANGE_DAYS} days`);
  }

  return {
    startDate: start.key,
    endDate: end.key,
    spanDays,
  };
}

function getEpisodeAirtimeTimestamp(airDate?: string | null) {
  const trimmed = airDate?.trim();
  if (
    !trimmed ||
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  ) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getScheduleSignalSyncCursor(nowMs: number) {
  return String(Math.floor(nowMs / HOME_CACHED_SIGNAL_SYNC_BUCKET_MS));
}

function getSafeClientTodayDate(clientTodayDate: string | undefined, nowMs: number) {
  const serverToday = startOfDay(new Date(nowMs));
  if (!clientTodayDate) {
    return serverToday;
  }

  const parsedClientToday = parseScheduleDateKey(clientTodayDate);
  if (!parsedClientToday) {
    return serverToday;
  }

  return Math.abs(parsedClientToday.getTime() - serverToday.getTime()) <= DAY_MS
    ? parsedClientToday
    : serverToday;
}

function getPreviousUtcMonthRange(now: Date) {
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const previousMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const previousMonthEnd = addUtcDays(currentMonthStart, -1);

  return {
    month: formatDate(previousMonthStart).slice(0, 7),
    startDate: formatDate(previousMonthStart),
    endDate: formatDate(previousMonthEnd),
    days:
      Math.floor(
        (previousMonthEnd.getTime() - previousMonthStart.getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1,
  };
}

function getTvMazeScheduleRateLimitKey(date: string) {
  return `${TVMAZE_SCHEDULE_RATE_LIMIT_PREFIX}:${date}`;
}

function getTvMazeScheduleRetryDelayMs(retryCount: number) {
  const exponent = Math.max(0, retryCount - 1);
  return Math.min(
    TVMAZE_SCHEDULE_RETRY_BASE_MS * 2 ** exponent,
    TVMAZE_SCHEDULE_RETRY_MAX_MS
  );
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

function getScheduleSeriesDedupeTitle(normalizedTitle: string) {
  return normalizedTitle.replace(
    /(?:s\d+|season\d*|\d+(?:st|nd|rd|th)?season|part\d*|cour\d*|finalseason)$/,
    ""
  );
}

function isGenericScheduleEpisodeName(name?: string) {
  const normalized = normalizeTitle(name ?? "");
  return !normalized || /^episode\d+$/.test(normalized);
}

function getScheduleEpisodeDedupeKey(episode: {
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
}) {
  const normalizedName = normalizeTitle(episode.name ?? "");
  if (normalizedName && !isGenericScheduleEpisodeName(episode.name)) {
    return `name:${normalizedName}`;
  }
  return `number:${episode.seasonNumber}:${episode.episodeNumber}`;
}

function getScheduleAirDatePrecision(airDate?: string) {
  return airDate?.includes("T") ? 1 : 0;
}

function shouldPreferScheduleEpisode(
  next: { episode: { airDate?: string } },
  current: { episode: { airDate?: string } }
) {
  return (
    getScheduleAirDatePrecision(next.episode.airDate) >
    getScheduleAirDatePrecision(current.episode.airDate)
  );
}

function getScheduleEntrySourceProvider(entry: CompactScheduleEntry) {
  return entry.showId.split(":")[0] ?? "";
}

function getScheduleSourcePriority(sourceProvider: string) {
  switch (sourceProvider) {
    case "tvmaze":
      return 3;
    case "anilist":
      return 2;
    case "tmdb":
      return 1;
    default:
      return 0;
  }
}

function shouldCollapseSameTrackedShowDay(
  next: CompactScheduleEntry,
  current: CompactScheduleEntry
) {
  const nextName = normalizeTitle(next.episode.name ?? "");
  const currentName = normalizeTitle(current.episode.name ?? "");
  const sameNonGenericName =
    nextName.length > 0 &&
    nextName === currentName &&
    !isGenericScheduleEpisodeName(next.episode.name) &&
    !isGenericScheduleEpisodeName(current.episode.name);

  if (sameNonGenericName) {
    return true;
  }

  const differentSource =
    getScheduleEntrySourceProvider(next) !== getScheduleEntrySourceProvider(current);
  if (!differentSource) {
    return false;
  }

  return (
    isGenericScheduleEpisodeName(next.episode.name) ||
    isGenericScheduleEpisodeName(current.episode.name) ||
    getScheduleAirDatePrecision(next.episode.airDate) !==
      getScheduleAirDatePrecision(current.episode.airDate)
  );
}

function shouldPreferSameTrackedShowDayEpisode(
  next: CompactScheduleEntry,
  current: CompactScheduleEntry
) {
  const nameDelta =
    Number(!isGenericScheduleEpisodeName(next.episode.name)) -
    Number(!isGenericScheduleEpisodeName(current.episode.name));
  if (nameDelta !== 0) {
    return nameDelta > 0;
  }

  const sourceDelta =
    getScheduleSourcePriority(getScheduleEntrySourceProvider(next)) -
    getScheduleSourcePriority(getScheduleEntrySourceProvider(current));
  if (sourceDelta !== 0) {
    return sourceDelta > 0;
  }

  const precisionDelta =
    getScheduleAirDatePrecision(next.episode.airDate) -
    getScheduleAirDatePrecision(current.episode.airDate);
  if (precisionDelta !== 0) {
    return precisionDelta > 0;
  }

  const nextAirtime = getEpisodeAirtimeTimestamp(next.episode.airDate);
  const currentAirtime = getEpisodeAirtimeTimestamp(current.episode.airDate);
  if (nextAirtime !== null && currentAirtime !== null && nextAirtime !== currentAirtime) {
    return nextAirtime < currentAirtime;
  }

  return false;
}

function getScheduleStatusPriority(status?: string) {
  switch (status) {
    case "watching":
      return 5;
    case "completed":
      return 4;
    case "paused":
      return 3;
    case "plan_to_watch":
      return 2;
    case "dropped":
      return 1;
    default:
      return 0;
  }
}

function shouldPreferScheduleCandidate(
  next: { mediaType: "tv" | "anime"; status?: string; lastWatchedAt?: number | null },
  current: { mediaType: "tv" | "anime"; status?: string; lastWatchedAt?: number | null },
  scheduleMediaType?: "tv" | "anime"
) {
  const statusDelta =
    getScheduleStatusPriority(next.status) - getScheduleStatusPriority(current.status);
  if (statusDelta !== 0) {
    return statusDelta > 0;
  }

  const watchedDelta = (next.lastWatchedAt ?? 0) - (current.lastWatchedAt ?? 0);
  if (watchedDelta !== 0) {
    return watchedDelta > 0;
  }

  if (next.mediaType !== current.mediaType) {
    if (scheduleMediaType && next.mediaType === scheduleMediaType) {
      return true;
    }
    if (scheduleMediaType && current.mediaType === scheduleMediaType) {
      return false;
    }
    return next.mediaType === "tv";
  }

  return false;
}

function findTrackedScheduleMatch<T extends {
  mediaType: "tv" | "anime";
  normalizedTitle: string;
  status?: string;
  lastWatchedAt?: number | null;
  tmdbId?: number;
  anilistId?: number;
  tvmazeId?: number;
}>(
  entry: CompactScheduleEntry,
  mediaType: "tv" | "anime",
  trackedShows: T[],
  byExternalKey: Map<string, T>
) {
  const externalMatch = byExternalKey.get(entry.showId);
  if (externalMatch) {
    return externalMatch;
  }

  // Only anime schedule rows bridge TV/anime title aliases. TVMaze rows stay
  // same-media unless provider IDs match, which avoids cross-provider duplicates.
  if (mediaType !== "anime") {
    const sameMediaTitleCandidates = trackedShows.filter(
      (tracked) =>
        tracked.mediaType === mediaType &&
        entry.normalizedTitle === tracked.normalizedTitle
    );

    sameMediaTitleCandidates.sort((a, b) => {
      if (shouldPreferScheduleCandidate(b, a, mediaType)) {
        return 1;
      }
      if (shouldPreferScheduleCandidate(a, b, mediaType)) {
        return -1;
      }

      return b.normalizedTitle.length - a.normalizedTitle.length;
    });

    return sameMediaTitleCandidates[0] ?? null;
  }

  const titleCandidates = trackedShows.filter((tracked) => {
    if (tracked.mediaType !== "tv" && tracked.mediaType !== "anime") {
      return false;
    }
    return (
      entry.normalizedTitle === tracked.normalizedTitle ||
      (mediaType === "anime" &&
        isAnimeSeasonTitleVariant(entry.normalizedTitle, tracked.normalizedTitle))
    );
  });

  if (titleCandidates.length === 0) {
    return null;
  }

  titleCandidates.sort((a, b) => {
    if (shouldPreferScheduleCandidate(b, a, mediaType)) {
      return 1;
    }
    if (shouldPreferScheduleCandidate(a, b, mediaType)) {
      return -1;
    }

    return b.normalizedTitle.length - a.normalizedTitle.length;
  });
  return titleCandidates[0] ?? null;
}

function compactScheduleEntries(entries: NormalizedScheduleEntry[]): CompactScheduleEntry[] {
  const dedupe = new Set<string>();
  const compacted: CompactScheduleEntry[] = [];

  for (const entry of entries) {
    const seasonNumber = entry.episode.seasonNumber;
    const episodeNumber = entry.episode.episodeNumber;
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      continue;
    }

    const normalizedTitle = normalizeTitle(entry.showTitle ?? "");
    if (!entry.showId || !normalizedTitle) {
      continue;
    }

    const airDate = entry.episode.airDate;
    const dedupeKey = `${entry.showId}:${seasonNumber}:${episodeNumber}:${airDate ?? ""}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    compacted.push({
      showId: entry.showId,
      normalizedTitle,
      episode: {
        seasonNumber,
        episodeNumber,
        ...(entry.episode.name ? { name: entry.episode.name } : {}),
        ...(airDate ? { airDate } : {}),
      },
    });
  }

  return compacted;
}

function parseCachedScheduleEntries(episodesRaw: string): CompactScheduleEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(episodesRaw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const compacted: CompactScheduleEntry[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const showId = typeof record.showId === "string" ? record.showId : "";
    if (!showId) {
      continue;
    }

    const episodeRaw =
      record.episode && typeof record.episode === "object"
        ? (record.episode as Record<string, unknown>)
        : null;
    if (!episodeRaw) {
      continue;
    }

    const seasonNumber = Number(episodeRaw.seasonNumber);
    const episodeNumber = Number(episodeRaw.episodeNumber);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      continue;
    }

    const normalizedTitle =
      typeof record.normalizedTitle === "string"
        ? record.normalizedTitle
        : normalizeTitle(typeof record.showTitle === "string" ? record.showTitle : "");
    if (!normalizedTitle) {
      continue;
    }

    compacted.push({
      showId,
      normalizedTitle,
      episode: {
        seasonNumber,
        episodeNumber,
        ...(typeof episodeRaw.name === "string" && episodeRaw.name
          ? { name: episodeRaw.name }
          : {}),
        ...(typeof episodeRaw.airDate === "string" && episodeRaw.airDate
          ? { airDate: episodeRaw.airDate }
          : {}),
      },
    });
  }

  return compacted;
}

function getRouteId(args: {
  mediaType: string;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
}): string | null {
  if (
    typeof args.tmdbId === "number" &&
    (args.mediaType === "tv" || args.mediaType === "movie")
  ) {
    return `tmdb:${args.mediaType}:${args.tmdbId}`;
  }
  if (typeof args.anilistId === "number" && args.mediaType === "anime") {
    return `anilist:anime:${args.anilistId}`;
  }
  if (typeof args.malId === "number" && args.mediaType === "anime") {
    return `jikan:anime:${args.malId}`;
  }
  return null;
}

function getRouteIdForShow(show: Doc<"shows">): string | null {
  return getRouteId({
    mediaType: show.mediaType,
    tmdbId: show.tmdbId,
    anilistId: show.anilistId,
    malId: show.malId,
  });
}

function getRouteIdForProjection(p: {
  mediaType: string;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
}): string | null {
  return getRouteId({
    mediaType: p.mediaType,
    tmdbId: p.tmdbId,
    anilistId: p.anilistId,
    malId: p.malId,
  });
}

function getWatchlistIdForProjection(p: {
  mediaType: string;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  imdbId?: string;
}): string | null {
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
  if (typeof p.imdbId === "string" && p.imdbId.trim()) {
    return `imdb:${p.mediaType}:${p.imdbId.trim().toLowerCase()}`;
  }
  return null;
}

function getWatchableProjectionTotalEpisodes(args: {
  watchedEpisodes: number;
  totalEpisodes: number | null;
  remainingEpisodes: number | null;
}) {
  if (typeof args.remainingEpisodes !== "number") {
    return args.totalEpisodes;
  }

  const watchableTotal = args.watchedEpisodes + args.remainingEpisodes;
  if (watchableTotal <= 0) {
    return args.totalEpisodes;
  }

  return typeof args.totalEpisodes === "number"
    ? Math.min(args.totalEpisodes, watchableTotal)
    : watchableTotal;
}

function serializeScheduledWatchlistItem(
  projection: Doc<"feedProjections">
): ScheduledWatchlistItem | null {
  if (projection.mediaType !== "tv" && projection.mediaType !== "anime") {
    return null;
  }

  const id = getWatchlistIdForProjection(projection);
  if (!id) {
    return null;
  }

  const watchedEpisodes = projection.watchedEpisodesCount;
  const totalEpisodes = projection.totalEpisodes ?? null;
  const remainingEpisodes = projection.remainingEpisodes ?? null;
  const watchableTotalEpisodes = getWatchableProjectionTotalEpisodes({
    watchedEpisodes,
    totalEpisodes,
    remainingEpisodes,
  });
  const trackingState =
    watchableTotalEpisodes === null
      ? watchedEpisodes > 0
        ? "in_progress"
        : "tba"
      : watchedEpisodes === 0
        ? "not_started"
        : "in_progress";

  return {
    id,
    title: projection.title,
    mediaType: projection.mediaType,
    posterUrl: projection.posterUrl ?? null,
    tmdbId: projection.tmdbId ?? null,
    anilistId: projection.anilistId ?? null,
    malId: projection.malId ?? null,
    tvmazeId: projection.tvmazeId ?? null,
    imdbId: projection.imdbId ?? null,
    status: projection.status,
    isAutoTracked: projection.isAutoTracked ?? false,
    trackingState,
    remainingEpisodes,
    watchedEpisodes,
    totalEpisodes: watchableTotalEpisodes,
    autoPausedAt: projection.autoPausedAt ?? null,
    lastWatchedAt: projection.lastWatchedAt,
    newEpisodeSignalAt: projection.newEpisodeSignalAt ?? null,
  };
}

async function getLatestFeedProjectionUpdatedAt(
  ctx: QueryCtx,
  userId: Id<"users">,
  mediaFilter?: ScheduleMediaFilter
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

async function getLatestScheduleProjectionIdentityUpdatedAt(
  ctx: QueryCtx,
  userId: Id<"users">,
  mediaFilter?: ScheduleMediaFilter
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

async function getScheduleProjectionStatus(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: ScheduleMediaFilter;
  }
): Promise<ScheduleProjectionStatus> {
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
      getLatestScheduleProjectionIdentityUpdatedAt(
        ctx,
        args.userId,
        args.mediaFilter
      ),
      getLatestFeedProjectionUpdatedAt(ctx, args.userId, args.mediaFilter),
    ]);

  if (!coveredWindow) {
    return {
      active: false,
      reason: windows.length === 0 ? "missing_window" : "outside_window",
      latestScheduleProjectionUpdatedAt,
      latestFeedProjectionUpdatedAt,
      window: null,
      windowCount: windows.length,
    };
  }

  if (latestScheduleProjectionUpdatedAt > coveredWindow.projectionUpdatedAt) {
    return {
      active: false,
      reason: "stale_schedule_identity",
      latestScheduleProjectionUpdatedAt,
      latestFeedProjectionUpdatedAt,
      window: coveredWindow,
      windowCount: windows.length,
    };
  }

  return {
    active: true,
    reason: "active",
    latestScheduleProjectionUpdatedAt,
    latestFeedProjectionUpdatedAt,
    window: coveredWindow,
    windowCount: windows.length,
  };
}

async function getFreshScheduleProjectionWindow(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: ScheduleMediaFilter;
  }
): Promise<Doc<"userScheduleProjectionWindows"> | null> {
  const status = await getScheduleProjectionStatus(ctx, args);
  return status.active ? status.window : null;
}

async function getProjectedScheduleEvents(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: ScheduleMediaFilter;
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

async function getProjectionByIdForScheduleRows(
  ctx: QueryCtx,
  userId: Id<"users">,
  rows: Doc<"userScheduleEvents">[]
) {
  const projectionIds = Array.from(
    new Set(rows.map((row) => row.feedProjectionId))
  );
  const projections = await Promise.all(
    projectionIds.map((projectionId) => ctx.db.get(projectionId))
  );

  return new Map(
    projections
      .filter(
        (projection): projection is Doc<"feedProjections"> =>
          !!projection && projection.userId === userId
      )
      .map((projection) => [projection._id, projection])
  );
}

function getProjectedScheduleEpisodeNumberRows(
  rows: Doc<"userScheduleEvents">[],
  projectionById: Map<Id<"feedProjections">, Doc<"feedProjections">>
): ScheduleEpisodeNumberLike[] {
  return rows.flatMap((row) => {
    const projection = projectionById.get(row.feedProjectionId);
    if (!projection) {
      return [];
    }

    return [
      {
        showId: projection.showId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        episodeName: row.episodeName ?? null,
      },
    ];
  });
}

function projectedScheduleEntryFromRow(
  row: Doc<"userScheduleEvents">
): CompactScheduleEntry {
  return {
    showId: `${row.sourceProvider ?? "projection"}:${row.routeId}`,
    normalizedTitle: normalizeTitle(row.showTitle),
    episode: {
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      ...(row.episodeName ? { name: row.episodeName } : {}),
      ...(row.airDate ? { airDate: row.airDate } : {}),
    },
  };
}

function getWatchedScheduleEpisodeKey(
  showId: Id<"shows">,
  seasonNumber: number,
  episodeNumber: number
) {
  return `${showId}:${seasonNumber}:${episodeNumber}`;
}

function getWatchedScheduleSeasonKey(showId: Id<"shows">, seasonNumber: number) {
  return `${showId}:${seasonNumber}`;
}

function getWatchedScheduleAbsoluteEpisodeKey(
  showId: Id<"shows">,
  episodeNumber: number
) {
  return `${showId}:${episodeNumber}`;
}

const ABSOLUTE_SCHEDULE_EPISODE_MIN = 100;

type WatchedScheduleEpisodeIndex = {
  exactKeys: Set<string>;
  absoluteEpisodeKeys: Set<string>;
  absoluteSeasonOffsets: Map<string, number>;
};

function parseAbsoluteScheduleEpisodeNumber(episodeName?: string | null) {
  const match = episodeName?.trim().match(/^Episode\s+(\d{3,})$/i);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasProviderAbsoluteEpisodeNumber(
  seasonNumber: number,
  episodeNumber: number
) {
  return (
    episodeNumber >= ABSOLUTE_SCHEDULE_EPISODE_MIN &&
    (seasonNumber <= 1 || seasonNumber >= 1900)
  );
}

function getScheduleAbsoluteSeasonOffsets(rows: ScheduleEpisodeNumberLike[]) {
  const offsetHits = new Map<string, Map<number, number>>();

  for (const row of rows) {
    const absoluteEpisodeNumber = parseAbsoluteScheduleEpisodeNumber(
      row.episodeName
    );
    if (typeof absoluteEpisodeNumber !== "number") {
      continue;
    }

    const offset = absoluteEpisodeNumber - row.episodeNumber;
    if (offset < ABSOLUTE_SCHEDULE_EPISODE_MIN) {
      continue;
    }

    const seasonKey = getWatchedScheduleSeasonKey(row.showId, row.seasonNumber);
    const hits = offsetHits.get(seasonKey) ?? new Map<number, number>();
    hits.set(offset, (hits.get(offset) ?? 0) + 1);
    offsetHits.set(seasonKey, hits);
  }

  const offsets = new Map<string, number>();
  for (const [seasonKey, hits] of offsetHits) {
    const sortedHits = Array.from(hits.entries()).sort(
      ([offsetA, countA], [offsetB, countB]) =>
        countB - countA || offsetA - offsetB
    );
    const [bestOffset, bestCount] = sortedHits[0] ?? [null, 0];
    const secondBestCount = sortedHits[1]?.[1] ?? 0;

    if (
      typeof bestOffset === "number" &&
      bestCount >= 2 &&
      bestCount > secondBestCount
    ) {
      offsets.set(seasonKey, bestOffset);
    }
  }

  return offsets;
}

function isWatchedScheduleEpisode(
  watched: WatchedScheduleEpisodeIndex,
  showId: Id<"shows">,
  seasonNumber: number,
  episodeNumber: number,
  scheduleAbsoluteSeasonOffsets?: Map<string, number>
) {
  if (
    watched.exactKeys.has(
      getWatchedScheduleEpisodeKey(showId, seasonNumber, episodeNumber)
    )
  ) {
    return true;
  }

  if (
    hasProviderAbsoluteEpisodeNumber(seasonNumber, episodeNumber) &&
    watched.absoluteEpisodeKeys.has(
      getWatchedScheduleAbsoluteEpisodeKey(showId, episodeNumber)
    )
  ) {
    return true;
  }

  const absoluteOffset = watched.absoluteSeasonOffsets.get(
    getWatchedScheduleSeasonKey(showId, seasonNumber)
  );
  if (
    typeof absoluteOffset === "number" &&
    watched.exactKeys.has(
      getWatchedScheduleEpisodeKey(
        showId,
        seasonNumber,
        absoluteOffset + episodeNumber
      )
    )
  ) {
    return true;
  }

  const scheduleAbsoluteOffset = scheduleAbsoluteSeasonOffsets?.get(
    getWatchedScheduleSeasonKey(showId, seasonNumber)
  );
  if (typeof scheduleAbsoluteOffset !== "number") {
    return false;
  }

  return watched.absoluteEpisodeKeys.has(
    getWatchedScheduleAbsoluteEpisodeKey(
      showId,
      scheduleAbsoluteOffset + episodeNumber
    )
  );
}

async function getWatchedScheduleEpisodeIndexForShows(
  ctx: QueryCtx,
  userId: Id<"users">,
  showIds: Id<"shows">[]
) {
  const uniqueShowIds = Array.from(
    new Map(showIds.map((showId) => [String(showId), showId])).values()
  );
  const watchedEpisodeKeys = new Set<string>();
  const watchedAbsoluteEpisodeKeys = new Set<string>();
  const absoluteSeasonOffsets = new Map<string, number>();

  await Promise.all(
    uniqueShowIds.map(async (showId) => {
      const watchedEpisodes = await ctx.db
        .query("watchedEpisodes")
        .withIndex("by_user_show", (q) =>
          q.eq("userId", userId).eq("showId", showId)
        )
        .collect();

      for (const watched of watchedEpisodes) {
        watchedEpisodeKeys.add(
          getWatchedScheduleEpisodeKey(showId, watched.season, watched.episode)
        );
        if (watched.episode >= ABSOLUTE_SCHEDULE_EPISODE_MIN) {
          watchedAbsoluteEpisodeKeys.add(
            getWatchedScheduleAbsoluteEpisodeKey(showId, watched.episode)
          );
        }
      }

      const episodesBySeason = new Map<number, number[]>();
      for (const watched of watchedEpisodes) {
        const episodes = episodesBySeason.get(watched.season) ?? [];
        episodes.push(watched.episode);
        episodesBySeason.set(watched.season, episodes);
      }

      const seasons = Array.from(episodesBySeason.keys()).sort((a, b) => a - b);
      let previousMaxEpisode = 0;
      for (const season of seasons) {
        const episodes = episodesBySeason.get(season) ?? [];
        if (season > 1 && previousMaxEpisode > 0) {
          const currentMinEpisode = Math.min(...episodes);
          // Some tracked episode lists store later seasons as absolute series numbers.
          if (currentMinEpisode === previousMaxEpisode + 1) {
            absoluteSeasonOffsets.set(
              getWatchedScheduleSeasonKey(showId, season),
              previousMaxEpisode
            );
          }
        }

        previousMaxEpisode = Math.max(previousMaxEpisode, ...episodes);
      }
    })
  );

  return {
    exactKeys: watchedEpisodeKeys,
    absoluteEpisodeKeys: watchedAbsoluteEpisodeKeys,
    absoluteSeasonOffsets,
  };
}

async function filterProjectedRowsToCurrentFeedProjections(
  ctx: QueryCtx,
  userId: Id<"users">,
  rows: Doc<"userScheduleEvents">[]
) {
  if (rows.length === 0) {
    return rows;
  }

  const projectionIds = Array.from(new Set(rows.map((row) => row.feedProjectionId)));
  const projections = await Promise.all(
    projectionIds.map((projectionId) => ctx.db.get(projectionId))
  );
  const currentProjectionIds = new Set(
    projections
      .filter(
        (projection): projection is Doc<"feedProjections"> =>
          !!projection &&
          projection.userId === userId &&
          (projection.mediaType === "tv" || projection.mediaType === "anime")
      )
      .map((projection) => projection._id)
  );

  return rows.filter((row) => currentProjectionIds.has(row.feedProjectionId));
}

export const getScheduleProjectionDiagnostics = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    mediaFilter: v.optional(v.union(v.literal("tv"), v.literal("anime"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        authenticated: false,
        active: false,
        reason: "unauthenticated",
        queryPath: "fallback",
      };
    }

    const range = getScheduleRangeKeys(args.startDate, args.endDate);
    const typedUserId = userId as Id<"users">;
    const status = await getScheduleProjectionStatus(ctx, {
      userId: typedUserId,
      startDate: range.startDate,
      endDate: range.endDate,
      mediaFilter: args.mediaFilter,
    });
    const projectedRows = await getProjectedScheduleEvents(ctx, {
      userId: typedUserId,
      startDate: range.startDate,
      endDate: range.endDate,
      mediaFilter: args.mediaFilter,
    });
    const currentRows = await filterProjectedRowsToCurrentFeedProjections(
      ctx,
      typedUserId,
      projectedRows
    );

    return {
      authenticated: true,
      active: status.active,
      reason: status.reason,
      queryPath: status.active ? "projection" : "fallback",
      requestedStartDate: range.startDate,
      requestedEndDate: range.endDate,
      mediaFilter: args.mediaFilter ?? "all",
      latestScheduleProjectionUpdatedAt: status.latestScheduleProjectionUpdatedAt,
      latestFeedProjectionUpdatedAt: status.latestFeedProjectionUpdatedAt,
      windowCount: status.windowCount,
      coveredWindow: status.window
        ? {
            scheduleStartDate: status.window.scheduleStartDate,
            scheduleEndDate: status.window.scheduleEndDate,
            countWindowStartDate: status.window.countWindowStartDate,
            countWindowEndDate: status.window.countWindowEndDate,
            generatedAt: status.window.generatedAt,
            projectionUpdatedAt: status.window.projectionUpdatedAt,
            eventCount: status.window.eventCount,
            countRowCount: status.window.countRowCount,
            runId: status.window.runId,
          }
        : null,
      projectedRowsInRange: projectedRows.length,
      currentProjectedRowsInRange: currentRows.length,
    };
  },
});

function serializeProjectedUpcomingSchedule(
  rows: Doc<"userScheduleEvents">[],
  today: Date
): UpcomingScheduleGroup[] {
  const grouped = new Map<string, UpcomingScheduleEpisode[]>();

  for (const row of rows) {
    const bucketDate = parseScheduleDateKey(row.date);
    if (!bucketDate) {
      continue;
    }

    const daysUntil = Math.floor(
      (startOfDay(bucketDate).getTime() - today.getTime()) / DAY_MS
    );
    const episode: UpcomingScheduleEpisode = {
      routeId: row.routeId,
      showTitle: row.showTitle,
      mediaType: row.mediaType,
      ...(row.posterUrl ? { posterUrl: row.posterUrl } : {}),
      daysUntil,
      episode: {
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        ...(row.episodeName ? { name: row.episodeName } : {}),
        ...(row.airDate ? { airDate: row.airDate } : {}),
      },
    };
    const dayEpisodes = grouped.get(row.date) ?? [];
    dayEpisodes.push(episode);
    grouped.set(row.date, dayEpisodes);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, episodes]) => ({
      date,
      episodes: episodes.sort((a, b) => {
        const aAirtime = getEpisodeAirtimeTimestamp(a.episode.airDate);
        const bAirtime = getEpisodeAirtimeTimestamp(b.episode.airDate);

        if (aAirtime !== null && bAirtime !== null && aAirtime !== bAirtime) {
          return aAirtime - bAirtime;
        }

        if (aAirtime !== null || bAirtime !== null) {
          return aAirtime === null ? 1 : -1;
        }

        return a.showTitle.localeCompare(b.showTitle);
      }),
    }));
}

async function getProjectedUpcomingSchedule(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: ScheduleMediaFilter;
  }
): Promise<UpcomingScheduleGroup[] | null> {
  const coveredWindow = await getFreshScheduleProjectionWindow(ctx, args);
  if (!coveredWindow) {
    return null;
  }

  const rows = await getProjectedScheduleEvents(ctx, args);
  const currentRows = await filterProjectedRowsToCurrentFeedProjections(
    ctx,
    args.userId,
    rows
  );
  return serializeProjectedUpcomingSchedule(currentRows, startOfDay(new Date()));
}

async function getProjectedFutureUpcomingCountsForUser(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: ScheduleMediaFilter;
  }
): Promise<WatchlistFutureCountRow[] | null> {
  const coveredWindow = await getFreshScheduleProjectionWindow(ctx, args);
  if (!coveredWindow) {
    return null;
  }

  const rows = await getProjectedScheduleEvents(ctx, args);
  const currentRows = await filterProjectedRowsToCurrentFeedProjections(
    ctx,
    args.userId,
    rows
  );
  const projectionIds = Array.from(
    new Set(currentRows.map((row) => row.feedProjectionId))
  );
  const projections = await Promise.all(
    projectionIds.map((projectionId) => ctx.db.get(projectionId))
  );
  const projectionById = new Map(
    projections
      .filter(
        (projection): projection is Doc<"feedProjections"> =>
          !!projection && projection.userId === args.userId
      )
      .map((projection) => [projection._id, projection])
  );
  const watchedEpisodes = await getWatchedScheduleEpisodeIndexForShows(
    ctx,
    args.userId,
    Array.from(projectionById.values()).map((projection) => projection.showId)
  );
  const scheduleAbsoluteSeasonOffsets = getScheduleAbsoluteSeasonOffsets(
    getProjectedScheduleEpisodeNumberRows(currentRows, projectionById)
  );
  const counts = new Map<
    string,
    { availableCount: number; futureCount: number; unavailableCount: number }
  >();
  const nowMs = Date.now();
  const today = startOfDay(new Date());

  for (const row of currentRows) {
    const projection = projectionById.get(row.feedProjectionId);
    if (!projection) {
      continue;
    }
    if (
      isWatchedScheduleEpisode(
        watchedEpisodes,
        projection.showId,
        row.seasonNumber,
        row.episodeNumber,
        scheduleAbsoluteSeasonOffsets
      )
    ) {
      continue;
    }

    const bucketDate = parseScheduleDateKey(row.date);
    if (!bucketDate) {
      continue;
    }
    const daysUntil = Math.floor(
      (startOfDay(bucketDate).getTime() - today.getTime()) / DAY_MS
    );
    const airtimeMs = getEpisodeAirtimeTimestamp(row.airDate);
    const isFutureDay = daysUntil > 0;
    const isTodayBeforeAirtime = daysUntil === 0 && airtimeMs !== null && airtimeMs > nowMs;
    const existing = counts.get(row.routeId) ?? {
      availableCount: 0,
      futureCount: 0,
      unavailableCount: 0,
    };

    if (!isFutureDay && !isTodayBeforeAirtime) {
      existing.availableCount += 1;
      counts.set(row.routeId, existing);
      continue;
    }

    if (isFutureDay) {
      existing.futureCount += 1;
    }
    existing.unavailableCount += 1;
    counts.set(row.routeId, existing);
  }

  return Array.from(counts.entries())
    .sort(([routeIdA], [routeIdB]) => routeIdA.localeCompare(routeIdB))
    .map(([routeId, count]) => ({
      routeId,
      availableCount: count.availableCount,
      futureCount: count.futureCount,
      unavailableCount: count.unavailableCount,
    }));
}

async function getProjectedTodayScheduledWatchlistFeed(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    date: string;
    mediaFilter?: ScheduleMediaFilter;
    limit: number;
  }
): Promise<ScheduledWatchlistItem[] | null> {
  const coveredWindow = await getFreshScheduleProjectionWindow(ctx, {
    userId: args.userId,
    startDate: args.date,
    endDate: args.date,
    mediaFilter: args.mediaFilter,
  });
  if (!coveredWindow) {
    return null;
  }

  const rows = await getProjectedScheduleEvents(ctx, {
    userId: args.userId,
    startDate: args.date,
    endDate: args.date,
    mediaFilter: args.mediaFilter,
  });
  if (rows.length === 0) {
    return [];
  }

  const projectionIds = Array.from(new Set(rows.map((row) => row.feedProjectionId)));
  const projections = await Promise.all(
    projectionIds.map((projectionId) => ctx.db.get(projectionId))
  );
  const projectionById = new Map(
    projections
      .filter(
        (projection): projection is Doc<"feedProjections"> =>
          !!projection && projection.userId === args.userId
      )
      .map((projection) => [projection._id, projection])
  );

  const candidates: Array<{
    row: Doc<"userScheduleEvents">;
    entry: CompactScheduleEntry;
    tracked: {
      projection: Doc<"feedProjections">;
      watchlistId: string;
      showId: Id<"shows">;
      mediaType: "tv" | "anime";
      status: string;
      lastWatchedAt: number;
    };
  }> = [];

  for (const row of rows) {
    const projection = projectionById.get(row.feedProjectionId);
    if (!projection) {
      continue;
    }
    if (projection.mediaType !== "tv" && projection.mediaType !== "anime") {
      continue;
    }
    if (args.mediaFilter && projection.mediaType !== args.mediaFilter) {
      continue;
    }
    if (
      (projection.status !== "watching" && projection.status !== "completed") ||
      projection.watchedEpisodesCount <= 0
    ) {
      continue;
    }
    const watchlistId = getWatchlistIdForProjection(projection);
    if (!watchlistId) {
      continue;
    }
    candidates.push({
      row,
      entry: projectedScheduleEntryFromRow(row),
      tracked: {
        projection,
        watchlistId,
        showId: projection.showId,
        mediaType: projection.mediaType,
        status: projection.status,
        lastWatchedAt: projection.lastWatchedAt,
      },
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  const watchedEpisodes = await getWatchedScheduleEpisodeIndexForShows(
    ctx,
    args.userId,
    candidates.map((candidate) => candidate.tracked.showId)
  );
  const proofRows =
    coveredWindow.scheduleStartDate === args.date &&
    coveredWindow.scheduleEndDate === args.date
      ? rows
      : await getProjectedScheduleEvents(ctx, {
          userId: args.userId,
          startDate: coveredWindow.scheduleStartDate,
          endDate: coveredWindow.scheduleEndDate,
          mediaFilter: args.mediaFilter,
        });
  const proofProjectionById =
    proofRows === rows
      ? projectionById
      : await getProjectionByIdForScheduleRows(ctx, args.userId, proofRows);
  const scheduleAbsoluteSeasonOffsets = getScheduleAbsoluteSeasonOffsets(
    getProjectedScheduleEpisodeNumberRows(proofRows, proofProjectionById)
  );

  const selectedByRoute = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (
      isWatchedScheduleEpisode(
        watchedEpisodes,
        candidate.tracked.showId,
        candidate.row.seasonNumber,
        candidate.row.episodeNumber,
        scheduleAbsoluteSeasonOffsets
      )
    ) {
      continue;
    }

    const existing = selectedByRoute.get(candidate.tracked.watchlistId);
    if (!existing) {
      selectedByRoute.set(candidate.tracked.watchlistId, candidate);
      continue;
    }

    const shouldReplace =
      (!existing.row.sourceMatchesTracked && candidate.row.sourceMatchesTracked) ||
      (existing.row.sourceMatchesTracked === candidate.row.sourceMatchesTracked &&
        (shouldPreferScheduleCandidate(candidate.tracked, existing.tracked) ||
          shouldPreferSameTrackedShowDayEpisode(candidate.entry, existing.entry)));

    if (shouldReplace) {
      selectedByRoute.set(candidate.tracked.watchlistId, candidate);
    }
  }

  return Array.from(selectedByRoute.values())
    .sort((a, b) => {
      if (a.row.airtimeMs !== b.row.airtimeMs) {
        return a.row.airtimeMs - b.row.airtimeMs;
      }
      return a.tracked.projection.title.localeCompare(b.tracked.projection.title);
    })
    .slice(0, args.limit)
    .map((candidate) => serializeScheduledWatchlistItem(candidate.tracked.projection))
    .filter((item): item is ScheduledWatchlistItem => item !== null);
}

function getUnixRangeForDate(dateString: string) {
  const date = parseScheduleDateKey(dateString);
  if (!date) {
    throw new Error(`Invalid schedule date: ${dateString}`);
  }

  const start = Math.floor(startOfDay(date).getTime() / 1000);
  const end = start + 24 * 60 * 60;
  return { start, end };
}

async function getScheduleCacheStatusForDateFromDb(
  ctx: QueryCtx,
  date: string
): Promise<DateCacheStatus> {
    const now = Date.now();
    const todayKey = formatDate(new Date());
    const dateKey = parseRequiredScheduleDateKey(date, "schedule cache date").key;
    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) => q.eq("date", dateKey))
      .collect();

    let tvCount = 0;
    let animeCount = 0;
    let tvLastUpdated: number | null = null;
    let animeLastUpdated: number | null = null;

    for (const row of rows) {
      const parsedCount = parseCachedScheduleEntries(row.episodes).length;

      if (row.mediaType === "tv") {
        tvCount = Math.max(tvCount, parsedCount);
        tvLastUpdated = Math.max(tvLastUpdated ?? 0, row.lastUpdated);
      } else if (row.mediaType === "anime") {
        animeCount = Math.max(animeCount, parsedCount);
        animeLastUpdated = Math.max(animeLastUpdated ?? 0, row.lastUpdated);
      }
    }

    const hasFreshTv =
      (dateKey < todayKey && tvLastUpdated !== null) ||
      (typeof tvLastUpdated === "number" &&
        now - tvLastUpdated < SCHEDULE_CACHE_FRESH_MS);
    const hasFreshAnimeByTime =
      typeof animeLastUpdated === "number" &&
      now - animeLastUpdated < SCHEDULE_CACHE_FRESH_MS;
    const shouldForceRefreshPastAnimeZero =
      animeCount === 0 && dateKey === todayKey;
    const hasFreshAnime =
      ((dateKey < todayKey && animeLastUpdated !== null) || hasFreshAnimeByTime) &&
      !shouldForceRefreshPastAnimeZero;

    return {
      tvCount,
      animeCount,
      hasFreshTv,
      hasFreshAnime,
    } as DateCacheStatus;
}

export const getScheduleCacheStatusForDate = query({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: unauthenticated access to schedule cache");
    }

    return getScheduleCacheStatusForDateFromDb(ctx, args.date);
  },
});

export const getScheduleCacheStatusForDateInternal = internalQuery({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => getScheduleCacheStatusForDateFromDb(ctx, args.date),
});

export const upsertScheduleBucketInternal = internalMutation({
  args: {
    date: v.string(),
    mediaType: v.union(v.literal("tv"), v.literal("anime")),
    episodes: v.string(),
    lastUpdated: v.number(),
  },
  handler: async (ctx, args) => {
    const normalizedDate = parseScheduleDateKey(args.date);
    if (!normalizedDate) {
      throw new Error(`Invalid schedule cache date: ${args.date}`);
    }

    const dateKey = formatDate(normalizedDate);

    const existing = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date_type", (q) =>
        q.eq("date", dateKey).eq("mediaType", args.mediaType)
      )
      .collect();

    if (existing.length > 0) {
      const [first, ...rest] = existing;
      const hasPayloadChanged = first.episodes !== args.episodes;

      if (hasPayloadChanged) {
        await ctx.db.patch(first._id, {
          episodes: args.episodes,
          lastUpdated: args.lastUpdated,
        });
      }

      for (const duplicate of rest) {
        await ctx.db.delete(duplicate._id);
      }

      return {
        updated: hasPayloadChanged || rest.length > 0,
        skippedUnchanged: !hasPayloadChanged && rest.length === 0,
      };
    }

    await ctx.db.insert("scheduleCache", {
      date: dateKey,
      mediaType: args.mediaType,
      episodes: args.episodes,
      lastUpdated: args.lastUpdated,
    });
    return { updated: true, skippedUnchanged: false };
  },
});

async function hydrateOneDate(
  ctx: ActionCtx,
  date: string
): Promise<{
  date: string;
  tvCount: number;
  animeCount: number;
  cached: boolean;
  hydrationFailed?: boolean;
  tvFetchFailed?: boolean;
  animeFetchFailed?: boolean;
  animeRateLimited?: boolean;
}> {
  const now = Date.now();
  const cacheStatus: DateCacheStatus = await ctx.runQuery(
    internal.schedule.getScheduleCacheStatusForDateInternal,
    { date }
  );

  if (cacheStatus.hasFreshTv && cacheStatus.hasFreshAnime) {
    return {
      date,
      tvCount: cacheStatus.tvCount,
      animeCount: cacheStatus.animeCount,
      cached: true,
      animeRateLimited: false,
    };
  }

  const { start, end } = getUnixRangeForDate(date);

  let tvEntries: NormalizedScheduleEntry[] = [];
  let animeEntries: NormalizedScheduleEntry[] = [];
  let tvFetchFailed = false;
  let animeFetchFailed = false;
  let animeFetchRateLimited = false;
  const tvRateLimitKey = getTvMazeScheduleRateLimitKey(date);
  const tvRateLimitState = await ctx.runQuery(internal.schedule.getRateLimitState, {
    key: tvRateLimitKey,
  });

  if (now < tvRateLimitState.nextRetryTime) {
    tvFetchFailed = true;
  } else {
    try {
      const tvSchedule = await getTvMazeScheduleByDate(date, "US");
      tvEntries = tvSchedule.map((entry) => normalizeTvMazeScheduleEntry(entry));

      if (
        tvRateLimitState.retryCount > 0 ||
        tvRateLimitState.nextRetryTime > 0
      ) {
        await ctx.runMutation(internal.schedule.setRateLimitState, {
          key: tvRateLimitKey,
          lastAttemptTime: now,
          nextRetryTime: 0,
          retryCount: 0,
        });
      }
    } catch (error) {
      tvFetchFailed = true;
      const retryCount = tvRateLimitState.retryCount + 1;
      await ctx.runMutation(internal.schedule.setRateLimitState, {
        key: tvRateLimitKey,
        lastAttemptTime: now,
        nextRetryTime: now + getTvMazeScheduleRetryDelayMs(retryCount),
        retryCount,
      });
      console.error(`Failed TV schedule fetch for ${date}`, error);
    }
  }

  const rateLimitState = await ctx.runQuery(internal.schedule.getRateLimitState, {
    key: ANILIST_SCHEDULE_RATE_LIMIT_KEY,
  });

  if (now < rateLimitState.nextRetryTime) {
    animeFetchRateLimited = true;
  } else {
    for (
      let page = 1;
      page <= MAX_ANILIST_SCHEDULE_PAGES;
      page += 1
    ) {
      try {
        const animeSchedule = await getAniListAiringSchedule(page, 50, start, end);
        animeEntries.push(
          ...animeSchedule.data.Page.airingSchedules.map((entry) =>
            normalizeAniListScheduleEntry(entry)
          )
        );

        if (!animeSchedule.data.Page.pageInfo?.hasNextPage) {
          break;
        }
      } catch (error) {
        const statusCode = getErrorStatusCode(error);
        if (statusCode === 429) {
          animeFetchRateLimited = true;
          const retryUntil = Date.now() + ANILIST_SCHEDULE_RATE_LIMIT_COOLDOWN_MS;
          await ctx.runMutation(internal.schedule.setRateLimitState, {
            key: ANILIST_SCHEDULE_RATE_LIMIT_KEY,
            lastAttemptTime: Date.now(),
            nextRetryTime: retryUntil,
            retryCount: rateLimitState.retryCount + 1,
          });
          break;
        }

        animeFetchFailed = true;
        console.error(`Failed anime schedule fetch for ${date}`, error);
        break;
      }
    }
  }

  const compactTvEntries = compactScheduleEntries(tvEntries);
  const compactAnimeEntries = compactScheduleEntries(animeEntries);

  if (!tvFetchFailed) {
    await ctx.runMutation(internal.schedule.upsertScheduleBucketInternal, {
      date,
      mediaType: "tv",
      episodes: JSON.stringify(compactTvEntries),
      lastUpdated: now,
    });
  }

  if (!animeFetchRateLimited && !animeFetchFailed) {
    await ctx.runMutation(internal.schedule.upsertScheduleBucketInternal, {
      date,
      mediaType: "anime",
      episodes: JSON.stringify(compactAnimeEntries),
      lastUpdated: now,
    });
  }

  const tvHydrationFailed = tvFetchFailed && !cacheStatus.hasFreshTv;
  const animeHydrationFailed =
    (animeFetchFailed || animeFetchRateLimited) && !cacheStatus.hasFreshAnime;

  return {
    date,
    tvCount: tvFetchFailed ? cacheStatus.tvCount : compactTvEntries.length,
    animeCount:
      animeFetchRateLimited || animeFetchFailed
        ? cacheStatus.animeCount
        : compactAnimeEntries.length,
    cached: false,
    hydrationFailed: tvHydrationFailed || animeHydrationFailed,
    tvFetchFailed,
    animeFetchFailed,
    animeRateLimited: animeFetchRateLimited,
  };
}

async function hydrateScheduleDates(ctx: ActionCtx, dateKeys: string[]) {
  const results: Awaited<ReturnType<typeof hydrateOneDate>>[] = [];
  let didWarnAnimeRateLimit = false;

  for (let index = 0; index < dateKeys.length; index += HYDRATE_BATCH_SIZE) {
    const batch = dateKeys.slice(index, index + HYDRATE_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((dateKey) => hydrateOneDate(ctx, dateKey))
    );
    if (!didWarnAnimeRateLimit && batchResults.some((result) => result.animeRateLimited)) {
      didWarnAnimeRateLimit = true;
      console.warn(
        "AniList schedule rate limited during range hydration; using cached anime schedule where available."
      );
    }
    results.push(...batchResults);
  }

  return results;
}

export const hydrateScheduleDate = internalAction({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    return hydrateOneDate(ctx, args.date);
  },
});

export const hydrateScheduleRange = internalAction({
  args: {
    startDate: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    const startDate = parseRequiredScheduleDateKey(
      args.startDate,
      "schedule hydration start date"
    ).date;
    const safeDays = Math.max(1, Math.min(args.days, 42));
    const dateKeys = Array.from({ length: safeDays }, (_, index) => {
      const date = new Date(startDate);
      date.setUTCDate(startDate.getUTCDate() + index);
      return formatDate(date);
    });

    const results = await hydrateScheduleDates(ctx, dateKeys);

    return {
      days: safeDays,
      results,
    };
  },
});

export const getHomeScheduleSignalMatches = internalQuery({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    availableDate: v.string(),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<HomeScheduleSignalEvaluation> => {
    const range = getScheduleRangeKeys(args.startDate, args.endDate);
    const availableDate = parseRequiredScheduleDateKey(
      args.availableDate,
      "home schedule signal available date"
    ).date;
    const availableDayStartMs = startOfDay(availableDate).getTime();

    const nonMovieProjections = (
      await Promise.all([
        ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", args.userId).eq("mediaType", "tv")
          )
          .collect(),
        ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", args.userId).eq("mediaType", "anime")
          )
          .collect(),
      ])
    ).flat();

    const trackedShows = nonMovieProjections
      .filter(
        (projection) =>
          (projection.status === "watching" || projection.status === "completed") &&
          projection.watchedEpisodesCount > 0
      )
      .map((projection) => ({
        projectionId: projection._id,
        userShowId: projection.userShowId,
        showId: projection.showId,
        remainingEpisodes: projection.remainingEpisodes,
        lastWatchedAt: projection.lastWatchedAt,
        newEpisodeSignalAt: projection.newEpisodeSignalAt,
        normalizedTitle: normalizeTitle(projection.title),
        mediaType: projection.mediaType as "tv" | "anime",
        tmdbId: projection.tmdbId,
        anilistId: projection.anilistId,
        tvmazeId: projection.tvmazeId,
      }));

    if (trackedShows.length === 0) {
      return { matches: [], checked: [] };
    }

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tmdbId === "number") {
        byExternalKey.set(`tmdb:${tracked.mediaType}:${tracked.tmdbId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
    }

    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) =>
        q.gte("date", range.startDate).lte("date", range.endDate)
      )
      .collect();

    const candidates: Array<{
      tracked: (typeof trackedShows)[number];
      seasonNumber: number;
      episodeNumber: number;
      episodeName: string | null;
      signalAt: number;
      latestEpisodeKey: string;
    }> = [];
    const scheduleOffsetRows: ScheduleEpisodeNumberLike[] = [];
    const dedupe = new Set<string>();

    for (const row of rows) {
      const bucketDate = parseScheduleDateKey(row.date);
      if (!bucketDate) {
        continue;
      }

      const bucketDayStartMs = startOfDay(bucketDate).getTime();
      const rowMediaType = row.mediaType as "tv" | "anime";
      const entries = parseCachedScheduleEntries(row.episodes);

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey
        );

        if (!tracked) {
          continue;
        }

        scheduleOffsetRows.push({
          showId: tracked.showId,
          seasonNumber: entry.episode.seasonNumber,
          episodeNumber: entry.episode.episodeNumber,
          episodeName: entry.episode.name ?? null,
        });

        if (bucketDayStartMs > availableDayStartMs) {
          continue;
        }

        const uniqueKey = `${tracked.projectionId}:${row.date}:${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
        if (dedupe.has(uniqueKey)) {
          continue;
        }
        dedupe.add(uniqueKey);

        const airtimeMs = getEpisodeAirtimeTimestamp(entry.episode.airDate);
        if (
          bucketDayStartMs === availableDayStartMs &&
          airtimeMs !== null &&
          airtimeMs > args.nowMs
        ) {
          continue;
        }
        const signalAt = airtimeMs ?? Math.min(bucketDayStartMs, args.nowMs);
        const latestEpisodeKey = `${row.date}:${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;

        candidates.push({
          tracked,
          seasonNumber: entry.episode.seasonNumber,
          episodeNumber: entry.episode.episodeNumber,
          episodeName: entry.episode.name ?? null,
          signalAt,
          latestEpisodeKey,
        });
      }
    }

    const watchedEpisodes = await getWatchedScheduleEpisodeIndexForShows(
      ctx,
      args.userId,
      candidates.map((candidate) => candidate.tracked.showId)
    );
    const scheduleAbsoluteSeasonOffsets = getScheduleAbsoluteSeasonOffsets(
      scheduleOffsetRows
    );

    const matches = new Map<
      string,
      HomeScheduleSignalMatch & { latestEpisodeKey: string }
    >();
    const checkedByProjection = new Map<string, HomeScheduleSignalCheck>();

    for (const tracked of trackedShows) {
      if (
        typeof tracked.newEpisodeSignalAt === "number" &&
        tracked.newEpisodeSignalAt > tracked.lastWatchedAt &&
        typeof tracked.remainingEpisodes === "number" &&
        tracked.remainingEpisodes <= 0
      ) {
        checkedByProjection.set(tracked.projectionId, {
          userShowId: tracked.userShowId,
          feedProjectionId: tracked.projectionId,
        });
      }
    }

    for (const candidate of candidates) {
      checkedByProjection.set(candidate.tracked.projectionId, {
        userShowId: candidate.tracked.userShowId,
        feedProjectionId: candidate.tracked.projectionId,
      });

      if (
        isWatchedScheduleEpisode(
          watchedEpisodes,
          candidate.tracked.showId,
          candidate.seasonNumber,
          candidate.episodeNumber,
          scheduleAbsoluteSeasonOffsets
        )
      ) {
        continue;
      }

      const existing = matches.get(candidate.tracked.projectionId);
      if (!existing) {
        matches.set(candidate.tracked.projectionId, {
          userShowId: candidate.tracked.userShowId,
          feedProjectionId: candidate.tracked.projectionId,
          signalAt: candidate.signalAt,
          matchedEpisodes: 1,
          latestEpisodeKey: candidate.latestEpisodeKey,
        });
        continue;
      }

      existing.matchedEpisodes += 1;
      if (
        candidate.signalAt > existing.signalAt ||
        (candidate.signalAt === existing.signalAt &&
          candidate.latestEpisodeKey > existing.latestEpisodeKey)
      ) {
        existing.signalAt = candidate.signalAt;
        existing.latestEpisodeKey = candidate.latestEpisodeKey;
      }
    }

    return {
      matches: Array.from(matches.values())
        .sort((a, b) => b.signalAt - a.signalAt)
        .slice(0, HOME_SIGNAL_MAX_MATCHES)
        .map(({ latestEpisodeKey: _latestEpisodeKey, ...match }) => match),
      checked: Array.from(checkedByProjection.values()).slice(0, HOME_SIGNAL_MAX_MATCHES * 2),
    };
  },
});

export const getHomeScheduleSignalCandidateUsersPage = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.max(
      1,
      Math.min(args.pageSize ?? MONTHLY_SIGNAL_USER_PAGE_SIZE, MONTHLY_SIGNAL_USER_PAGE_SIZE)
    );
    const page = await ctx.db.query("feedProjections").paginate({
      numItems: safePageSize,
      cursor: args.cursor ?? null,
    });
    const userIds = new Set<Id<"users">>();

    for (const projection of page.page) {
      if (projection.mediaType !== "tv" && projection.mediaType !== "anime") {
        continue;
      }
      if (projection.status !== "watching" && projection.status !== "completed") {
        continue;
      }
      if (projection.watchedEpisodesCount <= 0) {
        continue;
      }

      userIds.add(projection.userId);
    }

    return {
      scanned: page.page.length,
      userIds: Array.from(userIds),
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const applyHomeScheduleSignals = internalMutation({
  args: {
    userId: v.id("users"),
    matches: v.array(
      v.object({
        userShowId: v.id("userShows"),
        feedProjectionId: v.id("feedProjections"),
        signalAt: v.number(),
        matchedEpisodes: v.number(),
      })
    ),
    checked: v.array(
      v.object({
        userShowId: v.id("userShows"),
        feedProjectionId: v.id("feedProjections"),
      })
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    const now = Date.now();
    let patchedUserShows = 0;
    let patchedFeedProjections = 0;
    let clearedUserShows = 0;
    let clearedFeedProjections = 0;
    const validSignalProjectionIds = new Set(
      args.matches.map((match) => match.feedProjectionId)
    );
    const validSignalUserShowIds = new Set(
      args.matches.map((match) => match.userShowId)
    );

    for (const match of args.matches.slice(0, HOME_SIGNAL_MAX_MATCHES)) {
      const [userShow, projection] = await Promise.all([
        ctx.db.get(match.userShowId),
        ctx.db.get(match.feedProjectionId),
      ]);

      if (
        userShow &&
        userShow.userId === args.userId &&
        ((userShow.newEpisodeSignalAt ?? 0) < match.signalAt)
      ) {
        await ctx.db.patch(userShow._id, {
          newEpisodeSignalAt: match.signalAt,
        });
        patchedUserShows += 1;
      }

      if (!projection) {
        continue;
      }

      if (projection.userId !== args.userId) {
        continue;
      }

      const nextHomeSortAt = Math.max(
        projection.homeSortAt ?? projection.lastWatchedAt,
        projection.lastWatchedAt,
        match.signalAt
      );

      if (
        (projection.newEpisodeSignalAt ?? 0) >= match.signalAt &&
        (projection.homeSortAt ?? 0) >= nextHomeSortAt
      ) {
        continue;
      }

      await ctx.db.patch(projection._id, {
        newEpisodeSignalAt: Math.max(
          projection.newEpisodeSignalAt ?? 0,
          match.signalAt
        ),
        homeSortAt: nextHomeSortAt,
        updatedAt: now,
      });
      patchedFeedProjections += 1;
    }

    for (const checked of args.checked.slice(0, HOME_SIGNAL_MAX_MATCHES * 2)) {
      if (
        validSignalProjectionIds.has(checked.feedProjectionId) ||
        validSignalUserShowIds.has(checked.userShowId)
      ) {
        continue;
      }

      const [userShow, projection] = await Promise.all([
        ctx.db.get(checked.userShowId),
        ctx.db.get(checked.feedProjectionId),
      ]);

      if (!projection || projection.userId !== args.userId) {
        continue;
      }

      const projectionHasStaleSignal =
        typeof projection.newEpisodeSignalAt === "number" &&
        projection.newEpisodeSignalAt > projection.lastWatchedAt &&
        typeof projection.remainingEpisodes === "number" &&
        projection.remainingEpisodes <= 0;
      if (!projectionHasStaleSignal) {
        continue;
      }

      if (
        userShow &&
        userShow.userId === args.userId &&
        typeof userShow.newEpisodeSignalAt === "number"
      ) {
        await ctx.db.patch(userShow._id, {
          newEpisodeSignalAt: undefined,
        });
        clearedUserShows += 1;
      }

      await ctx.db.patch(projection._id, {
        newEpisodeSignalAt: undefined,
        homeSortAt: projection.lastWatchedAt,
        updatedAt: now,
      });
      clearedFeedProjections += 1;
    }

    return {
      patchedUserShows,
      patchedFeedProjections,
      clearedUserShows,
      clearedFeedProjections,
    };
  },
});

async function syncCachedHomeScheduleSignalsForUser(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    todayDate?: string;
    force?: boolean;
  }
): Promise<HomeScheduleSignalResult> {
  const nowMs = Date.now();
  const today = getSafeClientTodayDate(args.todayDate, nowMs);
  const todayKey = formatDate(today);
  const maintenanceKey = `home-cached-schedule-signal:v1:${args.userId}`;
  const syncCursor = getScheduleSignalSyncCursor(nowMs);
  const existingCursor = await ctx.runQuery(internal.shows.getMaintenanceCursor, {
    key: maintenanceKey,
  });

  if (!args.force && existingCursor === syncCursor) {
    return {
      skipped: true,
      reason: "already_ran_recently",
    };
  }

  const signalEvaluation: HomeScheduleSignalEvaluation = await ctx.runQuery(
    internal.schedule.getHomeScheduleSignalMatches,
    {
      userId: args.userId,
      startDate: formatDate(addUtcDays(today, -HOME_CACHED_SIGNAL_LOOKBACK_DAYS)),
      endDate: formatDate(addUtcDays(today, HOME_SIGNAL_LOOKAHEAD_DAYS)),
      availableDate: todayKey,
      nowMs,
    }
  );

  const applied: {
    patchedUserShows: number;
    patchedFeedProjections: number;
    clearedUserShows: number;
    clearedFeedProjections: number;
  } = await ctx.runMutation(internal.schedule.applyHomeScheduleSignals, {
    userId: args.userId,
    matches: signalEvaluation.matches,
    checked: signalEvaluation.checked,
  });

  await ctx.runMutation(internal.shows.setMaintenanceCursor, {
    key: maintenanceKey,
    cursor: syncCursor,
  });

  const result: HomeScheduleSignalResult = {
    skipped: false,
    hydratedDays: 0,
    refreshedDays: 0,
    failedHydrationDays: 0,
    matchedShows: signalEvaluation.matches.length,
    matchedEpisodes: signalEvaluation.matches.reduce(
      (sum: number, match: HomeScheduleSignalMatch) => sum + match.matchedEpisodes,
      0
    ),
    ...applied,
  };

  console.info("Home cached schedule signal sync", result);

  return result;
}

export const syncHomeCachedScheduleSignalsForUser = internalAction({
  args: {
    userId: v.id("users"),
    todayDate: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<HomeScheduleSignalResult> =>
    syncCachedHomeScheduleSignalsForUser(ctx, args),
});

export const syncHomeCachedScheduleSignals = action({
  args: {
    todayDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<HomeScheduleSignalResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        skipped: true,
        reason: "unauthenticated",
      };
    }

    return syncCachedHomeScheduleSignalsForUser(ctx, {
      userId: userId as Id<"users">,
      todayDate: args.todayDate,
    });
  },
});

export const ensureHomeWatchlistScheduleSignals = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<HomeScheduleSignalResult> => {
    const userId = args.userId;

    const now = new Date();
    const today = startOfDay(now);
    const todayKey = formatDate(today);
    const maintenanceKey = `home-schedule-signal:v3:${userId}:${todayKey}`;
    const existingCursor = await ctx.runQuery(internal.shows.getMaintenanceCursor, {
      key: maintenanceKey,
    });

    if (existingCursor === "done") {
      return {
        skipped: true,
        reason: "already_ran_today",
      };
    }

    const hydrateResults: Awaited<ReturnType<typeof hydrateOneDate>>[] = [];
    const hydrateDates = Array.from(
      { length: HOME_SIGNAL_PAST_CACHE_DAYS + HOME_SIGNAL_LOOKAHEAD_DAYS + 1 },
      (_, index) =>
        formatDate(addUtcDays(today, index - HOME_SIGNAL_PAST_CACHE_DAYS))
    );

    for (let index = 0; index < hydrateDates.length; index += HYDRATE_BATCH_SIZE) {
      const batch = hydrateDates.slice(index, index + HYDRATE_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((dateKey) => hydrateOneDate(ctx, dateKey))
      );
      hydrateResults.push(...batchResults);
    }

    const failedHydrationDays = hydrateResults.filter(
      (result) => result.hydrationFailed
    ).length;

    const matchStartDate = formatDate(addUtcDays(today, -HOME_SIGNAL_PAST_CACHE_DAYS));
    const matchEndDate = formatDate(addUtcDays(today, HOME_SIGNAL_LOOKAHEAD_DAYS));
    const signalEvaluation: HomeScheduleSignalEvaluation = await ctx.runQuery(
      internal.schedule.getHomeScheduleSignalMatches,
      {
        userId: userId as Id<"users">,
        startDate: matchStartDate,
        endDate: matchEndDate,
        availableDate: todayKey,
        nowMs: Date.now(),
      }
    );

    const applied: {
      patchedUserShows: number;
      patchedFeedProjections: number;
      clearedUserShows: number;
      clearedFeedProjections: number;
    } = await ctx.runMutation(
      internal.schedule.applyHomeScheduleSignals,
      {
        userId: userId as Id<"users">,
        matches: signalEvaluation.matches,
        checked: signalEvaluation.checked,
      }
    );

    const result: HomeScheduleSignalResult = {
      skipped: false,
      hydratedDays: hydrateResults.length,
      refreshedDays: hydrateResults.filter((result) => !result.cached).length,
      failedHydrationDays,
      matchedShows: signalEvaluation.matches.length,
      matchedEpisodes: signalEvaluation.matches.reduce(
        (sum: number, match: HomeScheduleSignalMatch) =>
          sum + match.matchedEpisodes,
        0
      ),
      ...applied,
    };

    console.info("Home watchlist schedule signal refresh", result);

    if (failedHydrationDays > 0) {
      return {
        ...result,
        reason: "schedule_hydration_failed",
      };
    }

    await ctx.runMutation(internal.shows.setMaintenanceCursor, {
      key: maintenanceKey,
      cursor: "done",
    });

    return result;
  },
});

export const runMonthlyHomeWatchlistScheduleSignalBackfill = internalAction({
  args: {},
  handler: async (ctx): Promise<MonthlyHomeScheduleSignalResult> => {
    const range = getPreviousUtcMonthRange(new Date());
    const maintenanceKey = `home-schedule-signal-monthly:v1:${range.month}`;
    let cursor =
      (await ctx.runQuery(internal.shows.getMaintenanceCursor, {
        key: maintenanceKey,
      })) ?? undefined;

    if (cursor === "done") {
      return {
        skipped: true,
        reason: "already_completed",
        month: range.month,
        startDate: range.startDate,
        endDate: range.endDate,
      };
    }

    const startDate = parseRequiredScheduleDateKey(
      range.startDate,
      "monthly schedule signal start date"
    ).date;
    const hydrateDates = Array.from({ length: range.days }, (_, index) =>
      formatDate(addUtcDays(startDate, index))
    );
    const hydrateResults = await hydrateScheduleDates(ctx, hydrateDates);
    const failedHydrationDays = hydrateResults.filter(
      (result) => result.hydrationFailed
    ).length;

    let scannedFeedProjections = 0;
    let processedUsers = 0;
    let matchedShows = 0;
    let matchedEpisodes = 0;
    let patchedUserShows = 0;
    let patchedFeedProjections = 0;
    const processedUserIds = new Set<string>();

    while (cursor !== "done") {
      const page: {
        scanned: number;
        userIds: Array<Id<"users">>;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.schedule.getHomeScheduleSignalCandidateUsersPage,
        {
          cursor,
          pageSize: MONTHLY_SIGNAL_USER_PAGE_SIZE,
        }
      );

      scannedFeedProjections += page.scanned;

      for (const userId of page.userIds) {
        const userKey = String(userId);
        if (processedUserIds.has(userKey)) {
          continue;
        }
        processedUserIds.add(userKey);

        const signalEvaluation: HomeScheduleSignalEvaluation = await ctx.runQuery(
          internal.schedule.getHomeScheduleSignalMatches,
          {
            userId,
            startDate: range.startDate,
            endDate: range.endDate,
            availableDate: range.endDate,
            nowMs: Date.now(),
          }
        );

        if (signalEvaluation.matches.length === 0) {
          processedUsers += 1;
          continue;
        }

        const applied: {
          patchedUserShows: number;
          patchedFeedProjections: number;
          clearedUserShows: number;
          clearedFeedProjections: number;
        } = await ctx.runMutation(internal.schedule.applyHomeScheduleSignals, {
          userId,
          matches: signalEvaluation.matches,
          checked: [],
        });

        processedUsers += 1;
        matchedShows += signalEvaluation.matches.length;
        matchedEpisodes += signalEvaluation.matches.reduce(
          (sum: number, match: HomeScheduleSignalMatch) =>
            sum + match.matchedEpisodes,
          0
        );
        patchedUserShows += applied.patchedUserShows;
        patchedFeedProjections += applied.patchedFeedProjections;
      }

      cursor = page.isDone ? "done" : (page.nextCursor ?? undefined);
      await ctx.runMutation(internal.shows.setMaintenanceCursor, {
        key: maintenanceKey,
        cursor: cursor ?? null,
      });
    }

    if (failedHydrationDays > 0) {
      await ctx.runMutation(internal.shows.setMaintenanceCursor, {
        key: maintenanceKey,
        cursor: null,
      });
    }

    const result: MonthlyHomeScheduleSignalResult = {
      skipped: false,
      month: range.month,
      startDate: range.startDate,
      endDate: range.endDate,
      scannedFeedProjections,
      processedUsers,
      hydratedDays: hydrateResults.length,
      refreshedDays: hydrateResults.filter((result) => !result.cached).length,
      failedHydrationDays,
      matchedShows,
      matchedEpisodes,
      patchedUserShows,
      patchedFeedProjections,
    };

    console.info("Monthly home watchlist schedule signal backfill", result);

    return result;
  },
});

export const getTodayScheduledWatchlistFeed = query({
  args: {
    date: v.string(),
    mediaFilter: v.optional(v.union(v.literal("tv"), v.literal("anime"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ScheduledWatchlistItem[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const dateKey = formatDate(
      getSafeClientTodayDate(args.date, Date.now())
    );
    const safeLimit = Math.max(1, Math.min(args.limit ?? 64, 128));
    const mediaFilter = args.mediaFilter;
    const typedUserId = userId as Id<"users">;
    const projectedFeed = await getProjectedTodayScheduledWatchlistFeed(ctx, {
      userId: typedUserId,
      date: dateKey,
      mediaFilter,
      limit: safeLimit,
    });

    if (projectedFeed !== null) {
      return projectedFeed;
    }

    const projections =
      mediaFilter === "tv"
        ? await ctx.db
            .query("feedProjections")
            .withIndex("by_user_media", (q) =>
              q.eq("userId", typedUserId).eq("mediaType", "tv")
            )
            .collect()
        : mediaFilter === "anime"
          ? await ctx.db
              .query("feedProjections")
              .withIndex("by_user_media", (q) =>
                q.eq("userId", typedUserId).eq("mediaType", "anime")
              )
              .collect()
          : (
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
                    q
                      .eq("userId", typedUserId)
                      .eq("mediaType", "anime")
                  )
                  .collect(),
              ])
            ).flat();

    const trackedShows = projections
      .filter(
        (projection) =>
          (projection.status === "watching" || projection.status === "completed") &&
          projection.watchedEpisodesCount > 0
      )
      .map((projection) => ({
        projection,
        watchlistId: getWatchlistIdForProjection(projection),
        showId: projection.showId,
        normalizedTitle: normalizeTitle(projection.title),
        mediaType: projection.mediaType as "tv" | "anime",
        status: projection.status,
        lastWatchedAt: projection.lastWatchedAt,
        tmdbId: projection.tmdbId,
        anilistId: projection.anilistId,
        tvmazeId: projection.tvmazeId,
      }))
      .filter(
        (tracked): tracked is typeof tracked & { watchlistId: string } =>
          typeof tracked.watchlistId === "string"
      );

    if (trackedShows.length === 0) {
      return [];
    }

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tmdbId === "number") {
        byExternalKey.set(`tmdb:${tracked.mediaType}:${tracked.tmdbId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
    }

    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) => q.eq("date", dateKey))
      .collect();

    const candidates: Array<{
      tracked: (typeof trackedShows)[number];
      entry: CompactScheduleEntry;
      sourceMatchesTracked: boolean;
      airtimeMs: number;
    }> = [];

    for (const row of rows) {
      const rowMediaType = row.mediaType as "tv" | "anime";
      const entries = parseCachedScheduleEntries(row.episodes);

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey
        );

        if (!tracked) {
          continue;
        }

        candidates.push({
          tracked,
          entry,
          sourceMatchesTracked: rowMediaType === tracked.mediaType,
          airtimeMs:
            getEpisodeAirtimeTimestamp(entry.episode.airDate) ??
            startOfDay(parseRequiredScheduleDateKey(dateKey, "scheduled watchlist date").date).getTime(),
        });
      }
    }

    if (candidates.length === 0) {
      return [];
    }

    const watchedEpisodes = await getWatchedScheduleEpisodeIndexForShows(
      ctx,
      typedUserId,
      candidates.map((candidate) => candidate.tracked.showId)
    );
    const proofEndDate = formatDate(
      addUtcDays(
        parseRequiredScheduleDateKey(
          dateKey,
          "scheduled watchlist proof date"
        ).date,
        HOME_SIGNAL_LOOKAHEAD_DAYS
      )
    );
    const proofRows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) => q.gte("date", dateKey).lte("date", proofEndDate))
      .collect();
    const scheduleOffsetRows: ScheduleEpisodeNumberLike[] = [];

    for (const proofRow of proofRows) {
      if (mediaFilter && proofRow.mediaType !== mediaFilter) {
        continue;
      }

      const rowMediaType = proofRow.mediaType as "tv" | "anime";
      const entries = parseCachedScheduleEntries(proofRow.episodes);

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey
        );

        if (!tracked) {
          continue;
        }

        scheduleOffsetRows.push({
          showId: tracked.showId,
          seasonNumber: entry.episode.seasonNumber,
          episodeNumber: entry.episode.episodeNumber,
          episodeName: entry.episode.name ?? null,
        });
      }
    }

    const scheduleAbsoluteSeasonOffsets = getScheduleAbsoluteSeasonOffsets(
      scheduleOffsetRows
    );

    const selectedByRoute = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      if (
        isWatchedScheduleEpisode(
          watchedEpisodes,
          candidate.tracked.showId,
          candidate.entry.episode.seasonNumber,
          candidate.entry.episode.episodeNumber,
          scheduleAbsoluteSeasonOffsets
        )
      ) {
        continue;
      }

      const existing = selectedByRoute.get(candidate.tracked.watchlistId);
      if (!existing) {
        selectedByRoute.set(candidate.tracked.watchlistId, candidate);
        continue;
      }

      const shouldReplace =
        (!existing.sourceMatchesTracked && candidate.sourceMatchesTracked) ||
        (existing.sourceMatchesTracked === candidate.sourceMatchesTracked &&
          (shouldPreferScheduleCandidate(candidate.tracked, existing.tracked) ||
            shouldPreferSameTrackedShowDayEpisode(candidate.entry, existing.entry)));

      if (shouldReplace) {
        selectedByRoute.set(candidate.tracked.watchlistId, candidate);
      }
    }

    return Array.from(selectedByRoute.values())
      .sort((a, b) => {
        if (a.airtimeMs !== b.airtimeMs) {
          return a.airtimeMs - b.airtimeMs;
        }
        return a.tracked.projection.title.localeCompare(b.tracked.projection.title);
      })
      .slice(0, safeLimit)
      .map((candidate) =>
        serializeScheduledWatchlistItem(candidate.tracked.projection)
      )
      .filter((item): item is ScheduledWatchlistItem => item !== null);
  },
});

export const getUpcomingSchedule = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    mediaFilter: v.optional(v.union(v.literal("tv"), v.literal("anime"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    
    // Intentionally return an empty list for unauthenticated requests.
    // This keeps pre-auth/SSR rendering paths safe without throwing.
    if (!userId) {
      return [];
    }

    const typedUserId = userId as Id<"users">;
    const range = getScheduleRangeKeys(args.startDate, args.endDate);
    
    const today = startOfDay(new Date());

    // Use feedProjections to avoid N+1 userShows→shows reads.
    // Each projection already has the denormalized show metadata we need.
    // Query only TV/Anime projections to avoid scanning movie rows.
    const mediaFilter = args.mediaFilter;
    const projectedSchedule = await getProjectedUpcomingSchedule(ctx, {
      userId: typedUserId,
      startDate: range.startDate,
      endDate: range.endDate,
      mediaFilter,
    });

    if (projectedSchedule !== null) {
      return projectedSchedule;
    }

    const nonMovieProjections = mediaFilter === "tv"
      ? await ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", typedUserId).eq("mediaType", mediaFilter)
          )
          .collect()
      : (
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
          ])
        ).flat();

    if (nonMovieProjections.length === 0) {
      return [] as {
        date: string;
        episodes: {
          routeId: string | null;
          showTitle: string;
          mediaType: "tv" | "anime";
          posterUrl?: string;
          daysUntil: number;
          episode: {
            seasonNumber: number;
            episodeNumber: number;
            name?: string;
            airDate?: string;
          };
        }[];
      }[];
    }

    // Build lookup maps from projection data (zero extra reads).
    const trackedShows = nonMovieProjections.map((p) => ({
      title: p.title,
      normalizedTitle: normalizeTitle(p.title),
      mediaType: p.mediaType as "tv" | "anime",
      status: p.status,
      lastWatchedAt: p.lastWatchedAt,
      posterUrl: p.posterUrl ?? undefined,
      routeId: getWatchlistIdForProjection(p),
      tmdbId: p.tmdbId,
      anilistId: p.anilistId,
      tvmazeId: p.tvmazeId,
    }));

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tmdbId === "number") {
        byExternalKey.set(`tmdb:${tracked.mediaType}:${tracked.tmdbId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
    }

    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) =>
        q.gte("date", range.startDate).lte("date", range.endDate)
      )
      .collect();

    const grouped = new Map<
      string,
      {
        routeId: string | null;
        showTitle: string;
        mediaType: "tv" | "anime";
        posterUrl?: string;
        daysUntil: number;
        episode: {
          seasonNumber: number;
          episodeNumber: number;
          name?: string;
          airDate?: string;
        };
      }[]
    >();
    const dedupe = new Map<
      string,
      {
        dayKey: string;
        index: number;
        sourceMatchesTracked: boolean;
        entry: CompactScheduleEntry;
        tracked: (typeof trackedShows)[number];
      }
    >();
    const sameTrackedShowDayDedupe = new Map<
      string,
      {
        dayKey: string;
        index: number;
        entry: CompactScheduleEntry;
        sourceMatchesTracked: boolean;
        tracked: (typeof trackedShows)[number];
      }
    >();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);
      const rowMediaType = row.mediaType as "tv" | "anime";

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey
        );

        if (!tracked) continue;
        if (tracked.mediaType !== "tv" && tracked.mediaType !== "anime") continue;
        if (args.mediaFilter && tracked.mediaType !== args.mediaFilter) continue;

        const dayKey = row.date;
        const bucketDate = parseScheduleDateKey(dayKey);
        if (!bucketDate) continue;

        const daysUntil = Math.floor(
          (startOfDay(bucketDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (!grouped.has(dayKey)) {
          grouped.set(dayKey, []);
        }

        const sourceMatchesTracked = rowMediaType === tracked.mediaType;
        const seriesKey = getScheduleSeriesDedupeTitle(
          tracked.normalizedTitle.length <= entry.normalizedTitle.length
            ? tracked.normalizedTitle
            : entry.normalizedTitle
        );
        const uniqueKey = `${dayKey}:${seriesKey}:${getScheduleEpisodeDedupeKey(entry.episode)}`;
        const existing = dedupe.get(uniqueKey);
        const existingEpisode = existing ? grouped.get(existing.dayKey)?.[existing.index] : undefined;
        const sameTrackedShowDayKey = `${dayKey}:${tracked.routeId ?? seriesKey}`;
        const sameDayExisting = sameTrackedShowDayDedupe.get(sameTrackedShowDayKey);
        const sameDayExistingEpisode = sameDayExisting
          ? grouped.get(sameDayExisting.dayKey)?.[sameDayExisting.index]
          : undefined;
        if (
          sameDayExisting &&
          sameDayExistingEpisode &&
          shouldCollapseSameTrackedShowDay(entry, sameDayExisting.entry)
        ) {
          const shouldReplaceSameDayExisting =
            (!sameDayExisting.sourceMatchesTracked && sourceMatchesTracked) ||
            ((sameDayExisting.sourceMatchesTracked === sourceMatchesTracked) &&
              (shouldPreferScheduleCandidate(tracked, sameDayExisting.tracked) ||
                shouldPreferSameTrackedShowDayEpisode(entry, sameDayExisting.entry)));

          if (shouldReplaceSameDayExisting) {
            const scheduleEpisode = {
              routeId: tracked.routeId,
              showTitle: tracked.title,
              mediaType: tracked.mediaType,
              posterUrl: tracked.posterUrl,
              daysUntil,
              episode: {
                seasonNumber: entry.episode.seasonNumber,
                episodeNumber: entry.episode.episodeNumber,
                ...(entry.episode.name ? { name: entry.episode.name } : {}),
                ...(entry.episode.airDate ? { airDate: entry.episode.airDate } : {}),
              },
            };

            grouped.get(sameDayExisting.dayKey)![sameDayExisting.index] = scheduleEpisode;
            sameTrackedShowDayDedupe.set(sameTrackedShowDayKey, {
              dayKey: sameDayExisting.dayKey,
              index: sameDayExisting.index,
              entry,
              sourceMatchesTracked,
              tracked,
            });
          }
          continue;
        }

        const shouldReplaceExisting =
          !!existing &&
          ((!existing.sourceMatchesTracked && sourceMatchesTracked) ||
            ((existing.sourceMatchesTracked === sourceMatchesTracked) &&
              (shouldPreferScheduleCandidate(tracked, existing.tracked) ||
                (existingEpisode &&
                  shouldPreferScheduleEpisode(
                    {
                      episode: {
                        airDate: entry.episode.airDate,
                      },
                    },
                    existingEpisode
                  )))));
        if (existing && !shouldReplaceExisting) continue;

        const scheduleEpisode = {
          routeId: tracked.routeId,
          showTitle: tracked.title,
          mediaType: tracked.mediaType,
          posterUrl: tracked.posterUrl,
          daysUntil,
          episode: {
            seasonNumber: entry.episode.seasonNumber,
            episodeNumber: entry.episode.episodeNumber,
            ...(entry.episode.name ? { name: entry.episode.name } : {}),
            ...(entry.episode.airDate ? { airDate: entry.episode.airDate } : {}),
          },
        };

        const dayEpisodes = grouped.get(dayKey)!;
        if (existing) {
          dayEpisodes[existing.index] = scheduleEpisode;
          dedupe.set(uniqueKey, {
            dayKey,
            index: existing.index,
            entry,
            sourceMatchesTracked,
            tracked,
          });
          sameTrackedShowDayDedupe.set(sameTrackedShowDayKey, {
            dayKey,
            index: existing.index,
            entry,
            sourceMatchesTracked,
            tracked,
          });
          continue;
        }

        dayEpisodes.push(scheduleEpisode);
        dedupe.set(uniqueKey, {
          dayKey,
          index: dayEpisodes.length - 1,
          entry,
          sourceMatchesTracked,
          tracked,
        });
        sameTrackedShowDayDedupe.set(sameTrackedShowDayKey, {
          dayKey,
          index: dayEpisodes.length - 1,
          entry,
          sourceMatchesTracked,
          tracked,
        });
      }
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, episodes]) => ({
        date,
        episodes: episodes.sort((a, b) => {
          const aAirtime = getEpisodeAirtimeTimestamp(a.episode.airDate);
          const bAirtime = getEpisodeAirtimeTimestamp(b.episode.airDate);

          if (aAirtime !== null && bAirtime !== null && aAirtime !== bAirtime) {
            return aAirtime - bAirtime;
          }

          if (aAirtime !== null || bAirtime !== null) {
            return aAirtime === null ? 1 : -1;
          }

          return a.showTitle.localeCompare(b.showTitle);
        }),
      }));
  },
});

async function getFutureUpcomingCountsForUser(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    mediaFilter?: "tv" | "anime";
  }
): Promise<WatchlistFutureCountRow[]> {
    const range = getScheduleRangeKeys(args.startDate, args.endDate);
    const today = startOfDay(new Date());
    const mediaFilter = args.mediaFilter;
    const projectedCounts = await getProjectedFutureUpcomingCountsForUser(ctx, {
      userId: args.userId,
      startDate: range.startDate,
      endDate: range.endDate,
      mediaFilter,
    });

    if (projectedCounts !== null) {
      return projectedCounts;
    }

    const nonMovieProjections = mediaFilter === "tv"
      ? await ctx.db
          .query("feedProjections")
          .withIndex("by_user_media", (q) =>
            q.eq("userId", args.userId).eq("mediaType", mediaFilter)
          )
          .collect()
      : (
          await Promise.all([
            ctx.db
              .query("feedProjections")
              .withIndex("by_user_media", (q) =>
                q.eq("userId", args.userId).eq("mediaType", "tv")
              )
              .collect(),
            ctx.db
              .query("feedProjections")
              .withIndex("by_user_media", (q) =>
                q.eq("userId", args.userId).eq("mediaType", "anime")
              )
              .collect(),
          ])
        ).flat();

    if (nonMovieProjections.length === 0) {
      return [] as WatchlistFutureCountRow[];
    }

    const trackedShows = nonMovieProjections.map((p) => ({
      showId: p.showId,
      normalizedTitle: normalizeTitle(p.title),
      mediaType: p.mediaType as "tv" | "anime",
      status: p.status,
      lastWatchedAt: p.lastWatchedAt,
      watchlistId: getWatchlistIdForProjection(p),
      tmdbId: p.tmdbId,
      anilistId: p.anilistId,
      tvmazeId: p.tvmazeId,
    }));

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tmdbId === "number") {
        byExternalKey.set(`tmdb:${tracked.mediaType}:${tracked.tmdbId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
    }

    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) =>
        q.gte("date", range.startDate).lte("date", range.endDate)
      )
      .collect();

    const counts = new Map<
      string,
      { availableCount: number; futureCount: number; unavailableCount: number }
    >();
    const countCandidates: Array<{
      dayKey: string;
      daysUntil: number;
      entry: CompactScheduleEntry;
      tracked: (typeof trackedShows)[number] & { watchlistId: string };
    }> = [];
    const dedupe = new Set<string>();
    const sameTrackedShowDayDedupe = new Map<string, CompactScheduleEntry>();
    const nowMs = Date.now();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);
      const rowMediaType = row.mediaType as "tv" | "anime";

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey
        );

        if (!tracked || !tracked.watchlistId) continue;
        if (tracked.mediaType !== "tv" && tracked.mediaType !== "anime") continue;
        if (args.mediaFilter && tracked.mediaType !== args.mediaFilter) continue;

        const dayKey = row.date;
        const bucketDate = parseScheduleDateKey(dayKey);
        if (!bucketDate) continue;

        const daysUntil = Math.floor(
          (startOfDay(bucketDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        const seriesKey = getScheduleSeriesDedupeTitle(
          tracked.normalizedTitle.length <= entry.normalizedTitle.length
            ? tracked.normalizedTitle
            : entry.normalizedTitle
        );
        const uniqueKey = `${tracked.watchlistId}:${dayKey}:${seriesKey}:${getScheduleEpisodeDedupeKey(entry.episode)}`;
        if (dedupe.has(uniqueKey)) continue;
        const sameTrackedShowDayKey = `${tracked.watchlistId}:${dayKey}`;
        const sameTrackedShowDayEntry = sameTrackedShowDayDedupe.get(sameTrackedShowDayKey);
        if (
          sameTrackedShowDayEntry &&
          shouldCollapseSameTrackedShowDay(entry, sameTrackedShowDayEntry)
        ) {
          continue;
        }
        dedupe.add(uniqueKey);
        sameTrackedShowDayDedupe.set(sameTrackedShowDayKey, entry);

        countCandidates.push({
          dayKey,
          daysUntil,
          entry,
          tracked: tracked as (typeof trackedShows)[number] & {
            watchlistId: string;
          },
        });
      }
    }

    const watchedEpisodes = await getWatchedScheduleEpisodeIndexForShows(
      ctx,
      args.userId,
      countCandidates.map((candidate) => candidate.tracked.showId)
    );
    const scheduleAbsoluteSeasonOffsets = getScheduleAbsoluteSeasonOffsets(
      countCandidates.map((candidate) => ({
        showId: candidate.tracked.showId,
        seasonNumber: candidate.entry.episode.seasonNumber,
        episodeNumber: candidate.entry.episode.episodeNumber,
        episodeName: candidate.entry.episode.name ?? null,
      }))
    );

    for (const candidate of countCandidates) {
      if (
        isWatchedScheduleEpisode(
          watchedEpisodes,
          candidate.tracked.showId,
          candidate.entry.episode.seasonNumber,
          candidate.entry.episode.episodeNumber,
          scheduleAbsoluteSeasonOffsets
        )
      ) {
        continue;
      }

      const airtimeMs = getEpisodeAirtimeTimestamp(candidate.entry.episode.airDate);
      const isFutureDay = candidate.daysUntil > 0;
      const isTodayBeforeAirtime =
        candidate.daysUntil === 0 && airtimeMs !== null && airtimeMs > nowMs;
      const existing = counts.get(candidate.tracked.watchlistId) ?? {
        availableCount: 0,
        futureCount: 0,
        unavailableCount: 0,
      };
      if (!isFutureDay && !isTodayBeforeAirtime) {
        existing.availableCount += 1;
        counts.set(candidate.tracked.watchlistId, existing);
        continue;
      }
      if (isFutureDay) {
        existing.futureCount += 1;
      }
      existing.unavailableCount += 1;
      counts.set(candidate.tracked.watchlistId, existing);
    }

    return Array.from(counts.entries())
      .sort(([routeIdA], [routeIdB]) => routeIdA.localeCompare(routeIdB))
      .map(([routeId, count]) => ({
        routeId,
        availableCount: count.availableCount,
        futureCount: count.futureCount,
        unavailableCount: count.unavailableCount,
      }));
}

export const getFutureUpcomingCountsForWatchlistForUser = internalQuery({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    mediaFilter: v.optional(v.union(v.literal("tv"), v.literal("anime"))),
  },
  handler: async (ctx, args) => getFutureUpcomingCountsForUser(ctx, args),
});

export const getFutureUpcomingCountsForWatchlist = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    mediaFilter: v.optional(v.union(v.literal("tv"), v.literal("anime"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      return [] as WatchlistFutureCountRow[];
    }

    return getFutureUpcomingCountsForUser(ctx, {
      userId: userId as Id<"users">,
      ...args,
    });
  },
});
