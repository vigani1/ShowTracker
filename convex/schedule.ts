import { action, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAniListAiringSchedule } from "../lib/api/anilist";
import {
  normalizeAniListScheduleEntry,
  normalizeTvMazeScheduleEntry,
} from "../lib/api/normalize";
import type { NormalizedScheduleEntry } from "../lib/api/types";
import { getTvMazeScheduleByDate } from "../lib/api/tvmaze";
import { api } from "./_generated/api";
import { auth } from "./auth";

const HYDRATE_BATCH_SIZE = 3;
const SCHEDULE_CACHE_FRESH_MS = 1000 * 60 * 60 * 6;
const MAX_ANILIST_SCHEDULE_PAGES = 8;

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

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function getRouteIdForShow(show: Doc<"shows">): string | null {
  if (
    typeof show.tmdbId === "number" &&
    (show.mediaType === "tv" || show.mediaType === "movie")
  ) {
    return `tmdb:${show.mediaType}:${show.tmdbId}`;
  }
  if (typeof show.anilistId === "number" && show.mediaType === "anime") {
    return `anilist:anime:${show.anilistId}`;
  }
  if (typeof show.malId === "number" && show.mediaType === "anime") {
    return `jikan:anime:${show.malId}`;
  }
  return null;
}

async function getCurrentUserId(ctx: QueryCtx) {
  const userId = await auth.getUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
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
      typeof tvLastUpdated === "number" && now - tvLastUpdated < SCHEDULE_CACHE_FRESH_MS;
    const hasFreshAnimeByTime =
      typeof animeLastUpdated === "number" &&
      now - animeLastUpdated < SCHEDULE_CACHE_FRESH_MS;
    const shouldForceRefreshPastAnimeZero =
      animeCount === 0 && args.date <= todayKey;
    const hasFreshAnime = hasFreshAnimeByTime && !shouldForceRefreshPastAnimeZero;

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
): Promise<{ date: string; tvCount: number; animeCount: number; cached: boolean }> {
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
    };
  }

  const { start, end } = getUnixRangeForDate(date);

  let tvEntries: NormalizedScheduleEntry[] = [];
  let animeEntries: NormalizedScheduleEntry[] = [];

  try {
    const tvSchedule = await getTvMazeScheduleByDate(date, "US");
    tvEntries = tvSchedule.map((entry) => normalizeTvMazeScheduleEntry(entry));
  } catch (error) {
    console.error(`Failed TV schedule fetch for ${date}`, error);
  }

  try {
    for (
      let page = 1;
      page <= MAX_ANILIST_SCHEDULE_PAGES;
      page += 1
    ) {
      const animeSchedule = await getAniListAiringSchedule(page, 50, start, end);
      animeEntries.push(
        ...animeSchedule.data.Page.airingSchedules.map((entry) =>
          normalizeAniListScheduleEntry(entry)
        )
      );

      if (!animeSchedule.data.Page.pageInfo?.hasNextPage) {
        break;
      }
    }
  } catch (error) {
    console.error(`Failed anime schedule fetch for ${date}`, error);
  }

  const compactTvEntries = compactScheduleEntries(tvEntries);
  const compactAnimeEntries = compactScheduleEntries(animeEntries);

  await ctx.runMutation(api.schedule.upsertScheduleBucket, {
    date,
    mediaType: "tv",
    episodes: JSON.stringify(compactTvEntries),
    lastUpdated: now,
  });

  await ctx.runMutation(api.schedule.upsertScheduleBucket, {
    date,
    mediaType: "anime",
    episodes: JSON.stringify(compactAnimeEntries),
    lastUpdated: now,
  });

  return {
    date,
    tvCount: compactTvEntries.length,
    animeCount: compactAnimeEntries.length,
    cached: false,
  };
}

export const hydrateScheduleDate = action({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    return hydrateOneDate(ctx, args.date);
  },
});

export const hydrateScheduleRange = action({
  args: {
    startDate: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    const startDate = new Date(args.startDate);
    const safeDays = Math.max(1, Math.min(args.days, 30));
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
    }[] = [];

    for (let index = 0; index < dateKeys.length; index += HYDRATE_BATCH_SIZE) {
      const batch = dateKeys.slice(index, index + HYDRATE_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((dateKey) => hydrateOneDate(ctx, dateKey))
      );
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
    const userId = await getCurrentUserId(ctx);
    const today = startOfDay(new Date());

    const userShows = await ctx.db
      .query("userShows")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Include all tracked shows (watching, plan_to_watch, paused, completed, dropped)
    // Filter out movies since they don't have episode schedules
    const trackedUserShows = userShows;

    if (trackedUserShows.length === 0) {
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

    const trackedShows = await Promise.all(
      trackedUserShows.map(async (userShow) => {
        const show = await ctx.db.get(userShow.showId);
        if (!show || show.mediaType === "movie") {
          return null;
        }
        const routeId = getRouteIdForShow(show);
        return {
          title: show.title,
          normalizedTitle: normalizeTitle(show.title),
          mediaType: show.mediaType,
          posterUrl: show.posterUrl ?? undefined,
          routeId,
          anilistId: show.anilistId,
          tvmazeId: show.tvmazeId,
        };
      })
    );

    const byExternalKey = new Map<string, NonNullable<(typeof trackedShows)[number]>>();
    const byTitle = new Map<string, NonNullable<(typeof trackedShows)[number]>>();

    for (const tracked of trackedShows) {
      if (!tracked) continue;
      if (typeof tracked.anilistId === "number") {
        byExternalKey.set(`anilist:${tracked.anilistId}`, tracked);
      }
      if (typeof tracked.tvmazeId === "number") {
        byExternalKey.set(`tvmaze:${tracked.tvmazeId}`, tracked);
      }
      byTitle.set(tracked.normalizedTitle, tracked);
    }

    const mediaFilter = args.mediaFilter;
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
          byTitle.get(entry.normalizedTitle);

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
