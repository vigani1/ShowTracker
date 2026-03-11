import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "@/convex/_generated/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { ActionCtx } from "@/convex/_generated/server";
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
    };
  },
});

export const setRateLimitState = internalMutation({
  args: {
    key: v.string(),
    lastAttemptTime: v.number(),
    nextRetryTime: v.number(),
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

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getTitleLookupKey(mediaType: "tv" | "anime", normalizedTitle: string) {
  return `${mediaType}:${normalizedTitle}`;
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
  const date = new Date(dateString);
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

    const existing = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date_type", (q) =>
        q.eq("date", args.date).eq("mediaType", args.mediaType)
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
      date: args.date,
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
    const rows = await ctx.db
      .query("scheduleCache")
      .withIndex("by_date", (q) => q.eq("date", args.date))
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
      animeCount === 0 && args.date === todayKey;
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
  let animeFetchRateLimited = false;

  try {
    const tvSchedule = await getTvMazeScheduleByDate(date, "US");
    tvEntries = tvSchedule.map((entry) => normalizeTvMazeScheduleEntry(entry));
  } catch (error) {
    console.error(`Failed TV schedule fetch for ${date}`, error);
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
          });
          break;
        }

        console.error(`Failed anime schedule fetch for ${date}`, error);
        break;
      }
    }
  }

  const compactTvEntries = compactScheduleEntries(tvEntries);
  const compactAnimeEntries = compactScheduleEntries(animeEntries);

  await ctx.runMutation(api.schedule.upsertScheduleBucket, {
    date,
    mediaType: "tv",
    episodes: JSON.stringify(compactTvEntries),
    lastUpdated: now,
  });

  if (!animeFetchRateLimited) {
    await ctx.runMutation(api.schedule.upsertScheduleBucket, {
      date,
      mediaType: "anime",
      episodes: JSON.stringify(compactAnimeEntries),
      lastUpdated: now,
    });
  }

  return {
    date,
    tvCount: compactTvEntries.length,
    animeCount: animeFetchRateLimited ? cacheStatus.animeCount : compactAnimeEntries.length,
    cached: false,
    animeRateLimited: animeFetchRateLimited,
  };
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

    const startDate = new Date(args.startDate);
    const safeDays = Math.max(1, Math.min(args.days, 42));
    const dateKeys = Array.from({ length: safeDays }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      return formatDate(date);
    });

    const results: {
      date: string;
      tvCount: number;
      animeCount: number;
      cached: boolean;
      animeRateLimited?: boolean;
    }[] = [];
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

    return {
      days: safeDays,
      results,
    };
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
    
    const today = startOfDay(new Date());

    // Use feedProjections to avoid N+1 userShows→shows reads.
    // Each projection already has the denormalized show metadata we need.
    // Query only TV/Anime projections to avoid scanning movie rows.
    const mediaFilter = args.mediaFilter;

    const nonMovieProjections = mediaFilter
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
      routeId: getRouteIdForProjection(p),
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

    const rows = mediaFilter
      ? await ctx.db
          .query("scheduleCache")
          .withIndex("by_type_date", (q) =>
            q
              .eq("mediaType", mediaFilter)
              .gte("date", args.startDate)
              .lte("date", args.endDate)
          )
          .collect()
      : await ctx.db
          .query("scheduleCache")
          .withIndex("by_date", (q) =>
            q.gte("date", args.startDate).lte("date", args.endDate)
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
    const dedupe = new Set<string>();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);

      for (const entry of entries) {
        const tracked =
          byExternalKey.get(entry.showId) ??
          byTitle.get(
            getTitleLookupKey(row.mediaType as "tv" | "anime", entry.normalizedTitle)
          );

        if (!tracked) continue;
        if (tracked.mediaType !== "tv" && tracked.mediaType !== "anime") continue;
        if (args.mediaFilter && tracked.mediaType !== args.mediaFilter) continue;

        const episodeDate = entry.episode.airDate
          ? new Date(entry.episode.airDate)
          : new Date(row.date);
        const validDate = Number.isFinite(episodeDate.getTime())
          ? episodeDate
          : new Date(row.date);
        const dayKey = formatDate(validDate);
        const daysUntil = Math.floor(
          (startOfDay(validDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        const uniqueKey = `${dayKey}:${tracked.routeId ?? entry.showId}:${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
        if (dedupe.has(uniqueKey)) continue;
        dedupe.add(uniqueKey);

        if (!grouped.has(dayKey)) {
          grouped.set(dayKey, []);
        }

        grouped.get(dayKey)!.push({
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
        });
      }
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, episodes]) => ({
        date,
        episodes: episodes.sort((a, b) => {
          if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
          return a.showTitle.localeCompare(b.showTitle);
        }),
      }));
  },
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
      return [] as { routeId: string; futureCount: number }[];
    }

    const typedUserId = userId as Id<"users">;
    const today = startOfDay(new Date());
    const mediaFilter = args.mediaFilter;

    const nonMovieProjections = mediaFilter
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
      return [] as { routeId: string; futureCount: number }[];
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

    const rows = mediaFilter
      ? await ctx.db
          .query("scheduleCache")
          .withIndex("by_type_date", (q) =>
            q
              .eq("mediaType", mediaFilter)
              .gte("date", args.startDate)
              .lte("date", args.endDate)
          )
          .collect()
      : await ctx.db
          .query("scheduleCache")
          .withIndex("by_date", (q) =>
            q.gte("date", args.startDate).lte("date", args.endDate)
          )
          .collect();

    const counts = new Map<string, number>();
    const dedupe = new Set<string>();

    for (const row of rows) {
      const entries = parseCachedScheduleEntries(row.episodes);

      for (const entry of entries) {
        const tracked =
          byExternalKey.get(entry.showId) ??
          byTitle.get(
            getTitleLookupKey(row.mediaType as "tv" | "anime", entry.normalizedTitle)
          );

        if (!tracked || !tracked.watchlistId) continue;
        if (tracked.mediaType !== "tv" && tracked.mediaType !== "anime") continue;
        if (args.mediaFilter && tracked.mediaType !== args.mediaFilter) continue;

        const episodeDate = entry.episode.airDate
          ? new Date(entry.episode.airDate)
          : new Date(row.date);
        const validDate = Number.isFinite(episodeDate.getTime())
          ? episodeDate
          : new Date(row.date);
        const dayKey = formatDate(validDate);
        const daysUntil = Math.floor(
          (startOfDay(validDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil <= 0) {
          continue;
        }

        const uniqueKey = `${tracked.watchlistId}:${dayKey}:${entry.episode.seasonNumber}:${entry.episode.episodeNumber}`;
        if (dedupe.has(uniqueKey)) continue;
        dedupe.add(uniqueKey);

        counts.set(tracked.watchlistId, (counts.get(tracked.watchlistId) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort(([routeIdA], [routeIdB]) => routeIdA.localeCompare(routeIdB))
      .map(([routeId, futureCount]) => ({ routeId, futureCount }));
  },
});
