import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
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
import { api, internal } from "@/convex/_generated/api";

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
  reason?: "unauthenticated" | "already_ran_today" | "schedule_hydration_failed";
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

function getTitleLookupKey(mediaType: "tv" | "anime", normalizedTitle: string) {
  return `${mediaType}:${normalizedTitle}`;
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

function findTrackedScheduleMatch<T extends {
  mediaType: "tv" | "anime";
  normalizedTitle: string;
  anilistId?: number;
  tvmazeId?: number;
}>(
  entry: CompactScheduleEntry,
  mediaType: "tv" | "anime",
  trackedShows: T[],
  byExternalKey: Map<string, T>,
  byTitle: Map<string, T>
) {
  const exactMatch =
    byExternalKey.get(entry.showId) ??
    byTitle.get(getTitleLookupKey(mediaType, entry.normalizedTitle));

  if (exactMatch) {
    return exactMatch;
  }

  if (mediaType !== "anime") {
    return null;
  }

  const titleCandidates = trackedShows.filter(
    (tracked) =>
      tracked.mediaType === mediaType &&
      isAnimeSeasonTitleVariant(entry.normalizedTitle, tracked.normalizedTitle)
  );

  if (titleCandidates.length === 0) {
    return null;
  }

  titleCandidates.sort((a, b) => {
    const mediaTypeDelta =
      Number(b.mediaType === mediaType) - Number(a.mediaType === mediaType);
    if (mediaTypeDelta !== 0) {
      return mediaTypeDelta;
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
  if (typeof p.imdbId === "string") {
    return `imdb:${p.mediaType}:${p.imdbId}`;
  }
  return null;
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

export const upsertScheduleBucket = mutation({
  args: {
    date: v.string(),
    mediaType: v.union(v.literal("tv"), v.literal("anime")),
    episodes: v.string(),
    lastUpdated: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: unauthenticated access to schedule cache");
    }

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

export const getScheduleCacheStatusForDate = query({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: unauthenticated access to schedule cache");
    }

    const now = Date.now();
    const todayKey = formatDate(new Date());
    const dateKey = parseRequiredScheduleDateKey(args.date, "schedule cache date").key;
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
      (args.date < todayKey && tvLastUpdated !== null) ||
      (typeof tvLastUpdated === "number" &&
        now - tvLastUpdated < SCHEDULE_CACHE_FRESH_MS);
    const hasFreshAnimeByTime =
      typeof animeLastUpdated === "number" &&
      now - animeLastUpdated < SCHEDULE_CACHE_FRESH_MS;
    const shouldForceRefreshPastAnimeZero =
      animeCount === 0 && dateKey === todayKey;
    const hasFreshAnime =
      ((args.date < todayKey && animeLastUpdated !== null) || hasFreshAnimeByTime) &&
      !shouldForceRefreshPastAnimeZero;

    return {
      tvCount,
      animeCount,
      hasFreshTv,
      hasFreshAnime,
    } as DateCacheStatus;
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
    api.schedule.getScheduleCacheStatusForDate,
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
    await ctx.runMutation(api.schedule.upsertScheduleBucket, {
      date,
      mediaType: "tv",
      episodes: JSON.stringify(compactTvEntries),
      lastUpdated: now,
    });
  }

  if (!animeFetchRateLimited && !animeFetchFailed) {
    await ctx.runMutation(api.schedule.upsertScheduleBucket, {
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

export const hydrateScheduleDate = action({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    return hydrateOneDate(ctx, args.date);
  },
});

export const hydrateScheduleRange = action({
  args: {
    startDate: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

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
        anilistId: projection.anilistId,
        tvmazeId: projection.tvmazeId,
      }));

    if (trackedShows.length === 0) {
      return { matches: [], checked: [] };
    }

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();
    const byTitle = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
      byTitle.set(
        getTitleLookupKey(tracked.mediaType, tracked.normalizedTitle),
        tracked
      );
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
      signalAt: number;
      latestEpisodeKey: string;
    }> = [];
    const dedupe = new Set<string>();

    for (const row of rows) {
      const bucketDate = parseScheduleDateKey(row.date);
      if (!bucketDate) {
        continue;
      }

      const bucketDayStartMs = startOfDay(bucketDate).getTime();
      if (bucketDayStartMs > availableDayStartMs) {
        continue;
      }

      const rowMediaType = row.mediaType as "tv" | "anime";
      const entries = parseCachedScheduleEntries(row.episodes);

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey,
          byTitle
        );

        if (!tracked) {
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
          signalAt,
          latestEpisodeKey,
        });
      }
    }

    const candidateShowIds = Array.from(
      new Set(candidates.map((candidate) => candidate.tracked.showId))
    );
    const watchedEpisodeKeys = new Set<string>();
    await Promise.all(
      candidateShowIds.map(async (showId) => {
        const watchedEpisodes = await ctx.db
          .query("watchedEpisodes")
          .withIndex("by_user_show", (q) =>
            q.eq("userId", args.userId).eq("showId", showId)
          )
          .collect();

        for (const watched of watchedEpisodes) {
          watchedEpisodeKeys.add(`${showId}:${watched.season}:${watched.episode}`);
        }
      })
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
        watchedEpisodeKeys.has(
          `${candidate.tracked.showId}:${candidate.seasonNumber}:${candidate.episodeNumber}`
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

export const ensureHomeWatchlistScheduleSignals = action({
  args: {},
  handler: async (ctx): Promise<HomeScheduleSignalResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        skipped: true,
        reason: "unauthenticated",
      };
    }

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
      posterUrl: p.posterUrl ?? undefined,
      routeId: getWatchlistIdForProjection(p),
      anilistId: p.anilistId,
      tvmazeId: p.tvmazeId,
    }));

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();
    const byTitle = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
      byTitle.set(
        getTitleLookupKey(tracked.mediaType, tracked.normalizedTitle),
        tracked
      );
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
      { dayKey: string; index: number; sourceMatchesTracked: boolean }
    >();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);
      const rowMediaType = row.mediaType as "tv" | "anime";

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey,
          byTitle
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
        const uniqueKey = `${dayKey}:${tracked.routeId ?? entry.showId}:${entry.episode.episodeNumber}`;
        const existing = dedupe.get(uniqueKey);
        if (existing?.sourceMatchesTracked && !sourceMatchesTracked) {
          continue;
        }

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
          if (sourceMatchesTracked && !existing.sourceMatchesTracked) {
            dayEpisodes[existing.index] = scheduleEpisode;
            dedupe.set(uniqueKey, {
              dayKey,
              index: existing.index,
              sourceMatchesTracked,
            });
          }
          continue;
        }

        dayEpisodes.push(scheduleEpisode);
        dedupe.set(uniqueKey, {
          dayKey,
          index: dayEpisodes.length - 1,
          sourceMatchesTracked,
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
      normalizedTitle: normalizeTitle(p.title),
      mediaType: p.mediaType as "tv" | "anime",
      watchlistId: getWatchlistIdForProjection(p),
      anilistId: p.anilistId,
      tvmazeId: p.tvmazeId,
    }));

    const byExternalKey = new Map<string, (typeof trackedShows)[number]>();
    const byTitle = new Map<string, (typeof trackedShows)[number]>();

    for (const tracked of trackedShows) {
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
      byTitle.set(
        getTitleLookupKey(tracked.mediaType, tracked.normalizedTitle),
        tracked
      );
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
    const dedupe = new Set<string>();
    const nowMs = Date.now();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);
      const rowMediaType = row.mediaType as "tv" | "anime";

      for (const entry of entries) {
        const tracked = findTrackedScheduleMatch(
          entry,
          rowMediaType,
          trackedShows,
          byExternalKey,
          byTitle
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

        const uniqueKey = `${tracked.watchlistId}:${dayKey}:${entry.episode.episodeNumber}`;
        if (dedupe.has(uniqueKey)) continue;
        dedupe.add(uniqueKey);

        const airtimeMs = getEpisodeAirtimeTimestamp(entry.episode.airDate);
        const isFutureDay = daysUntil > 0;
        const isTodayBeforeAirtime = daysUntil === 0 && airtimeMs !== null && airtimeMs > nowMs;
        const existing = counts.get(tracked.watchlistId) ?? {
          availableCount: 0,
          futureCount: 0,
          unavailableCount: 0,
        };
        if (!isFutureDay && !isTodayBeforeAirtime) {
          existing.availableCount += 1;
          counts.set(tracked.watchlistId, existing);
          continue;
        }
        if (isFutureDay) {
          existing.futureCount += 1;
        }
        existing.unavailableCount += 1;
        counts.set(tracked.watchlistId, existing);
      }
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
