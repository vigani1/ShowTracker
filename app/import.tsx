import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppBackButton } from "@/components/AppBackButton";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { getAniListMediaById, getAniListMediaByMalId, searchAniList } from "@/lib/api/anilist";
import { getJikanAnime, searchJikan } from "@/lib/api/jikan";
import { normalizeTmdbShowDetails } from "@/lib/api/normalize";
import {
  findTmdbByImdbId,
  findTmdbByTvdbId,
  getTmdbShowDetails,
  searchTmdb,
} from "@/lib/api/tmdb";
import { lookupTvMazeShowByTvdb, type TvMazeShow } from "@/lib/api/tvmaze";
import type { MediaType, NormalizedShow } from "@/lib/api/types";
import {
  isLikelyTvTimeExport,
  parseTvTimeImportJson,
  type ImportWatchStatus,
  type ParsedImportItem,
} from "@/lib/import/tv-time";
import {
  parseTvTimeGdprArchive,
  type TvTimeGdprParseSummary,
} from "@/lib/import/tv-time-gdpr";
import { enrichImportedEpisodeRuntimes } from "@/lib/import/provider-runtime";

const RESOLVE_CONCURRENCY = 4;
const IMPORT_CHUNK_SIZE = 20;
const LARGE_JSON_THRESHOLD_BYTES = 1024 * 1024;
const WEB_IMPORT_FILE_INPUT_ID = "import-file-input";
const DEFAULT_FALLBACK_RUNTIME: Record<MediaType, number> = {
  tv: 24,
  anime: 24,
  movie: 110,
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

type ShowPayload = {
  tmdbId?: number;
  tvdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  imdbId?: string;
  mediaType: MediaType;
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

type ImportPayloadItem = {
  show: ShowPayload;
  status: ImportWatchStatus;
  watchedEpisodes: ParsedImportItem["watchedEpisodes"];
  favorite?: boolean;
  followedAt?: number;
};

type ResolveResult = {
  parsed: ParsedImportItem;
  show: NormalizedShow | null;
  error?: string;
};

type ImportProgress = {
  phase: "resolving" | "importing";
  current: number;
  total: number;
};

type ImportResult = {
  importedShows: number;
  insertedEpisodes: number;
  updatedEpisodes: number;
  skippedEpisodes: number;
  favoritesAdded: number;
  canonicalEpisodes: number;
  unmatchedEpisodes: number;
  unresolvedTitles: string[];
  failedTitles: string[];
  fallbackImportedTitles: string[];
};

type ScoredResolvedShow = {
  show: NormalizedShow;
  score: number;
  source: "tmdb" | "anilist" | "jikan" | "tvmaze" | "fallback";
  isAnimation?: boolean;
};

const STATUS_PRIORITY: Record<ImportWatchStatus, number> = {
  plan_to_watch: 1,
  watching: 2,
  paused: 3,
  dropped: 4,
  completed: 5,
};

function toShowPayload(show: NormalizedShow): ShowPayload {
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
  };
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function extractYear(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const match = value.match(/(19|20)\d{2}/);
  if (!match) {
    return undefined;
  }
  const year = Number.parseInt(match[0], 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return undefined;
  }
  return year;
}

function getWordOverlapScore(a: string, b: string) {
  const wordsA = a.split(" ").filter(Boolean);
  const wordsB = b.split(" ").filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) {
    return 0;
  }
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(setA.size, setB.size);
}

function scoreTitleMatch(importTitle: string, candidateTitle: string) {
  const importNormalized = normalizeSearchText(importTitle);
  const candidateNormalized = normalizeSearchText(candidateTitle);
  if (!importNormalized || !candidateNormalized) {
    return 0;
  }
  if (importNormalized === candidateNormalized) {
    return 1;
  }
  if (
    importNormalized.includes(candidateNormalized) ||
    candidateNormalized.includes(importNormalized)
  ) {
    return 0.88;
  }
  return getWordOverlapScore(importNormalized, candidateNormalized);
}

function scoreYearMatch(importYear?: number, candidateYear?: number) {
  if (!importYear || !candidateYear) {
    return 0.5;
  }
  const diff = Math.abs(importYear - candidateYear);
  if (diff === 0) {
    return 1;
  }
  if (diff === 1) {
    return 0.8;
  }
  if (diff === 2) {
    return 0.6;
  }
  return 0.2;
}

function scoreCandidateMatch(args: {
  importTitle: string;
  candidateTitle: string;
  importYear?: number;
  candidateYear?: number;
}) {
  const titleScore = scoreTitleMatch(args.importTitle, args.candidateTitle);
  const yearScore = scoreYearMatch(args.importYear, args.candidateYear);
  return titleScore * 0.8 + yearScore * 0.2;
}

function chunkArray<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function getEpisodeHistoryForMerge(episode: ParsedImportItem["watchedEpisodes"][number]) {
  if (Array.isArray(episode.watchHistory) && episode.watchHistory.length > 0) {
    return episode.watchHistory.filter(
      (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
    );
  }

  if (typeof episode.watchedAt === "number" && Number.isFinite(episode.watchedAt)) {
    return [episode.watchedAt];
  }

  return [];
}

function getEpisodeWatchCountForMerge(
  episode: ParsedImportItem["watchedEpisodes"][number],
  history: number[]
) {
  const explicitCount =
    typeof episode.watchCount === "number" && Number.isFinite(episode.watchCount)
      ? Math.floor(episode.watchCount)
      : undefined;

  if (typeof explicitCount === "number" && explicitCount > 0) {
    return explicitCount;
  }

  if (history.length > 0) {
    return history.length;
  }

  return 1;
}

function mergeWatchedEpisodeEntries(
  existing: ParsedImportItem["watchedEpisodes"][number],
  incoming: ParsedImportItem["watchedEpisodes"][number]
): ParsedImportItem["watchedEpisodes"][number] {
  const existingHistory = getEpisodeHistoryForMerge(existing);
  const incomingHistory = getEpisodeHistoryForMerge(incoming);
  const mergedHistory = [...existingHistory, ...incomingHistory];

  const existingCount = getEpisodeWatchCountForMerge(existing, existingHistory);
  const incomingCount = getEpisodeWatchCountForMerge(incoming, incomingHistory);
  const watchCount = existingCount + incomingCount;

  const latestWatchedAt =
    mergedHistory.length > 0
      ? mergedHistory.reduce((max, value) => (value > max ? value : max), mergedHistory[0])
      : undefined;
  const watchedAtCandidates = [existing.watchedAt, incoming.watchedAt, latestWatchedAt].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  const watchedAt =
    watchedAtCandidates.length > 0
      ? watchedAtCandidates.reduce((max, value) => (value > max ? value : max), watchedAtCandidates[0])
      : undefined;

  return {
    ...existing,
    ...incoming,
    season: existing.season,
    episode: existing.episode,
    watchedAt,
    watchCount: watchCount > 1 ? watchCount : undefined,
    watchHistory: mergedHistory.length > 1 ? mergedHistory : undefined,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function buildImportAliasKeys(payload: ImportPayloadItem) {
  const show = payload.show;
  const keys: string[] = [];

  if (typeof show.tmdbId === "number") {
    keys.push(`tmdb:${show.mediaType}:${show.tmdbId}`);
  }
  if (typeof show.tvdbId === "number") {
    keys.push(`tvdb:${show.mediaType}:${show.tvdbId}`);
  }
  if (typeof show.imdbId === "string" && show.imdbId.trim()) {
    keys.push(`imdb:${show.imdbId.trim().toLowerCase()}`);
  }
  if (typeof show.anilistId === "number") {
    keys.push(`anilist:${show.anilistId}`);
  }
  if (typeof show.malId === "number") {
    keys.push(`mal:${show.malId}`);
  }
  if (typeof show.tvmazeId === "number") {
    keys.push(`tvmaze:${show.tvmazeId}`);
  }

  const normalizedTitle = normalizeSearchText(show.title);
  if (normalizedTitle) {
    keys.push(
      `title:${show.mediaType}:${normalizedTitle}:${extractYear(show.firstAired) ?? "na"}`
    );
  }

  return keys;
}

function mergeImportPayloads(items: ImportPayloadItem[]) {
  const merged = new Map<string, ImportPayloadItem>();
  const aliasToCanonicalKey = new Map<string, string>();

  for (const item of items) {
    const aliasKeys = buildImportAliasKeys(item);
    if (aliasKeys.length === 0) {
      continue;
    }

    const canonicalKey =
      aliasKeys.map((key) => aliasToCanonicalKey.get(key)).find((key): key is string => !!key) ??
      aliasKeys[0];

    const existing = merged.get(canonicalKey);
    if (!existing) {
      merged.set(canonicalKey, item);
      for (const aliasKey of aliasKeys) {
        aliasToCanonicalKey.set(aliasKey, canonicalKey);
      }
      continue;
    }

    const episodes = new Map<string, ParsedImportItem["watchedEpisodes"][number]>();
    for (const episode of existing.watchedEpisodes) {
      episodes.set(`${episode.season}:${episode.episode}`, episode);
    }
    for (const episode of item.watchedEpisodes) {
      const episodeKey = `${episode.season}:${episode.episode}`;
      const current = episodes.get(episodeKey);
      if (!current) {
        episodes.set(episodeKey, episode);
        continue;
      }
      episodes.set(episodeKey, mergeWatchedEpisodeEntries(current, episode));
    }

    const definedShowFields = Object.fromEntries(
      Object.entries(item.show).filter(([, value]) => value !== undefined)
    ) as Partial<ImportPayloadItem["show"]>;

    merged.set(canonicalKey, {
      show: {
        ...existing.show,
        ...definedShowFields,
        title:
          existing.show.title.length >= item.show.title.length
            ? existing.show.title
            : item.show.title,
      },
      status:
        STATUS_PRIORITY[item.status] >= STATUS_PRIORITY[existing.status]
          ? item.status
          : existing.status,
      favorite: existing.favorite || item.favorite,
      followedAt:
        typeof existing.followedAt === "number" && typeof item.followedAt === "number"
          ? Math.min(existing.followedAt, item.followedAt)
          : existing.followedAt ?? item.followedAt,
      watchedEpisodes: Array.from(episodes.values()),
    });

    const mergedItem = merged.get(canonicalKey);
    if (!mergedItem) {
      continue;
    }

    const mergedAliasKeys = buildImportAliasKeys(mergedItem);
    for (const aliasKey of [...aliasKeys, ...mergedAliasKeys]) {
      aliasToCanonicalKey.set(aliasKey, canonicalKey);
    }
  }

  return Array.from(merged.values());
}

function splitImportPayloadItem(item: ImportPayloadItem, maxEpisodesPerChunk = 250) {
  if (item.watchedEpisodes.length <= maxEpisodesPerChunk) {
    return [item];
  }

  const chunks: ImportPayloadItem[] = [];
  for (
    let startIndex = 0;
    startIndex < item.watchedEpisodes.length;
    startIndex += maxEpisodesPerChunk
  ) {
    chunks.push({
      ...item,
      watchedEpisodes: item.watchedEpisodes.slice(startIndex, startIndex + maxEpisodesPerChunk),
    });
  }
  return chunks;
}

async function resolveTmdbById(mediaType: "tv" | "movie", tmdbId: number) {
  const details = await getTmdbShowDetails(mediaType, tmdbId);
  return normalizeTmdbShowDetails(mediaType, details);
}

async function resolveTmdbByImdbId(item: ParsedImportItem) {
  if (!item.imdbId || (item.mediaType !== "tv" && item.mediaType !== "movie")) {
    return null;
  }

  const lookup = await findTmdbByImdbId(item.imdbId).catch(() => null);
  if (!lookup) {
    return null;
  }

  const targetType = item.mediaType === "movie" ? "movie" : "tv";
  const preferred = lookup.items.find(
    (entry) => entry.mediaType === targetType && typeof entry.tmdbId === "number"
  );
  if (preferred && typeof preferred.tmdbId === "number") {
    return resolveTmdbById(targetType, preferred.tmdbId).catch(() => null);
  }

  return null;
}

function normalizeTvMazeShowForImport(show: TvMazeShow, mediaType: MediaType): NormalizedShow {
  const normalizedMediaType: MediaType =
    mediaType === "movie" ? "movie" : mediaType === "anime" ? "anime" : "tv";

  return {
    id: `tvmaze:${show.id}`,
    mediaType: normalizedMediaType,
    title: show.name,
    overview: show.summary ?? undefined,
    posterUrl: show.image?.original ?? show.image?.medium ?? undefined,
    genres: show.genres,
    status: show.status ?? undefined,
    firstAired: show.premiered ?? undefined,
    episodeRuntime:
      typeof show.runtime === "number" && show.runtime > 0
        ? show.runtime
        : DEFAULT_FALLBACK_RUNTIME[normalizedMediaType],
    tvmazeId: show.id,
    tvdbId:
      typeof show.externals?.thetvdb === "number" && show.externals.thetvdb > 0
        ? show.externals.thetvdb
        : undefined,
    imdbId: show.externals?.imdb ?? undefined,
    totalSeasons: normalizedMediaType === "movie" ? 0 : 1,
    totalEpisodes: normalizedMediaType === "movie" ? 1 : undefined,
  };
}

async function resolveTmdbByTvdbId(item: ParsedImportItem): Promise<ScoredResolvedShow | null> {
  if (typeof item.tvdbId !== "number") {
    return null;
  }

  const lookup = await findTmdbByTvdbId(item.tvdbId).catch(() => null);
  if (!lookup) {
    return null;
  }

  const targetType = item.mediaType === "movie" ? "movie" : "tv";
  const preferred = lookup.items.find(
    (entry) => entry.mediaType === targetType && typeof entry.tmdbId === "number"
  );

  if (!preferred || typeof preferred.tmdbId !== "number") {
    return null;
  }

  const resolved = await resolveTmdbById(targetType, preferred.tmdbId).catch(() => null);
  if (!resolved) {
    return null;
  }

  const candidateScore = scoreCandidateMatch({
    importTitle: item.title,
    candidateTitle: preferred.title,
    importYear: item.firstAiredYear,
    candidateYear: extractYear(preferred.firstAired),
  });
  return {
    show: resolved,
    score: Math.max(0.7, candidateScore),
    source: "tmdb",
    isAnimation: (preferred.genres ?? []).some(
      (genre) => genre.toLowerCase() === "animation"
    ),
  };
}

async function resolveViaTvMazeByTvdbId(
  item: ParsedImportItem
): Promise<ScoredResolvedShow | null> {
  if (typeof item.tvdbId !== "number") {
    return null;
  }

  const tvMazeShow = await lookupTvMazeShowByTvdb(item.tvdbId).catch(() => null);
  if (!tvMazeShow) {
    return null;
  }

  const imdbFromTvMaze = tvMazeShow.externals?.imdb?.trim();
  if (imdbFromTvMaze && imdbFromTvMaze !== "-1") {
    const tmdbFromImdb = await resolveTmdbByImdbId({
      ...item,
      imdbId: imdbFromTvMaze,
    });
    if (tmdbFromImdb) {
      return {
        show: tmdbFromImdb,
        score: 0.78,
        source: "tmdb",
      };
    }
  }

  return {
    show: normalizeTvMazeShowForImport(tvMazeShow, item.mediaType),
    score: 0.72,
    source: "tvmaze",
  };
}

function buildFallbackShowFromParsedItem(item: ParsedImportItem): NormalizedShow {
  const fallbackRuntime = DEFAULT_FALLBACK_RUNTIME[item.mediaType];
  const uniqueWatchedEpisodeCount = new Set(
    item.watchedEpisodes.map((entry) => `${entry.season}:${entry.episode}`)
  ).size;
  const maxEpisodeNumber = item.watchedEpisodes.reduce(
    (max, entry) => Math.max(max, entry.episode),
    0
  );
  const inferredEpisodes =
    item.mediaType === "movie"
      ? 1
      : Math.max(uniqueWatchedEpisodeCount, maxEpisodeNumber) ||
        undefined;

  return {
    id: `fallback:${item.mediaType}:${normalizeSearchText(item.title)}:${item.firstAiredYear ?? "na"}`,
    mediaType: item.mediaType,
    title: item.title,
    firstAired:
      typeof item.firstAiredYear === "number" ? `${item.firstAiredYear}-01-01` : undefined,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
    anilistId: item.anilistId,
    malId: item.malId,
    tvmazeId: item.tvmazeId,
    imdbId: item.imdbId,
    status: undefined,
    episodeRuntime: fallbackRuntime,
    totalEpisodes: inferredEpisodes,
    totalSeasons: item.mediaType === "movie" ? 0 : 1,
  };
}

async function resolveTmdbBySearch(item: ParsedImportItem): Promise<ScoredResolvedShow | null> {
  const tmdbType = item.mediaType === "movie" ? "movie" : "tv";
  const results = await searchTmdb(item.title, tmdbType, 1).catch(() => null);
  if (!results?.items?.length) {
    return null;
  }

  const ranked = results.items
    .map((entry) => ({
      entry,
      score: scoreCandidateMatch({
        importTitle: item.title,
        candidateTitle: entry.title,
        importYear: item.firstAiredYear,
        candidateYear: extractYear(entry.firstAired),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score < 0.52) {
    return null;
  }

  if (typeof ranked[0].entry.tmdbId !== "number") {
    return null;
  }

  const resolved = await resolveTmdbById(tmdbType, ranked[0].entry.tmdbId).catch(() => null);
  if (!resolved) {
    return null;
  }

  const isAnimation = (ranked[0].entry.genres ?? []).some(
    (genre) => genre.toLowerCase() === "animation"
  );
  return {
    show: resolved,
    score: ranked[0].score,
    source: "tmdb",
    isAnimation,
  };
}

async function resolveAnimeBySearch(item: ParsedImportItem): Promise<ScoredResolvedShow | null> {
  const aniList = await searchAniList(item.title, 1, 8).catch(() => null);
  const aniListCandidates = aniList?.items ?? [];

  const aniListRanked = aniListCandidates
    .map((candidate) => {
      return {
        candidate,
        score: scoreCandidateMatch({
          importTitle: item.title,
          candidateTitle: candidate.title,
          importYear: item.firstAiredYear,
          candidateYear: extractYear(candidate.firstAired),
        }),
      };
    })
    .sort((a, b) => b.score - a.score);

  if (aniListRanked[0] && aniListRanked[0].score >= 0.54) {
    const anilistId = aniListRanked[0].candidate.anilistId;
    const anime =
      typeof anilistId === "number"
        ? await getAniListMediaById(anilistId).catch(() => null)
        : aniListRanked[0].candidate;
    if (anime) {
      return {
        show: anime,
        score: aniListRanked[0].score,
        source: "anilist",
      };
    }
  }

  const jikanResults = await searchJikan(item.title, 1).catch(() => []);
  const rankedJikan = jikanResults
    .map((candidate) => ({
      candidate,
      score: scoreCandidateMatch({
        importTitle: item.title,
        candidateTitle: candidate.title,
        importYear: item.firstAiredYear,
        candidateYear: extractYear(candidate.firstAired),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  if (!rankedJikan[0] || rankedJikan[0].score < 0.54) {
    return null;
  }

  return {
    show: rankedJikan[0].candidate,
    score: rankedJikan[0].score,
    source: "jikan",
  };
}

async function resolveTvWithAnimeFallback(item: ParsedImportItem) {
  const tmdbByTvdb = await resolveTmdbByTvdbId(item);
  if (tmdbByTvdb) {
    return tmdbByTvdb.show;
  }

  const tmdbBySearch = await resolveTmdbBySearch(item);
  if (tmdbBySearch) {
    return tmdbBySearch.show;
  }

  const tvMazeByTvdb = await resolveViaTvMazeByTvdbId(item);
  if (tvMazeByTvdb) {
    return tvMazeByTvdb.show;
  }

  const animeCandidate = await resolveAnimeBySearch(item);
  return animeCandidate?.show ?? null;
}

async function resolveImportedItem(item: ParsedImportItem): Promise<NormalizedShow | null> {
  if (
    typeof item.tmdbId === "number" &&
    (item.mediaType === "tv" || item.mediaType === "movie")
  ) {
    const byTmdbId = await resolveTmdbById(item.mediaType, item.tmdbId).catch(() => null);
    if (byTmdbId) {
      return byTmdbId;
    }
  }

  const byTvdbId = await resolveTmdbByTvdbId(item);
  if (byTvdbId) {
    return byTvdbId.show;
  }

  const byImdbId = await resolveTmdbByImdbId(item);
  if (byImdbId) {
    return byImdbId;
  }

  if (item.mediaType === "anime") {
    if (typeof item.anilistId === "number") {
      const anime = await getAniListMediaById(item.anilistId).catch(() => null);
      if (anime) {
        return anime;
      }
    }

    if (typeof item.malId === "number") {
      const animeByMal = await getAniListMediaByMalId(item.malId).catch(() => null);
      if (animeByMal) {
        return animeByMal;
      }

      const animeFromJikan = await getJikanAnime(item.malId).catch(() => null);
      if (animeFromJikan) {
        return animeFromJikan;
      }
    }

    const animeBySearch = await resolveAnimeBySearch(item);
    return animeBySearch?.show ?? null;
  }

  if (item.mediaType === "tv") {
    return resolveTvWithAnimeFallback(item);
  }

  if (item.mediaType === "movie") {
    return resolveTmdbBySearch(item).then((result) => result?.show ?? null);
  }

  const movieByTmdb = await resolveTmdbBySearch(item);
  return movieByTmdb?.show ?? null;
}

export function ImportScreen() {
  const importTrackedShows = useMutation(api.shows.importTrackedShows);
  const rebuildUserStats = useMutation(api.stats.rebuildUserStats);
  const resetUserTrackingData = useAction(api.shows.resetUserTrackingData);
  const loadedFileContentRef = useRef<string | null>(null);

  const [rawJson, setRawJson] = useState("");
  const [loadedFileMeta, setLoadedFileMeta] = useState<{
    name: string;
    sizeBytes: number;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetConfirmArmed, setIsResetConfirmArmed] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedImportItem[]>([]);
  const [gdprSummary, setGdprSummary] = useState<TvTimeGdprParseSummary | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const summary = useMemo(() => {
    const episodes = parsedItems.reduce((acc, item) => acc + item.watchedEpisodes.length, 0);
    return {
      total: parsedItems.length,
      tv: parsedItems.filter((item) => item.mediaType === "tv").length,
      anime: parsedItems.filter((item) => item.mediaType === "anime").length,
      movie: parsedItems.filter((item) => item.mediaType === "movie").length,
      episodes,
    };
  }, [parsedItems]);

  const progressLabel = useMemo(() => {
    if (!progress) {
      return null;
    }
    if (progress.phase === "resolving") {
      return `Resolving titles ${progress.current}/${progress.total}`;
    }
    return `Importing batches ${progress.current}/${progress.total}`;
  }, [progress]);

  const handleRawJsonChange = (value: string) => {
    setRawJson(value);
    setGdprSummary(null);

    if (loadedFileMeta) {
      loadedFileContentRef.current = null;
      setLoadedFileMeta(null);
    }
  };

  const parseGdprZip = async (bytes: ArrayBuffer, name: string, sizeBytes: number) => {
    setIsParsing(true);
    setParseError(null);
    setWarning(null);
    setImportResult(null);
    setProgress(null);
    try {
      const result = await parseTvTimeGdprArchive(bytes);
      setParsedItems(result.items);
      setGdprSummary(result.summary);
      setRawJson("");
      loadedFileContentRef.current = null;
      setLoadedFileMeta({ name, sizeBytes });
      const ignoredNotice =
        result.summary.ignoredFileCount > 0
          ? ` ${result.summary.ignoredFileCount} unrelated or sensitive files were ignored.`
          : "";
      const archiveWarning = result.summary.warnings[0];
      setWarning(
        archiveWarning
          ? `${ignoredNotice.trim()} ${archiveWarning}`.trim()
          : ignoredNotice.trim() || null
      );
    } catch (error) {
      console.error("TV Time GDPR archive parse failed", error);
      setParsedItems([]);
      setGdprSummary(null);
      setGdprSummary(null);
      setParseError(
        error instanceof Error ? error.message : "Could not read this TV Time archive."
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleSelectedWebFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip") {
      await parseGdprZip(await file.arrayBuffer(), file.name, file.size);
      return;
    }
    const text = await file.text();
    loadedFileContentRef.current = text;
    setLoadedFileMeta({ name: file.name, sizeBytes: file.size });

    if (file.size > LARGE_JSON_THRESHOLD_BYTES) {
      setRawJson("");
      setWarning(
        `Loaded ${file.name} (${formatBytes(file.size)}). Kept out of textbox to avoid UI lag. Press Parse to process it.`
      );
    } else {
      setRawJson(text);
      setWarning(null);
    }

    setImportResult(null);
    setParseError(null);
    setGdprSummary(null);
  };

  const ensureWebFileInput = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return null;
    }

    const existing = document.getElementById(WEB_IMPORT_FILE_INPUT_ID);
    if (existing instanceof HTMLInputElement) {
      return existing;
    }

    const input = document.createElement("input");
    input.id = WEB_IMPORT_FILE_INPUT_ID;
    input.type = "file";
    input.accept = ".zip,.json,application/zip,application/json,text/plain";
    input.style.display = "none";
    input.setAttribute("data-testid", "import-file-input");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void handleSelectedWebFile(file);
      input.value = "";
    };
    document.body.appendChild(input);
    return input;
  };

  const handleLoadFromFile = async () => {
    if (Platform.OS !== "web") {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/json", "text/plain"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if (asset.name.toLowerCase().endsWith(".zip") || asset.mimeType === "application/zip") {
        const file = new ExpoFile(asset.uri);
        await parseGdprZip(await file.arrayBuffer(), asset.name, asset.size ?? file.size);
      } else {
        const text = await new ExpoFile(asset.uri).text();
        loadedFileContentRef.current = text;
        setRawJson(text);
        setLoadedFileMeta({ name: asset.name, sizeBytes: asset.size ?? text.length });
        setGdprSummary(null);
      }
      return;
    }

    if (typeof document === "undefined") return;

    const input = ensureWebFileInput();
    input?.click();
  };

  const handleParse = () => {
    const source = loadedFileContentRef.current ?? rawJson;
    if (!source.trim()) {
      setParseError("Paste TV Time JSON export first.");
      return;
    }

    setIsParsing(true);
    setParseError(null);
    setWarning(null);
    setImportResult(null);
    setProgress(null);

    const sourceForParse = source;
    setTimeout(() => {
      try {
        const { items, summary: parseSummary } = parseTvTimeImportJson(sourceForParse);
        if (items.length === 0) {
          setParseError("No trackable shows found in this JSON.");
          setParsedItems([]);
          return;
        }

        setParsedItems(items.map((item) => ({ ...item, source: "legacy_json" })));
        setGdprSummary(null);

        if (!isLikelyTvTimeExport(sourceForParse)) {
          setWarning(
            "This file does not look like a standard TV Time export, but valid items were parsed."
          );
        }

        if (!parseSummary.withEpisodeHistory) {
          setWarning(
            "No episode history was detected. Show status import still works, episode counts may be limited."
          );
        }
      } catch (error) {
        console.error("Import parse failed", error);
        setParsedItems([]);
        setParseError("Could not parse JSON. Confirm the export is valid JSON and try again.");
      } finally {
        setIsParsing(false);
      }
    }, 0);
  };

  const handleImport = async () => {
    if (parsedItems.length === 0) {
      setParseError("Nothing to import yet. Parse your JSON first.");
      return;
    }

    setIsImporting(true);
    setParseError(null);
    setImportResult(null);

    try {
      setProgress({
        phase: "resolving",
        current: 0,
        total: parsedItems.length,
      });

      const resolvedResults = await mapWithConcurrency(
        parsedItems,
        RESOLVE_CONCURRENCY,
        async (item): Promise<ResolveResult> => {
          try {
            const show = await resolveImportedItem(item);
            const parsed = show
              ? {
                  ...item,
                  watchedEpisodes: await enrichImportedEpisodeRuntimes(
                  item.watchedEpisodes,
                    show,
                    {
                      sourceTvdbId: item.tvdbId,
                      canonicalize: item.source === "tv_time_gdpr",
                    }
                  ),
                }
              : item;
            return { parsed, show };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Resolve failed";
            return {
              parsed: item,
              show: null,
              error: errorMessage,
            };
          } finally {
            setProgress((current) => {
              if (!current || current.phase !== "resolving") {
                return current;
              }
              return {
                ...current,
                current: Math.min(current.total, current.current + 1),
              };
            });
          }
        }
      );

      const unresolvedTitles = resolvedResults
        .filter((entry) => !entry.show)
        .map((entry) => entry.parsed.title);

      const fallbackImportedTitles = resolvedResults
        .filter((entry) => !entry.show && entry.parsed.source !== "tv_time_gdpr")
        .map((entry) => entry.parsed.title);

      const failedTitles = resolvedResults
        .filter((entry) => !!entry.error)
        .map((entry) => entry.parsed.title);

      const resolvedImportCandidates: ImportPayloadItem[] = resolvedResults
        .filter((entry): entry is ResolveResult & { show: NormalizedShow } => !!entry.show)
        .map((entry) => {
          const basePayload = toShowPayload(entry.show);
          return {
            show: {
              ...basePayload,
              tvdbId: entry.parsed.tvdbId ?? basePayload.tvdbId,
            },
            status: entry.parsed.status,
            watchedEpisodes: entry.parsed.watchedEpisodes,
            favorite: entry.parsed.favorite,
            followedAt: entry.parsed.followedAt,
          };
        });

      const fallbackImportCandidates: ImportPayloadItem[] = resolvedResults
        .filter((entry) => !entry.show && entry.parsed.source !== "tv_time_gdpr")
        .map((entry) => ({
          show: toShowPayload(buildFallbackShowFromParsedItem(entry.parsed)),
          status: entry.parsed.status,
          watchedEpisodes: entry.parsed.watchedEpisodes,
          favorite: entry.parsed.favorite,
          followedAt: entry.parsed.followedAt,
        }));

      const importCandidates: ImportPayloadItem[] = [
        ...resolvedImportCandidates,
        ...fallbackImportCandidates,
      ];

      const mergedImportItems = mergeImportPayloads(importCandidates);
      if (mergedImportItems.length === 0) {
        setParseError("Could not resolve any titles against metadata sources.");
        setProgress(null);
        return;
      }

      const splitImportItems = mergedImportItems.flatMap((item) =>
        splitImportPayloadItem(item)
      );
      const batches = chunkArray(splitImportItems, IMPORT_CHUNK_SIZE);
      setProgress({ phase: "importing", current: 0, total: batches.length });

      let insertedEpisodes = 0;
      let updatedEpisodes = 0;
      let skippedEpisodes = 0;
      let favoritesAdded = 0;
      let canonicalEpisodes = 0;
      let unmatchedEpisodes = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const result = await importTrackedShows({ items: batch });

        insertedEpisodes += result.insertedEpisodes;
        updatedEpisodes += result.updatedEpisodes;
        skippedEpisodes += result.skippedEpisodes;
        favoritesAdded += result.favoritesAdded;
        canonicalEpisodes += result.canonicalEpisodes;
        unmatchedEpisodes += result.unmatchedEpisodes;

        setProgress({
          phase: "importing",
          current: batchIndex + 1,
          total: batches.length,
        });
      }

      await rebuildUserStats();

      setImportResult({
        importedShows: mergedImportItems.length,
        insertedEpisodes,
        updatedEpisodes,
        skippedEpisodes,
        favoritesAdded,
        canonicalEpisodes,
        unmatchedEpisodes,
        unresolvedTitles,
        failedTitles,
        fallbackImportedTitles,
      });
    } catch (error) {
      console.error("Import failed", error);
      const message = error instanceof Error ? error.message : "Import failed.";
      setParseError(message);
    } finally {
      setIsImporting(false);
      setProgress(null);
    }
  };

  const handleResetTrackingData = async () => {
    if (isResetting) {
      return;
    }

    if (!isResetConfirmArmed) {
      setIsResetConfirmArmed(true);
      setWarning("Press reset again to confirm clearing your tracked data.");
      return;
    }

    setIsResetting(true);
    setParseError(null);
    setImportResult(null);

    try {
      const resetResult = await resetUserTrackingData({});
      setParsedItems([]);
      setRawJson("");
      loadedFileContentRef.current = null;
      setLoadedFileMeta(null);
      if (resetResult.completed) {
        setWarning("Tracking data reset complete. You can now run a clean import.");
      } else {
        setWarning(
          "Reset reached safety limit before finishing. Press reset again to continue clearing data."
        );
      }
    } catch (error) {
      console.error("Failed to reset tracking data", error);
      setParseError("Could not reset tracking data. Please try again.");
    } finally {
      setIsResetting(false);
      setIsResetConfirmArmed(false);
    }
  };

  return (
    <ScreenWrapper>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <PageIntro
          title="Import"
          subtitle="Bring your TV Time history into ShowTracker"
          eyebrow="Migration"
          icon="download-outline"
          className="mb-4"
          leftSlot={<AppBackButton fallbackHref="/profile" />}
        />

        <View className="overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4">
          <Text className="text-sm font-semibold text-text-primary">Quick Steps</Text>
          <View className="mt-2 gap-1">
            <Text className="text-xs text-text-secondary">
              1. Request and download your official TV Time GDPR archive.
            </Text>
            <Text className="text-xs text-text-secondary">
              2. Select the ZIP here without extracting or editing it.
            </Text>
            <Text className="text-xs text-text-secondary">
              3. Review the preview, then resolve and import it.
            </Text>
          </View>
        </View>

        <View className="mt-4 overflow-hidden rounded-xl border border-warning/30 bg-warning/10 p-4">
          <Text className="text-sm font-semibold text-warning">Re-import from scratch</Text>
          <Text className="mt-1 text-xs text-text-secondary">
            This clears your tracked shows, watched episodes, favorites, and custom lists for this
            account.
          </Text>
          <Pressable
            onPress={() => {
              void handleResetTrackingData();
            }}
            disabled={isParsing || isImporting || isResetting}
            className={`mt-3 flex-row items-center justify-center gap-2 rounded-lg border border-warning/50 bg-warning/20 py-2.5 ${
              isParsing || isImporting || isResetting ? "opacity-60" : "opacity-100"
            }`}
          >
            {isResetting ? (
              <ActivityIndicator size="small" color="#f59e0b" />
            ) : (
              <Ionicons name="trash-outline" size={14} color="#f59e0b" />
            )}
            <Text className="text-xs font-semibold uppercase tracking-wider text-warning">
              {isResetConfirmArmed ? "Confirm reset" : "Reset tracked data"}
            </Text>
          </Pressable>
        </View>

        <View className="mt-4 overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4">
          <Text className="text-sm font-semibold text-text-primary">TV Time archive</Text>
          <Text className="mt-1 text-xs text-text-secondary">
            ZIP parsing happens on this device. Login tokens, sessions, IP history, and all other
            unrelated files are ignored.
          </Text>

          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={handleLoadFromFile}
              disabled={isParsing || isImporting}
              accessibilityRole="button"
              testID="import-load-file-button"
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-border-default bg-bg-elevated py-2.5 ${
                isParsing || isImporting ? "opacity-60" : "opacity-100"
              }`}
            >
              <Ionicons name="document-outline" size={14} color="#a1a1aa" />
              <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Select ZIP
              </Text>
            </Pressable>
            <Pressable
              onPress={handleParse}
              disabled={isParsing || isImporting}
              accessibilityRole="button"
              testID="import-parse-button"
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-2.5 ${
                isParsing || isImporting ? "opacity-60" : "opacity-100"
              }`}
            >
              {isParsing ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Ionicons name="sparkles-outline" size={14} color="#ef4444" />
              )}
              <Text className="text-xs font-semibold uppercase tracking-wider text-primary">
                Parse
              </Text>
            </Pressable>
          </View>

          {loadedFileMeta ? (
            <View className="mt-3 rounded-lg border border-border-default bg-bg-base px-3 py-2">
              <Text className="text-xs text-text-secondary">
                Loaded file: {loadedFileMeta.name} ({formatBytes(loadedFileMeta.sizeBytes)})
              </Text>
              <Pressable
                onPress={() => {
                  loadedFileContentRef.current = null;
                  setLoadedFileMeta(null);
                  setGdprSummary(null);
                  setParsedItems([]);
                  setWarning(null);
                }}
                className="mt-2 self-start rounded-md border border-border-default bg-bg-elevated px-2.5 py-1"
              >
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Clear Loaded File
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!gdprSummary ? <TextInput
            multiline
            value={rawJson}
            onChangeText={handleRawJsonChange}
            testID="import-json-input"
            placeholder='Legacy option: paste a TV Time JSON export'
            placeholderTextColor="#52525b"
            className="mt-3 min-h-[220px] rounded-lg border border-border-default bg-bg-base px-3 py-3 text-sm text-text-primary"
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          /> : null}

          {progressLabel ? (
            <View className="mt-3 flex-row items-center gap-2 rounded-lg border border-border-default bg-bg-base px-3 py-2">
              <ActivityIndicator size="small" color="#ef4444" />
              <Text className="text-xs text-text-secondary">{progressLabel}</Text>
            </View>
          ) : null}

          {parseError ? <Text className="mt-3 text-sm text-primary">{parseError}</Text> : null}
          {warning ? <Text className="mt-3 text-sm text-warning">{warning}</Text> : null}
        </View>

        {summary.total > 0 ? (
          <View className="mt-4 overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-text-primary">Preview</Text>
              <Text className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {summary.total} items
              </Text>
            </View>

            <View className="mt-3 flex-row flex-wrap gap-2">
              <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                <Text className="text-xs text-text-secondary">TV {summary.tv}</Text>
              </View>
              <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                <Text className="text-xs text-text-secondary">Anime {summary.anime}</Text>
              </View>
              <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                <Text className="text-xs text-text-secondary">Movies {summary.movie}</Text>
              </View>
              <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                <Text className="text-xs text-text-secondary">Episodes {summary.episodes}</Text>
              </View>
              {gdprSummary ? (
                <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                  <Text className="text-xs text-text-secondary">
                    Rewatches {gdprSummary.rewatches}
                  </Text>
                </View>
              ) : null}
              {gdprSummary ? (
                <View className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                  <Text className="text-xs text-text-secondary">
                    Favorites {gdprSummary.favorites}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text className="mt-2 text-[11px] text-text-muted">
              TV Time show entries use the regular TV catalog first. Anime providers are consulted
              only when TMDB and TVMaze cannot resolve the title.
            </Text>

            <View className="mt-3 gap-2">
              {parsedItems.slice(0, 8).map((item, index) => (
                <View
                  key={`${item.title}-${index}`}
                  className="rounded-lg border border-border-default bg-bg-base px-3 py-2"
                >
                  <Text className="text-sm font-semibold text-text-primary" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-secondary">
                    {item.mediaType.toUpperCase()} - {item.status.replace(/_/g, " ")} - {item.watchedEpisodes.length} episodes
                  </Text>
                </View>
              ))}
              {parsedItems.length > 8 ? (
                <Text className="text-xs text-text-muted">+{parsedItems.length - 8} more items</Text>
              ) : null}
            </View>

            <Pressable
              onPress={handleImport}
              disabled={isParsing || isImporting}
              accessibilityRole="button"
              testID="import-run-button"
              className={`mt-4 flex-row items-center justify-center gap-2 rounded-lg border border-primary bg-primary py-3 ${
                isParsing || isImporting ? "opacity-60" : "opacity-100"
              }`}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              )}
              <Text className="text-sm font-black uppercase tracking-wide text-white">
                {isImporting ? "Importing..." : "Resolve + Import"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {importResult ? (
          <View className="mt-4 mb-6 overflow-hidden rounded-xl border border-success/30 bg-success/10 p-4">
            <Text className="text-sm font-semibold text-success">Import complete</Text>
            <Text className="mt-1 text-sm text-text-secondary">
              {importResult.importedShows} shows imported, {importResult.insertedEpisodes} episodes added, {" "}
              {importResult.updatedEpisodes} episodes enriched, {importResult.favoritesAdded} favorites added, and {" "}
              {importResult.skippedEpisodes} unchanged episodes skipped.
            </Text>
            <Text className="mt-2 text-xs text-text-secondary">
              Canonical provider episodes: {importResult.canonicalEpisodes}. Unmatched source
              episodes skipped: {importResult.unmatchedEpisodes}.
            </Text>
            {importResult.unresolvedTitles.length > 0 ? (
              <Text className="mt-2 text-xs text-warning">
                Metadata unresolved: {importResult.unresolvedTitles.length} (first: {importResult.unresolvedTitles.slice(0, 4).join(", ")})
              </Text>
            ) : null}
            {importResult.fallbackImportedTitles.length > 0 ? (
              <Text className="mt-2 text-xs text-text-secondary">
                Imported with fallback metadata: {importResult.fallbackImportedTitles.length}
              </Text>
            ) : null}
            {importResult.failedTitles.length > 0 ? (
              <Text className="mt-2 text-xs text-warning">
                Failed lookups: {importResult.failedTitles.length}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

export default ImportScreen;
