import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Badge } from "@/components/Badge";
import { ProgressBar } from "@/components/ProgressBar";
import { ShowHeader } from "@/components/ShowHeader";
import { SeasonAccordion } from "@/components/SeasonAccordion";
import { AddToListModal } from "@/components/AddToListModal";
import {
  getAniListAnimeRelations,
  getAniListMediaById,
  getAniListMediaByMalId,
  type AniListRelatedShow,
} from "@/lib/api/anilist";
import { getJikanAnime, getJikanAnimeEpisodes } from "@/lib/api/jikan";
import {
  normalizeTmdbSeason,
  normalizeTmdbShowDetails,
} from "@/lib/api/normalize";
import { getTmdbSeasonDetails, getTmdbShowDetails } from "@/lib/api/tmdb";
import type {
  NormalizedEpisode,
  NormalizedSeason,
  NormalizedShow,
} from "@/lib/api/types";
import type { UserTrackingStatus } from "@/lib/filters/tracking-filters";
import { createShowRouteId, parseShowRouteId } from "@/lib/show-route";
import { toHttpsImageUrl } from "@/lib/image-url";
import { Ionicons } from "@expo/vector-icons";

type SeasonLoadState = Record<number, boolean>;
type SeasonErrorState = Record<number, string | null>;
type EpisodePendingState = Record<string, boolean>;
type SeasonActionState = Record<number, boolean>;
type ShowTrackingStatus = UserTrackingStatus;

type RelatedAnimeEntry = {
  title: string;
  posterUrl: string | null;
  firstAired: string | null;
  anilistId: number | null;
  malId: number | null;
  anilistFormat: string | null;
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch" | null;
  isInWatchlist: boolean;
  isAutoTracked: boolean;
  animeSeason: string | null;
  animeSeasonYear: number | null;
  relationType: string | null;
};

type NextSeasonPrompt = {
  completedSeasonNumber: number;
  completedSeasonName: string;
  nextTitle: string;
  nextRouteId: string;
};

type WatchActionTarget =
  | { kind: "movie"; title: string; subtitle: string }
  | { kind: "episode"; title: string; subtitle: string; episode: NormalizedEpisode }
  | {
      kind: "season";
      title: string;
      subtitle: string;
      season: NormalizedSeason;
      releasedEpisodes: NormalizedEpisode[];
    }
  | {
      kind: "show";
      title: string;
      subtitle: string;
      releasedEpisodes: NormalizedEpisode[];
    };

const trackingStatusOptions: {
  value: ShowTrackingStatus;
  label: string;
  description: string;
}[] = [
  {
    value: "watching",
    label: "Watching",
    description: "Actively progressing through episodes",
  },
  {
    value: "plan_to_watch",
    label: "Planned",
    description: "Saved for later",
  },
  {
    value: "paused",
    label: "Paused",
    description: "On hold for now",
  },
  {
    value: "dropped",
    label: "Dropped",
    description: "No longer watching",
  },
  {
    value: "completed",
    label: "Completed",
    description: "Finished the entire title",
  },
];

function createSeasonPlaceholders(
  count: number,
  seasonSummaries?: {
    season_number: number;
    name?: string;
    episode_count?: number;
  }[]
) {
  if (seasonSummaries?.length) {
    const normalized = seasonSummaries
      .filter((season) => season.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .map((season) => ({
        seasonNumber: season.season_number,
        name: season.name ?? `Season ${season.season_number}`,
        episodeCount: season.episode_count,
      })) as NormalizedSeason[];

    if (normalized.length) {
      return normalized;
    }
  }

  return Array.from({ length: count }, (_, index) => ({
    seasonNumber: index + 1,
    name: `Season ${index + 1}`,
  })) as NormalizedSeason[];
}

function createAnimeSeason(
  totalEpisodes?: number,
  episodes?: NormalizedEpisode[],
  fallbackStillUrl?: string
) {
  if (episodes?.length) {
    return [
      {
        seasonNumber: 1,
        name: "Episodes",
        episodeCount: episodes.length,
        episodes: episodes.map((episode) => ({
          ...episode,
          stillUrl: episode.stillUrl ?? fallbackStillUrl,
        })),
      },
    ] as NormalizedSeason[];
  }

  const episodeCount = Math.max(1, Math.min(totalEpisodes ?? 12, 120));
  return [
    {
      seasonNumber: 1,
      name: "Episodes",
      episodeCount,
      episodes: Array.from({ length: episodeCount }, (_, index) => ({
        id: `anime-episode:${index + 1}`,
        seasonNumber: 1,
        episodeNumber: index + 1,
        name: `Episode ${index + 1}`,
        stillUrl: fallbackStillUrl,
      })),
    },
  ] as NormalizedSeason[];
}

function buildShowPayload(show: NormalizedShow) {
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
  };
}

function buildTrackingArgs(show: NormalizedShow | null) {
  if (!show) return "skip" as const;

  const lookupArgs: {
    tmdbId?: number;
    anilistId?: number;
    malId?: number;
    tvmazeId?: number;
  } = {};

  if (typeof show.tmdbId === "number") {
    lookupArgs.tmdbId = show.tmdbId;
  }
  if (typeof show.anilistId === "number") {
    lookupArgs.anilistId = show.anilistId;
  }
  if (typeof show.malId === "number") {
    lookupArgs.malId = show.malId;
  }
  if (typeof show.tvmazeId === "number") {
    lookupArgs.tvmazeId = show.tvmazeId;
  }

  if (Object.keys(lookupArgs).length === 0) {
    return "skip" as const;
  }

  return lookupArgs;
}

function buildRelatedAnimeKey(entry: {
  anilistId: number | null;
  malId: number | null;
  title: string;
}) {
  if (typeof entry.anilistId === "number") {
    return `anilist:${entry.anilistId}`;
  }
  if (typeof entry.malId === "number") {
    return `jikan:${entry.malId}`;
  }
  return `title:${entry.title.toLowerCase()}`;
}

function getRelatedAnimeRouteId(entry: RelatedAnimeEntry) {
  if (typeof entry.anilistId === "number") {
    return createShowRouteId({
      id: `anilist:${entry.anilistId}`,
      mediaType: "anime",
      title: entry.title,
      anilistId: entry.anilistId,
      malId: entry.malId ?? undefined,
      firstAired: entry.firstAired ?? undefined,
      posterUrl: entry.posterUrl ?? undefined,
    });
  }
  if (typeof entry.malId === "number") {
    return `jikan:anime:${entry.malId}`;
  }
  return null;
}

function formatRelationTypeLabel(relationType?: string | null) {
  if (!relationType) {
    return null;
  }
  return relationType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function formatAnimeSeasonLabel(season?: string | null, year?: number | null) {
  if (!season && !year) {
    return null;
  }
  const formattedSeason = season
    ? season.charAt(0).toUpperCase() + season.slice(1).toLowerCase()
    : null;
  if (formattedSeason && year) {
    return `${formattedSeason} ${year}`;
  }
  if (formattedSeason) {
    return formattedSeason;
  }
  return year ? String(year) : null;
}

const SIDE_RELATION_TYPES = new Set([
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "SUMMARY",
  "CHARACTER",
  "ADAPTATION",
  "CONTAINS",
  "OTHER",
]);

const PREQUEL_RELATION_TYPES = new Set(["PREQUEL", "PARENT"]);
const SEQUEL_RELATION_TYPES = new Set(["SEQUEL"]);
const CORE_STORY_FORMATS = new Set(["TV", "TV_SHORT"]);

const ANIME_FORMAT_WEIGHT: Record<string, number> = {
  TV: 0,
  TV_SHORT: 1,
  MOVIE: 2,
  ONA: 3,
  OVA: 4,
  SPECIAL: 5,
  MUSIC: 6,
};

const ANIME_SEASON_TO_MONTH: Record<string, number> = {
  WINTER: 0,
  SPRING: 3,
  SUMMER: 6,
  FALL: 9,
};

function normalizeRelationType(value?: string | null) {
  return value?.toUpperCase() ?? null;
}

function normalizeAnimeFormat(value?: string | null) {
  return value?.toUpperCase() ?? null;
}

function getRelatedTimelineBucket(entry: RelatedAnimeEntry) {
  const relationType = normalizeRelationType(entry.relationType);
  if (!relationType) {
    return 1;
  }
  if (PREQUEL_RELATION_TYPES.has(relationType)) {
    return 0;
  }
  if (SEQUEL_RELATION_TYPES.has(relationType)) {
    return 2;
  }
  if (SIDE_RELATION_TYPES.has(relationType)) {
    return 4;
  }
  return 3;
}

function isMainlineRelatedEntry(entry: RelatedAnimeEntry) {
  const relationType = normalizeRelationType(entry.relationType);
  if (relationType && SIDE_RELATION_TYPES.has(relationType)) {
    return false;
  }
  if (
    relationType &&
    (PREQUEL_RELATION_TYPES.has(relationType) || SEQUEL_RELATION_TYPES.has(relationType))
  ) {
    return true;
  }

  const format = normalizeAnimeFormat(entry.anilistFormat);
  return !format || CORE_STORY_FORMATS.has(format);
}

function isSeasonProgressionCandidate(entry: RelatedAnimeEntry) {
  const format = normalizeAnimeFormat(entry.anilistFormat);
  if (!format) {
    return true;
  }
  return format === "TV" || format === "TV_SHORT";
}

function getRelatedChronologyValue(entry: RelatedAnimeEntry) {
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
    const monthOffset = ANIME_SEASON_TO_MONTH[season] ?? 0;
    return Date.UTC(entry.animeSeasonYear, monthOffset, 1);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getRelatedFormatWeight(entry: RelatedAnimeEntry) {
  const format = normalizeAnimeFormat(entry.anilistFormat);
  if (!format) {
    return 99;
  }
  return ANIME_FORMAT_WEIGHT[format] ?? 99;
}

function compareRelatedAnimeEntries(a: RelatedAnimeEntry, b: RelatedAnimeEntry) {
  const laneA = isMainlineRelatedEntry(a) ? 0 : 1;
  const laneB = isMainlineRelatedEntry(b) ? 0 : 1;
  if (laneA !== laneB) {
    return laneA - laneB;
  }

  const chronologyA = getRelatedChronologyValue(a);
  const chronologyB = getRelatedChronologyValue(b);
  if (chronologyA !== chronologyB) {
    return chronologyA - chronologyB;
  }

  const bucketA = getRelatedTimelineBucket(a);
  const bucketB = getRelatedTimelineBucket(b);
  if (bucketA !== bucketB) {
    return bucketA - bucketB;
  }

  const formatA = getRelatedFormatWeight(a);
  const formatB = getRelatedFormatWeight(b);
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

function countWatchedEpisodesForSeason(
  seasonNumber: number,
  watchedEpisodeKeys: Set<string>
) {
  let count = 0;
  const seasonPrefix = `${seasonNumber}:`;
  for (const key of watchedEpisodeKeys) {
    if (key.startsWith(seasonPrefix)) count++;
  }
  return count;
}

const episodeDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseEpisodeAirDate(airDate?: string | null) {
  if (!airDate) return null;
  const trimmed = airDate.trim();
  if (!trimmed) return null;

  const directDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directDateMatch) {
    const parsed = new Date(
      Number(directDateMatch[1]),
      Number(directDateMatch[2]) - 1,
      Number(directDateMatch[3]),
      0, 0, 0, 0
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isEpisodeReleased(airDate?: string | null, now = new Date()) {
  const parsedAirDate = parseEpisodeAirDate(airDate);
  if (!parsedAirDate) return true;
  return startOfLocalDay(parsedAirDate).getTime() <= startOfLocalDay(now).getTime();
}

function getEpisodeAvailabilityLabel(airDate?: string | null, now = new Date()) {
  const parsedAirDate = parseEpisodeAirDate(airDate);
  if (!parsedAirDate) {
    return {
      isReleased: true,
      dateLabel: "Air date TBA",
      stateLabel: "Release unknown",
      stateClassName: "text-text-muted",
    };
  }

  const airDay = startOfLocalDay(parsedAirDate);
  const today = startOfLocalDay(now);
  const formattedDate = episodeDateFormatter.format(airDay);

  if (airDay.getTime() > today.getTime()) {
    return {
      isReleased: false,
      dateLabel: `Airs ${formattedDate}`,
      stateLabel: "Not out yet",
      stateClassName: "text-warning",
    };
  }

  if (airDay.getTime() === today.getTime()) {
    return {
      isReleased: true,
      dateLabel: `Airs today (${formattedDate})`,
      stateLabel: "Out now",
      stateClassName: "text-success",
    };
  }

  return {
    isReleased: true,
    dateLabel: `Aired ${formattedDate}`,
    stateLabel: "Released",
    stateClassName: "text-success",
  };
}

function formatTrackingStatus(status?: string | null) {
  if (!status) return null;
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function isTrackingStatus(value?: string | null): value is ShowTrackingStatus {
  return (
    value === "watching" ||
    value === "paused" ||
    value === "dropped" ||
    value === "completed" ||
    value === "plan_to_watch"
  );
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|apos|gt|lt|nbsp|quot);/g,
    (entity, token: string) => {
      if (token.startsWith("#x")) {
        const codePoint = Number.parseInt(token.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      if (token.startsWith("#")) {
        const codePoint = Number.parseInt(token.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return NAMED_HTML_ENTITIES[token] ?? entity;
    }
  );
}

function cleanRichText(value?: string | null) {
  if (!value) return "";
  const withLineBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*li\s*>/gi, "• ")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/<\s*\/?\s*(ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withLineBreaks)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function ShowDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const parsedId = useMemo(() => parseShowRouteId(id), [id]);
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 1024;

  const [show, setShow] = useState<NormalizedShow | null>(null);
  const [seasons, setSeasons] = useState<NormalizedSeason[]>([]);
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  const [expandedSeasonsInitialized, setExpandedSeasonsInitialized] = useState(false);
  const [seasonLoading, setSeasonLoading] = useState<SeasonLoadState>({});
  const [seasonErrors, setSeasonErrors] = useState<SeasonErrorState>({});
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, boolean>>({});
  const [pendingEpisodeKeys, setPendingEpisodeKeys] = useState<EpisodePendingState>({});
  const [seasonActionLoading, setSeasonActionLoading] = useState<SeasonActionState>({});
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [isRemovingFromWatchlist, setIsRemovingFromWatchlist] = useState(false);
  const [isSettingStatus, setIsSettingStatus] = useState(false);
  const [isStatusMenuVisible, setIsStatusMenuVisible] = useState(false);
  const [isMarkingShow, setIsMarkingShow] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddToListModalVisible, setIsAddToListModalVisible] = useState(false);
  const [isTogglingMovieWatch, setIsTogglingMovieWatch] = useState(false);
  const [movieWatchCount, setMovieWatchCount] = useState<number | null>(null);
  const [episodeWatchCounts, setEpisodeWatchCounts] = useState<Record<string, number>>({});
  const [watchActionTarget, setWatchActionTarget] = useState<WatchActionTarget | null>(null);
  const [isWatchActionRunning, setIsWatchActionRunning] = useState(false);
  const [nextSeasonPrompt, setNextSeasonPrompt] = useState<NextSeasonPrompt | null>(null);
  const [isNavigatingToNextSeason, setIsNavigatingToNextSeason] = useState(false);
  const [apiRelatedAnime, setApiRelatedAnime] = useState<AniListRelatedShow[]>([]);
  const [isLoadingRelatedAnime, setIsLoadingRelatedAnime] = useState(false);

  const addToWatchlist = useMutation(api.shows.addToWatchlist);
  const removeFromWatchlist = useMutation(api.shows.removeFromWatchlist);
  const setWatchlistStatus = useMutation(api.shows.setWatchlistStatus);
  const addAnimeToWatchlistWithRelations = useAction(
    api.shows.addAnimeToWatchlistWithRelations
  );
  const toggleEpisodeWatched = useMutation(api.shows.toggleEpisodeWatched);
  const batchRewatchEpisodes = useMutation(api.shows.batchRewatchEpisodes);
  const markSeasonWatched = useMutation(api.shows.markSeasonWatched);
  const unmarkSeasonWatched = useMutation(api.shows.unmarkSeasonWatched);
  const clearShowWatched = useMutation(api.shows.clearShowWatched);
  const toggleMovieWatched = useMutation(api.shows.toggleMovieWatched);

  const trackingArgs = useMemo(() => buildTrackingArgs(show), [show]);
  const tracking = useQuery(api.shows.getUserShowTracking, trackingArgs);
  const canTrackShow = trackingArgs !== "skip";
  const activeTrackingStatus: ShowTrackingStatus = isTrackingStatus(tracking?.status)
    ? tracking.status
    : "plan_to_watch";

  const relatedAnimeTrackingArgs = useMemo(() => {
    if (!show || show.mediaType !== "anime") {
      return "skip" as const;
    }
    if (typeof show.anilistId === "number") {
      return { anilistId: show.anilistId };
    }
    if (typeof show.malId === "number") {
      return { malId: show.malId };
    }
    return "skip" as const;
  }, [show]);

  const trackedRelatedAnime = useQuery(
    api.shows.getRelatedAnimeForShow,
    relatedAnimeTrackingArgs
  );

  const relatedAnimeLookupId =
    show?.mediaType === "anime" && typeof show.anilistId === "number"
      ? show.anilistId
      : null;
  
  // Fetch movie watch history for movies
  const movieWatchHistory = useQuery(
    api.shows.getMovieWatchHistory,
    show?.mediaType === "movie" ? trackingArgs : "skip"
  );

  // Fetch episode watch counts for rewatch functionality
  const episodeWatchCountsData = useQuery(
    api.shows.getEpisodeWatchCounts,
    show?.mediaType !== "movie" ? trackingArgs : "skip"
  );

  // Derive watched keys from tracking query (synchronous - no render delay)
  const baseWatchedKeys = useMemo(
    () => new Set(tracking?.watchedEpisodeKeys ?? []),
    [tracking]
  );

  // Merge base tracking data with optimistic overrides
  const watchedEpisodeKeys = useMemo(() => {
    const overrideKeys = Object.keys(pendingOverrides);
    if (overrideKeys.length === 0) return baseWatchedKeys;
    const result = new Set(baseWatchedKeys);
    for (const key of overrideKeys) {
      if (pendingOverrides[key]) result.add(key);
      else result.delete(key);
    }
    return result;
  }, [baseWatchedKeys, pendingOverrides]);

  // Clear optimistic overrides once all pending operations complete
  useEffect(() => {
    const hasPending = Object.values(pendingEpisodeKeys).some(Boolean) ||
      Object.values(seasonActionLoading).some(Boolean) ||
      isWatchActionRunning;
    if (!hasPending) {
      setPendingOverrides({});
    }
  }, [pendingEpisodeKeys, seasonActionLoading, isWatchActionRunning]);

  // Sync movie watch history
  useEffect(() => {
    if (movieWatchHistory) {
      setMovieWatchCount(movieWatchHistory.watchCount);
    } else if (show?.mediaType === "movie") {
      setMovieWatchCount(null);
    }
  }, [movieWatchHistory, show?.mediaType]);

  // Sync episode watch counts
  useEffect(() => {
    if (episodeWatchCountsData) {
      setEpisodeWatchCounts(episodeWatchCountsData);
    }
  }, [episodeWatchCountsData]);

  useEffect(() => {
    if (typeof relatedAnimeLookupId !== "number") {
      setApiRelatedAnime([]);
      setIsLoadingRelatedAnime(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingRelatedAnime(true);

    void getAniListAnimeRelations(relatedAnimeLookupId)
      .then((graph) => {
        if (isCancelled) return;
        setApiRelatedAnime(graph?.relations ?? []);
      })
      .catch((relationError) => {
        if (isCancelled) return;
        console.warn("Failed to load related anime", relationError);
        setApiRelatedAnime([]);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingRelatedAnime(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [relatedAnimeLookupId]);

  const relatedAnime = useMemo(() => {
    if (!show || show.mediaType !== "anime") {
      return [] as RelatedAnimeEntry[];
    }

    const currentKeys = new Set<string>();
    if (typeof show.anilistId === "number") {
      currentKeys.add(`anilist:${show.anilistId}`);
    }
    if (typeof show.malId === "number") {
      currentKeys.add(`jikan:${show.malId}`);
    }

    const combined = new Map<string, RelatedAnimeEntry>();

    for (const trackedEntry of trackedRelatedAnime ?? []) {
      const key = buildRelatedAnimeKey({
        anilistId: trackedEntry.anilistId,
        malId: trackedEntry.malId,
        title: trackedEntry.title,
      });
      if (currentKeys.has(key)) {
        continue;
      }

      combined.set(key, {
        title: trackedEntry.title,
        posterUrl: trackedEntry.posterUrl,
        firstAired: trackedEntry.firstAired,
        anilistId: trackedEntry.anilistId,
        malId: trackedEntry.malId,
        anilistFormat: trackedEntry.anilistFormat,
        status: trackedEntry.status,
        isInWatchlist: trackedEntry.isInWatchlist,
        isAutoTracked: trackedEntry.isAutoTracked,
        animeSeason: trackedEntry.animeSeason,
        animeSeasonYear: trackedEntry.animeSeasonYear,
        relationType: null,
      });
    }

    for (const relation of apiRelatedAnime) {
      const key = buildRelatedAnimeKey({
        anilistId: relation.anilistId ?? null,
        malId: relation.show.malId ?? null,
        title: relation.show.title,
      });
      if (currentKeys.has(key)) {
        continue;
      }

      const existing = combined.get(key);
      combined.set(key, {
        title: existing?.title ?? relation.show.title,
        posterUrl: existing?.posterUrl ?? relation.show.posterUrl ?? null,
        firstAired: existing?.firstAired ?? relation.show.firstAired ?? null,
        anilistId:
          existing?.anilistId ??
          relation.anilistId ??
          relation.show.anilistId ??
          null,
        malId: existing?.malId ?? relation.show.malId ?? null,
        anilistFormat:
          existing?.anilistFormat ?? relation.show.anilistFormat ?? null,
        status: existing?.status ?? null,
        isInWatchlist: existing?.isInWatchlist ?? false,
        isAutoTracked: existing?.isAutoTracked ?? false,
        animeSeason: existing?.animeSeason ?? relation.show.animeSeason ?? null,
        animeSeasonYear: existing?.animeSeasonYear ?? relation.show.animeSeasonYear ?? null,
        relationType: relation.relationType ?? existing?.relationType ?? null,
      });
    }

    return Array.from(combined.values()).sort(compareRelatedAnimeEntries);
  }, [apiRelatedAnime, show, trackedRelatedAnime]);

  const currentAnimeEntry = useMemo<RelatedAnimeEntry | null>(() => {
    if (!show || show.mediaType !== "anime") {
      return null;
    }

    return {
      title: show.title,
      posterUrl: show.posterUrl ?? null,
      firstAired: show.firstAired ?? null,
      anilistId: show.anilistId ?? null,
      malId: show.malId ?? null,
      anilistFormat: show.anilistFormat ?? null,
      status: tracking?.status ?? null,
      isInWatchlist: tracking?.inWatchlist ?? false,
      isAutoTracked: false,
      animeSeason: show.animeSeason ?? null,
      animeSeasonYear: show.animeSeasonYear ?? null,
      relationType: null,
    };
  }, [show, tracking?.inWatchlist, tracking?.status]);

  const franchiseTimeline = useMemo(() => {
    if (!currentAnimeEntry) {
      return [] as RelatedAnimeEntry[];
    }

    const entries = new Map<string, RelatedAnimeEntry>();
    entries.set(buildRelatedAnimeKey(currentAnimeEntry), currentAnimeEntry);

    for (const entry of relatedAnime) {
      entries.set(buildRelatedAnimeKey(entry), entry);
    }

    return Array.from(entries.values()).sort(compareRelatedAnimeEntries);
  }, [currentAnimeEntry, relatedAnime]);

  const nextMainlineRelatedEntry = useMemo(() => {
    if (!currentAnimeEntry || franchiseTimeline.length === 0) {
      return null;
    }

    const currentKey = buildRelatedAnimeKey(currentAnimeEntry);
    const mainlineEntries = franchiseTimeline.filter((entry) =>
      isMainlineRelatedEntry(entry)
    );

    const seasonEntries = mainlineEntries.filter((entry) =>
      isSeasonProgressionCandidate(entry)
    );

    const orderedEntries = seasonEntries.length > 0 ? seasonEntries : mainlineEntries;

    const currentIndex = orderedEntries.findIndex(
      (entry) => buildRelatedAnimeKey(entry) === currentKey
    );

    if (currentIndex >= 0) {
      return orderedEntries[currentIndex + 1] ?? null;
    }

    const currentChronology = getRelatedChronologyValue(currentAnimeEntry);
    return (
      orderedEntries.find(
        (entry) => getRelatedChronologyValue(entry) > currentChronology
      ) ?? null
    );
  }, [currentAnimeEntry, franchiseTimeline]);

  const getSeasonByNumber = useCallback(
    (seasonNumber: number) =>
      seasons.find((season) => season.seasonNumber === seasonNumber) ?? null,
    [seasons]
  );

  const getReleasedEpisodesForSeason = useCallback(
    (seasonNumber: number) => {
      const season = getSeasonByNumber(seasonNumber);
      if (!season) {
        return [] as NormalizedEpisode[];
      }
      return (season.episodes ?? []).filter((episode) =>
        isEpisodeReleased(episode.airDate)
      );
    },
    [getSeasonByNumber]
  );

  const maybePromptMoveToNextSeason = useCallback(
    (seasonNumber: number, seasonName?: string) => {
      if (!show || show.mediaType !== "anime") {
        return;
      }

      if (!nextMainlineRelatedEntry) {
        return;
      }

      const nextRouteId = getRelatedAnimeRouteId(nextMainlineRelatedEntry);
      if (!nextRouteId) {
        return;
      }

      const completedSeasonName =
        seasonName?.trim() ||
        getSeasonByNumber(seasonNumber)?.name?.trim() ||
        `Season ${seasonNumber}`;

      setNextSeasonPrompt({
        completedSeasonNumber: seasonNumber,
        completedSeasonName,
        nextTitle: nextMainlineRelatedEntry.title,
        nextRouteId,
      });
    },
    [getSeasonByNumber, nextMainlineRelatedEntry, show]
  );

  const resolveSeasonEpisodes = useCallback(async (season: NormalizedSeason) => {
    if (season.episodes?.length) return season.episodes;
    if (!parsedId || parsedId.source !== "tmdb" || parsedId.mediaType !== "tv") {
      return season.episodes ?? [];
    }
    if (seasonLoading[season.seasonNumber]) return season.episodes ?? [];

    setSeasonLoading((prev) => ({ ...prev, [season.seasonNumber]: true }));
    setSeasonErrors((prev) => ({ ...prev, [season.seasonNumber]: null }));

    try {
      const seasonDetails = await getTmdbSeasonDetails(
        parsedId.externalId,
        season.seasonNumber
      );
      const normalizedSeason = normalizeTmdbSeason(seasonDetails);
      const mergedSeason: NormalizedSeason = {
        ...season,
        ...normalizedSeason,
        episodeCount:
          normalizedSeason.episodeCount ??
          season.episodeCount ??
          normalizedSeason.episodes?.length,
      };

      setSeasons((prev) =>
        prev.map((entry) =>
          entry.seasonNumber === season.seasonNumber ? mergedSeason : entry
        )
      );

      return mergedSeason.episodes ?? [];
    } catch (seasonError) {
      console.error("Failed to load season details", seasonError);
      setSeasonErrors((prev) => ({
        ...prev,
        [season.seasonNumber]: "Could not load episodes for this season.",
      }));
      return null;
    } finally {
      setSeasonLoading((prev) => ({ ...prev, [season.seasonNumber]: false }));
    }
  }, [parsedId, seasonLoading]);

  // Auto-expand earliest season with unwatched episodes
  // Wait for tracking data so we know which episodes are watched
  const trackingLoaded = tracking !== undefined || !canTrackShow;

  useEffect(() => {
    if (seasons.length === 0 || expandedSeasonsInitialized || !trackingLoaded) return;

    // Read watched keys directly from tracking query result (not from state,
    // which may not have been committed yet in this render cycle)
    const trackedKeys = new Set(tracking?.watchedEpisodeKeys ?? []);

    // Sort seasons by season number (earliest first)
    const sortedSeasons = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);

    // Find earliest season with unwatched episodes
    let seasonToExpand: number | null = null;

    for (const season of sortedSeasons) {
      const episodeCount = season.episodeCount ?? season.episodes?.length ?? 0;
      if (episodeCount === 0) continue;
      const watchedCount = countWatchedEpisodesForSeason(season.seasonNumber, trackedKeys);

      if (watchedCount < episodeCount) {
        seasonToExpand = season.seasonNumber;
        break;
      }
    }

    // Only expand if there's a season with unwatched episodes
    // If all watched, keep everything collapsed
    if (seasonToExpand !== null) {
      setExpandedSeasons({ [seasonToExpand]: true });

      // Load episodes for the expanded season
      const season = sortedSeasons.find(s => s.seasonNumber === seasonToExpand);
      if (season && !season.episodes && !seasonLoading[seasonToExpand]) {
        resolveSeasonEpisodes(season);
      }
    }

    setExpandedSeasonsInitialized(true);
  }, [seasons, tracking, trackingLoaded, seasonLoading, resolveSeasonEpisodes, expandedSeasonsInitialized]);

  useEffect(() => {
    if (!parsedId) {
      setError("Invalid show ID.");
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const loadShow = async () => {
      setIsLoading(true);
      setError(null);
      setTrackingError(null);
      setShow(null);
      setSeasons([]);
      setExpandedSeasons({});
      setExpandedSeasonsInitialized(false);
      setSeasonLoading({});
      setSeasonErrors({});
      setPendingOverrides({});
      setPendingEpisodeKeys({});
      setSeasonActionLoading({});
      setEpisodeWatchCounts({});
      setIsMarkingShow(false);
      setMovieWatchCount(null);
      setWatchActionTarget(null);
      setIsWatchActionRunning(false);
      setNextSeasonPrompt(null);
      setIsNavigatingToNextSeason(false);

      try {
        if (parsedId.source === "tmdb") {
          const details = await getTmdbShowDetails(
            parsedId.mediaType === "movie" ? "movie" : "tv",
            parsedId.externalId
          );
          if (isCancelled) return;

          const normalized = normalizeTmdbShowDetails(
            parsedId.mediaType === "movie" ? "movie" : "tv",
            details
          );
          setShow(normalized);

          if (parsedId.mediaType === "tv") {
            setSeasons(
              createSeasonPlaceholders(normalized.totalSeasons ?? 0, details.seasons)
            );
          }
          return;
        }

        if (parsedId.source === "anilist") {
          const normalized = await getAniListMediaById(parsedId.externalId);
          if (isCancelled) return;
          if (!normalized) throw new Error("Anime not found.");

          let animeEpisodes: NormalizedEpisode[] = [];
          if (typeof normalized.malId === "number") {
            try {
              animeEpisodes = await getJikanAnimeEpisodes(normalized.malId);
            } catch (episodeError) {
              console.warn("Could not load Jikan episodes for AniList anime", episodeError);
            }
          }

          setShow(normalized);
          setSeasons(
            createAnimeSeason(
              normalized.totalEpisodes,
              animeEpisodes,
              normalized.backdropUrl ?? normalized.posterUrl
            )
          );
          return;
        }

        const [jikanShow, jikanEpisodes] = await Promise.all([
          getJikanAnime(parsedId.externalId),
          getJikanAnimeEpisodes(parsedId.externalId).catch(() => [] as NormalizedEpisode[]),
        ]);
        if (isCancelled) return;

        let resolvedShow = jikanShow;
        try {
          const mappedAniList = await getAniListMediaByMalId(parsedId.externalId);
          if (mappedAniList) {
            resolvedShow = {
              ...jikanShow,
              ...mappedAniList,
              malId: parsedId.externalId,
              title: mappedAniList.title ?? jikanShow.title,
              overview: mappedAniList.overview ?? jikanShow.overview,
              posterUrl: mappedAniList.posterUrl ?? jikanShow.posterUrl,
              backdropUrl: mappedAniList.backdropUrl ?? jikanShow.backdropUrl,
              firstAired: mappedAniList.firstAired ?? jikanShow.firstAired,
              totalEpisodes: mappedAniList.totalEpisodes ?? jikanShow.totalEpisodes,
              episodeRuntime: mappedAniList.episodeRuntime ?? jikanShow.episodeRuntime,
            };
          }
        } catch (mappingError) {
          console.warn("Could not map Jikan anime to AniList", mappingError);
        }

        setShow(resolvedShow);
        setSeasons(
          createAnimeSeason(
            resolvedShow.totalEpisodes,
            jikanEpisodes,
            resolvedShow.backdropUrl ?? resolvedShow.posterUrl
          )
        );
      } catch (loadError) {
        if (isCancelled) return;
        console.error("Failed to load show detail", loadError);
        setError("Could not load show details right now.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadShow();
    return () => { isCancelled = true; };
  }, [parsedId]);

  const handleAddToWatchlist = async () => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (tracking?.inWatchlist) {
      return;
    }
    if (isAddingToWatchlist || isRemovingFromWatchlist || isSettingStatus) {
      return;
    }

    setIsAddingToWatchlist(true);
    setTrackingError(null);
    try {
      const payload = buildShowPayload(show);
      if (show.mediaType === "anime") {
        await addAnimeToWatchlistWithRelations(payload);
      } else {
        await addToWatchlist(payload);
      }
    } catch (mutationError) {
      console.error("Failed to add show to watchlist", mutationError);
      setTrackingError("Could not add this show to watchlist.");
    } finally {
      setIsAddingToWatchlist(false);
    }
  };

  const handleRemoveFromWatchlist = async () => {
    if (!show) return false;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return false;
    }
    if (!tracking?.inWatchlist) {
      return true;
    }
    if (isRemovingFromWatchlist || isAddingToWatchlist || isSettingStatus) {
      return false;
    }

    setIsRemovingFromWatchlist(true);
    setTrackingError(null);
    try {
      await removeFromWatchlist({
        show: buildShowPayload(show),
      });
      setPendingOverrides({});
      setPendingEpisodeKeys({});
      setEpisodeWatchCounts({});
      setMovieWatchCount(null);
      setWatchActionTarget(null);
      return true;
    } catch (mutationError) {
      console.error("Failed to remove show from watchlist", mutationError);
      setTrackingError("Could not remove this show from watchlist.");
      return false;
    } finally {
      setIsRemovingFromWatchlist(false);
    }
  };

  const handleSetTrackingStatus = async (nextStatus: ShowTrackingStatus) => {
    if (!show) return false;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return false;
    }
    if (isSettingStatus || isAddingToWatchlist || isRemovingFromWatchlist) {
      return false;
    }
    if (tracking?.inWatchlist && tracking?.status === nextStatus) {
      return true;
    }

    const payload = buildShowPayload(show);

    setIsSettingStatus(true);
    setTrackingError(null);
    try {
      if (!tracking?.inWatchlist && show.mediaType === "anime") {
        await addAnimeToWatchlistWithRelations(payload);
      }

      await setWatchlistStatus({
        show: payload,
        status: nextStatus,
      });
      return true;
    } catch (mutationError) {
      console.error("Failed to update watch status", mutationError);
      setTrackingError("Could not update watch status.");
      return false;
    } finally {
      setIsSettingStatus(false);
    }
  };

  const handleSelectStatusFromMenu = async (nextStatus: ShowTrackingStatus) => {
    const didUpdate = await handleSetTrackingStatus(nextStatus);
    if (didUpdate) {
      setIsStatusMenuVisible(false);
    }
  };

  const handleRemoveFromStatusMenu = async () => {
    const didRemove = await handleRemoveFromWatchlist();
    if (didRemove) {
      setIsStatusMenuVisible(false);
    }
  };

  const runEpisodeToggle = async (
    episode: NormalizedEpisode,
    action: "toggle" | "rewatch"
  ) => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
    if (pendingEpisodeKeys[key]) return;

    const wasWatched = watchedEpisodeKeys.has(key);

    if (action === "toggle") {
      setPendingOverrides((prev) => ({ ...prev, [key]: !wasWatched }));
    }

    setPendingEpisodeKeys((prev) => ({ ...prev, [key]: true }));
    setTrackingError(null);

    try {
      const result = await toggleEpisodeWatched({
        show: buildShowPayload(show),
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        runtime: episode.runtime,
        action,
      });

      if (action === "rewatch" && result.watchCount) {
        setEpisodeWatchCounts((prev) => ({
          ...prev,
          [key]: result.watchCount,
        }));
      }

      if (action === "toggle") {
        if (wasWatched) {
          setEpisodeWatchCounts((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } else {
          setEpisodeWatchCounts((prev) => ({
            ...prev,
            [key]: 1,
          }));
        }
      }
    } catch (mutationError) {
      console.error("Failed to update episode", mutationError);
      if (action === "toggle") {
        setPendingOverrides((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
      setTrackingError("Could not update episode status.");
      throw mutationError;
    } finally {
      setPendingEpisodeKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleToggleEpisodeWatched = async (episode: NormalizedEpisode) => {
    const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
    const wasWatched = watchedEpisodeKeys.has(key);
    const seasonEntry = getSeasonByNumber(episode.seasonNumber);
    const releasedEpisodes = getReleasedEpisodesForSeason(episode.seasonNumber);
    const watchedBefore = releasedEpisodes.filter((entry) =>
      watchedEpisodeKeys.has(`${entry.seasonNumber}:${entry.episodeNumber}`)
    ).length;

    if (wasWatched) {
      setWatchActionTarget({
        kind: "episode",
        title: episode.name ?? `Episode ${episode.episodeNumber}`,
        subtitle: `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}`,
        episode,
      });
      return;
    }

    try {
      await runEpisodeToggle(episode, "toggle");

      const seasonJustCompleted =
        releasedEpisodes.length > 0 &&
        watchedBefore < releasedEpisodes.length &&
        watchedBefore + 1 >= releasedEpisodes.length;

      if (seasonJustCompleted) {
        maybePromptMoveToNextSeason(
          episode.seasonNumber,
          seasonEntry?.name ?? `Season ${episode.seasonNumber}`
        );
      }
    } catch {
      // Error already handled in runEpisodeToggle.
    }
  };

  const handleMarkSeasonWatched = async (season: NormalizedSeason) => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (seasonActionLoading[season.seasonNumber] || isMarkingShow) return;

    const episodes = await resolveSeasonEpisodes(season);
    if (!episodes?.length) {
      setTrackingError("Episode list is not available for this season yet.");
      return;
    }

    const releasedEpisodes = episodes.filter((episode) =>
      isEpisodeReleased(episode.airDate)
    );
    if (!releasedEpisodes.length) {
      setTrackingError("This season has no released episodes yet.");
      return;
    }

    // If any episodes are watched, show options instead of immediately unwatching.
    const seasonWatchedCount = countWatchedEpisodesForSeason(season.seasonNumber, watchedEpisodeKeys);
    const hasAnyWatched = seasonWatchedCount > 0;

    if (hasAnyWatched) {
      setWatchActionTarget({
        kind: "season",
        title: season.name || `Season ${season.seasonNumber}`,
        subtitle: `${releasedEpisodes.length} released episodes`,
        season,
        releasedEpisodes,
      });
      return;
    }

    const episodeKeys = releasedEpisodes.map(
      (ep) => `${ep.seasonNumber}:${ep.episodeNumber}`
    );

    setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: true }));
    setTrackingError(null);

    // Apply optimistic override
    setPendingOverrides((prev) => {
      const next = { ...prev };
      for (const k of episodeKeys) {
        next[k] = true;
      }
      return next;
    });

    try {
      await markSeasonWatched({
        show: buildShowPayload(show),
        season: season.seasonNumber,
        episodes: releasedEpisodes.map((episode) => ({
          episode: episode.episodeNumber,
          runtime: episode.runtime,
        })),
      });

      maybePromptMoveToNextSeason(
        season.seasonNumber,
        season.name || `Season ${season.seasonNumber}`
      );
    } catch (mutationError) {
      console.error("Failed to toggle season watched", mutationError);
      setPendingOverrides((prev) => {
        const next = { ...prev };
        for (const k of episodeKeys) {
          delete next[k];
        }
        return next;
      });
      setTrackingError("Could not update season status.");
    } finally {
      setSeasonActionLoading((prev) => ({
        ...prev,
        [season.seasonNumber]: false,
      }));
    }
  };

  const handleMarkShowWatched = async () => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (!seasons.length || isMarkingShow) return;

    setIsMarkingShow(true);
    setTrackingError(null);

    const seasonPayloads: { seasonNumber: number; episodes: NormalizedEpisode[] }[] = [];

    try {
      for (const season of seasons) {
        const episodes = await resolveSeasonEpisodes(season);
        if (!episodes?.length) continue;
        const releasedEpisodes = episodes.filter((episode) =>
          isEpisodeReleased(episode.airDate)
        );
        if (!releasedEpisodes.length) continue;
        seasonPayloads.push({
          seasonNumber: season.seasonNumber,
          episodes: releasedEpisodes,
        });
      }

      if (!seasonPayloads.length) {
        setTrackingError("Episode list is not available for this show yet.");
        setIsMarkingShow(false);
        return;
      }

      // Collect all episode keys for the current season payloads
      const allEpisodeKeys: string[] = [];
      for (const payload of seasonPayloads) {
        for (const episode of payload.episodes) {
          allEpisodeKeys.push(`${episode.seasonNumber}:${episode.episodeNumber}`);
        }
      }

      // Count how many of the collected keys are actually watched
      const watchedCountInPayloads = allEpisodeKeys.filter(key => watchedEpisodeKeys.has(key)).length;
      const isFullyWatched = watchedCountInPayloads >= allEpisodeKeys.length;

      setSeasonActionLoading((prev) => {
        const next = { ...prev };
        for (const payload of seasonPayloads) {
          next[payload.seasonNumber] = true;
        }
        return next;
      });

      // Apply optimistic override using the previously collected keys
      setPendingOverrides((prev) => {
        const next = { ...prev };
        for (const k of allEpisodeKeys) {
          next[k] = !isFullyWatched;
        }
        return next;
      });

      // Run mutations in parallel with allSettled to track individual success/failure
      const promises = isFullyWatched
        ? seasonPayloads.map((payload) =>
            unmarkSeasonWatched({
              show: buildShowPayload(show),
              season: payload.seasonNumber,
            })
          )
        : seasonPayloads.map((payload) =>
            markSeasonWatched({
              show: buildShowPayload(show),
              season: payload.seasonNumber,
              episodes: payload.episodes.map((episode) => ({
                episode: episode.episodeNumber,
                runtime: episode.runtime,
              })),
            })
          );

      const results = await Promise.allSettled(promises);

      // Identify failed seasons
      const failedIndices = results
        .map((result, index) => (result.status === "rejected" ? index : -1))
        .filter((index) => index !== -1);

      if (failedIndices.length > 0) {
        console.error("Some seasons failed to update:", failedIndices);
        // Only revert optimistic overrides for failed seasons
        const failedKeys: string[] = [];
        for (const index of failedIndices) {
          const payload = seasonPayloads[index];
          for (const ep of payload.episodes) {
            failedKeys.push(`${ep.seasonNumber}:${ep.episodeNumber}`);
          }
        }
        setPendingOverrides((prev) => {
          const next = { ...prev };
          for (const k of failedKeys) {
            delete next[k];
          }
          return next;
        });
        setTrackingError(
          `Could not update ${failedIndices.length} season${failedIndices.length > 1 ? "s" : ""}. Please try again.`
        );
      } else if (!isFullyWatched && show.mediaType === "anime") {
        const firstPayload = seasonPayloads[0];
        if (firstPayload) {
          const season = seasons.find(
            (entry) => entry.seasonNumber === firstPayload.seasonNumber
          );
          maybePromptMoveToNextSeason(
            firstPayload.seasonNumber,
            season?.name || `Season ${firstPayload.seasonNumber}`
          );
        }
      }
    } finally {
      setSeasonActionLoading((prev) => {
        const next = { ...prev };
        for (const payload of seasonPayloads) {
          next[payload.seasonNumber] = false;
        }
        return next;
      });
      setIsMarkingShow(false);
    }
  };

  const toggleSeason = async (seasonNumber: number) => {
    const willExpand = !expandedSeasons[seasonNumber];
    setExpandedSeasons((prev) => ({ ...prev, [seasonNumber]: willExpand }));

    if (!willExpand) return;

    const season = seasons.find((entry) => entry.seasonNumber === seasonNumber);
    if (!season || season.episodes || seasonLoading[seasonNumber]) return;

    await resolveSeasonEpisodes(season);
  };

  // Movie watch handlers
  const handleToggleMovieWatched = async (action: "toggle" | "rewatch" = "toggle") => {
    if (!show || show.mediaType !== "movie") return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    setIsTogglingMovieWatch(true);
    setTrackingError(null);

    try {
      const result = await toggleMovieWatched({
        show: buildShowPayload(show),
        action,
      });

      setMovieWatchCount(result.watched ? result.watchCount : null);
    } catch (mutationError) {
      console.error("Failed to toggle movie watched", mutationError);
      setTrackingError("Could not update movie status.");
      throw mutationError;
    } finally {
      setIsTogglingMovieWatch(false);
    }
  };

  // Rewatch handlers for TV shows/anime
  const handleRewatchEpisode = async (episode: NormalizedEpisode) => {
    await runEpisodeToggle(episode, "rewatch");
  };

  const handleRewatchSeason = async (
    season: NormalizedSeason,
    releasedEpisodesOverride?: NormalizedEpisode[]
  ) => {
    if (!show || !canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    const episodes =
      releasedEpisodesOverride ??
      (await (async () => {
        const resolvedEpisodes =
          season.episodes?.length ? season.episodes : await resolveSeasonEpisodes(season);
        return (resolvedEpisodes ?? []).filter((episode) =>
          isEpisodeReleased(episode.airDate)
        );
      })());

    if (!episodes.length) {
      setTrackingError("Episode list not available.");
      return;
    }

    setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: true }));
    setTrackingError(null);

    try {
      await batchRewatchEpisodes({
        show: buildShowPayload(show),
        episodes: episodes.map((episode) => ({
          season: episode.seasonNumber,
          episode: episode.episodeNumber,
          runtime: episode.runtime,
        })),
      });

      setEpisodeWatchCounts((prev) => {
        const next = { ...prev };
        for (const episode of episodes) {
          const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
          const current = next[key] ?? (watchedEpisodeKeys.has(key) ? 1 : 0);
          next[key] = current + 1;
        }
        return next;
      });
    } catch (mutationError) {
      console.error("Failed to rewatch season", mutationError);
      setTrackingError("Could not update season status.");
      throw mutationError;
    } finally {
      setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: false }));
    }
  };

  const collectReleasedShowEpisodes = async () => {
    if (watchedEpisodeKeys.size > 0) {
      const fromWatchedKeys = Array.from(watchedEpisodeKeys)
        .map((key) => {
          const [seasonRaw, episodeRaw] = key.split(":");
          const seasonNumber = Number(seasonRaw);
          const episodeNumber = Number(episodeRaw);
          if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
            return null;
          }
          return {
            id: `rewatch:${seasonNumber}:${episodeNumber}`,
            seasonNumber,
            episodeNumber,
            runtime: show?.episodeRuntime,
          } as NormalizedEpisode;
        })
        .filter((episode): episode is NormalizedEpisode => episode !== null)
        .sort((a, b) =>
          a.seasonNumber === b.seasonNumber
            ? a.episodeNumber - b.episodeNumber
            : a.seasonNumber - b.seasonNumber
        );

      if (fromWatchedKeys.length > 0) {
        return fromWatchedKeys;
      }
    }

    const allEpisodes: NormalizedEpisode[] = [];
    for (const season of seasons) {
      const resolvedEpisodes =
        season.episodes?.length ? season.episodes : await resolveSeasonEpisodes(season);
      const released = (resolvedEpisodes ?? []).filter((episode) =>
        isEpisodeReleased(episode.airDate)
      );
      allEpisodes.push(...released);
    }
    return allEpisodes;
  };

  const handleRewatchShow = async (releasedEpisodesOverride?: NormalizedEpisode[]) => {
    if (!show || !canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    const allEpisodes = releasedEpisodesOverride ?? (await collectReleasedShowEpisodes());

    if (!allEpisodes.length) {
      setTrackingError("Episode list not available.");
      return;
    }

    setIsMarkingShow(true);
    setTrackingError(null);

    try {
      await batchRewatchEpisodes({
        show: buildShowPayload(show),
        episodes: allEpisodes.map((episode) => ({
          season: episode.seasonNumber,
          episode: episode.episodeNumber,
          runtime: episode.runtime,
        })),
      });

      setEpisodeWatchCounts((prev) => {
        const next = { ...prev };
        for (const episode of allEpisodes) {
          const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
          const current = next[key] ?? (watchedEpisodeKeys.has(key) ? 1 : 0);
          next[key] = current + 1;
        }
        return next;
      });
    } catch (mutationError) {
      console.error("Failed to rewatch show", mutationError);
      setTrackingError("Could not update show status.");
      throw mutationError;
    } finally {
      setIsMarkingShow(false);
    }
  };

  const handleUnwatchSeason = async (
    season: NormalizedSeason,
    releasedEpisodesOverride?: NormalizedEpisode[]
  ) => {
    if (!show || !canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    const episodes = releasedEpisodesOverride ?? (season.episodes ?? []);
    const episodeKeys = episodes.map((ep) => `${ep.seasonNumber}:${ep.episodeNumber}`);

    setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: true }));
    setTrackingError(null);
    setPendingOverrides((prev) => {
      const next = { ...prev };
      for (const key of episodeKeys) {
        next[key] = false;
      }
      return next;
    });

    try {
      await unmarkSeasonWatched({
        show: buildShowPayload(show),
        season: season.seasonNumber,
      });
    } catch (mutationError) {
      console.error("Failed to unwatch season", mutationError);
      setTrackingError("Could not update season status.");
      setPendingOverrides((prev) => {
        const next = { ...prev };
        for (const key of episodeKeys) {
          delete next[key];
        }
        return next;
      });
      throw mutationError;
    } finally {
      setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: false }));
    }
  };

  const handleOpenShowActionMenu = async () => {
    if (!show || !canTrackShow || show.mediaType === "movie") return;
    const releasedEpisodes = await collectReleasedShowEpisodes();
    if (!releasedEpisodes.length) {
      setTrackingError("Episode list is not available for this show yet.");
      return;
    }

    setWatchActionTarget({
      kind: "show",
      title: show.title,
      subtitle: `${releasedEpisodes.length} released episodes`,
      releasedEpisodes,
    });
  };

  const handleOpenMovieActionMenu = () => {
    if (!show || show.mediaType !== "movie") return;
    setWatchActionTarget({
      kind: "movie",
      title: show.title,
      subtitle: movieWatchCount && movieWatchCount > 1
        ? `Watched ${movieWatchCount} times`
        : "Watched",
    });
  };

  const handleWatchActionChoice = async (choice: "rewatch" | "not_watched") => {
    if (!watchActionTarget || isWatchActionRunning) return;

    setIsWatchActionRunning(true);
    let didSucceed = false;

    try {
      if (watchActionTarget.kind === "movie") {
        await handleToggleMovieWatched(choice === "rewatch" ? "rewatch" : "toggle");
      }

      if (watchActionTarget.kind === "episode") {
        if (choice === "rewatch") {
          await handleRewatchEpisode(watchActionTarget.episode);
        } else {
          await runEpisodeToggle(watchActionTarget.episode, "toggle");
        }
      }

      if (watchActionTarget.kind === "season") {
        if (choice === "rewatch") {
          await handleRewatchSeason(
            watchActionTarget.season,
            watchActionTarget.releasedEpisodes
          );
        } else {
          await handleUnwatchSeason(
            watchActionTarget.season,
            watchActionTarget.releasedEpisodes
          );
        }
      }

      if (watchActionTarget.kind === "show") {
        if (choice === "rewatch") {
          await handleRewatchShow(watchActionTarget.releasedEpisodes);
        } else {
          if (!show) {
            throw new Error("Show context unavailable");
          }

          const previousPendingOverrides = { ...pendingOverrides };
          const previousEpisodeWatchCounts = { ...episodeWatchCounts };

          setPendingOverrides((prev) => {
            const next = { ...prev };
            for (const episode of watchActionTarget.releasedEpisodes) {
              next[`${episode.seasonNumber}:${episode.episodeNumber}`] = false;
            }
            return next;
          });
          setEpisodeWatchCounts((prev) => {
            const next = { ...prev };
            for (const episode of watchActionTarget.releasedEpisodes) {
              delete next[`${episode.seasonNumber}:${episode.episodeNumber}`];
            }
            return next;
          });

          try {
            await clearShowWatched({
              show: buildShowPayload(show),
            });
          } catch (mutationError) {
            setPendingOverrides(previousPendingOverrides);
            setEpisodeWatchCounts(previousEpisodeWatchCounts);
            throw mutationError;
          }
        }
      }
      didSucceed = true;
    } catch (mutationError) {
      console.error("Failed to apply watch action", mutationError);
      setTrackingError("Could not update watch status. Please try again.");
    } finally {
      setIsWatchActionRunning(false);
      if (didSucceed) {
        setWatchActionTarget(null);
      }
    }
  };

  const handleNavigateToNextSeason = () => {
    if (!nextSeasonPrompt || isNavigatingToNextSeason) {
      return;
    }

    const routeId = nextSeasonPrompt.nextRouteId;
    setIsNavigatingToNextSeason(true);
    setNextSeasonPrompt(null);

    try {
      router.push({ pathname: "/show/[id]", params: { id: routeId } });
    } catch (navigationError) {
      console.error("Failed to navigate to next season", navigationError);
      setTrackingError("Could not open the next season.");
    } finally {
      setIsNavigatingToNextSeason(false);
    }
  };

  // Stats
  const watchedEpisodesCount = watchedEpisodeKeys.size;
  const totalEpisodesCount = useMemo(() => {
    if (show?.totalEpisodes) return show.totalEpisodes;
    const inferred = seasons.reduce((sum, season) => {
      return sum + (season.episodeCount ?? season.episodes?.length ?? 0);
    }, 0);
    return inferred > 0 ? inferred : null;
  }, [seasons, show?.totalEpisodes]);

  const watchProgressRatio = totalEpisodesCount
    ? Math.min(1, watchedEpisodesCount / totalEpisodesCount)
    : 0;

  const isShowFullyWatched =
    totalEpisodesCount !== null && watchedEpisodesCount >= totalEpisodesCount;

  const isWatchlistActionPending = isAddingToWatchlist || isRemovingFromWatchlist;
  const isStatusMenuBusy = isSettingStatus || isWatchlistActionPending;
  const activeTrackingOption =
    trackingStatusOptions.find((option) => option.value === activeTrackingStatus) ??
    trackingStatusOptions[1];
  const watchlistActionLabel = isAddingToWatchlist
    ? "Adding..."
    : isRemovingFromWatchlist
      ? "Removing..."
      : tracking?.inWatchlist
        ? "Remove from Watchlist"
        : "Add to Watchlist";

  const cleanedShowTitle = cleanRichText(show?.title) || show?.title || "";
  const cleanedShowOverview =
    cleanRichText(show?.overview) || "No overview available yet.";
  const showPosterUrl = toHttpsImageUrl(show?.posterUrl);

  if (isLoading) {
    return (
      <ScreenWrapper contentClassName="px-0 py-0">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#ef4444" />
          <Text className="mt-4 text-sm text-text-secondary">Loading show details...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (error) {
    return (
      <ScreenWrapper contentClassName="px-4 py-6">
        <View className="rounded-xl border-2 border-primary/30 bg-primary/10 p-6">
          <Text className="text-lg font-semibold text-primary">Error</Text>
          <Text className="mt-2 text-sm text-text-secondary">{error}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (!show) {
    return (
      <ScreenWrapper contentClassName="px-4 py-6">
        <View className="items-center py-12">
          <Text className="text-text-secondary">Show not found.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper contentClassName="px-0 py-0">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Hero Section */}
        <ShowHeader
          backdropUrl={show.backdropUrl}
          posterUrl={show.posterUrl}
          title={cleanedShowTitle}
          mediaType={show.mediaType}
          firstAired={show.firstAired}
          rating={show.rating}
          isDesktop={isDesktop}
        />

        {/* Main Content */}
        <View className={`${isDesktop ? "px-8" : "px-1"} pt-6 pb-8`}>
          <View className={`mx-auto w-full ${isDesktop ? "max-w-4xl" : ""}`}>
          {/* Overview & Poster Row (Mobile Only) */}
          {!isDesktop && (
            <View className="mb-6 flex-row gap-4">
              {showPosterUrl && (
                <View
                  className="overflow-hidden rounded-lg border-2 border-border-default shadow-lg"
                  style={{ width: 100, height: 150 }}
                >
                  <Image
                    source={{ uri: showPosterUrl }}
                    className="h-full w-full"
                    resizeMode="cover"
                  />
                </View>
              )}
              <View className="flex-1">
                <Text className="text-sm leading-relaxed text-text-secondary">
                  {cleanedShowOverview}
                </Text>
              </View>
            </View>
          )}

          {/* Desktop Overview */}
          {isDesktop && (
            <View className="mb-8 max-w-3xl">
              <Text className="text-base leading-relaxed text-text-secondary">
                {cleanedShowOverview}
              </Text>
            </View>
          )}

          {/* Stats Row */}
          <View className="mb-6 flex-row flex-wrap gap-2">
            {show.genres?.slice(0, 4).map((genre) => (
              <Badge key={genre} label={genre} variant="default" />
            ))}
            {show.mediaType !== "movie" && show.totalSeasons && (
              <Badge label={`${show.totalSeasons} Seasons`} variant="accent" />
            )}
            {show.mediaType !== "movie" && show.totalEpisodes && (
              <Badge label={`${show.totalEpisodes} Episodes`} variant="accent" />
            )}
            {show.mediaType === "movie" && show.episodeRuntime && (
              <Badge label={`${show.episodeRuntime} min`} variant="default" />
            )}
            {show.mediaType !== "movie" && show.episodeRuntime && (
              <Badge label={`${show.episodeRuntime}m avg`} variant="default" />
            )}
          </View>

          {/* Progress Section - Hide for movies */}
          {canTrackShow && show.mediaType !== "movie" && (
            <View className="mb-6 rounded-xl border-2 border-border-default bg-bg-surface p-5">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-text-primary">
                  Watch Progress
                </Text>
                <Text className="text-sm font-bold text-primary">
                  {totalEpisodesCount
                    ? `${watchedEpisodesCount}/${totalEpisodesCount}`
                    : watchedEpisodesCount}{" "}
                  episodes
                </Text>
              </View>
              <ProgressBar progress={watchProgressRatio} height={8} animated />
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-xs text-text-muted">
                  {tracking?.inWatchlist
                    ? `Saved${tracking?.status ? ` · ${formatTrackingStatus(tracking.status)}` : ""}`
                    : "Add to watchlist to track your progress"}
                </Text>
                <Text className="text-xs font-semibold text-text-secondary">
                  {Math.round(watchProgressRatio * 100)}%
                </Text>
              </View>
            </View>
          )}

          {canTrackShow && (
            <View className="mb-6 rounded-xl border-2 border-border-default bg-bg-surface p-5">
              <View className="mb-3 flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-text-primary">
                    Tracking
                  </Text>
                  <Text className="mt-1 text-xs text-text-secondary">
                    {tracking?.inWatchlist
                      ? `Current status: ${activeTrackingOption.label}`
                      : "Not in your watchlist yet."}
                  </Text>
                </View>
                <Badge
                  label={tracking?.inWatchlist ? activeTrackingOption.label : "Not Tracked"}
                  variant={tracking?.inWatchlist ? "accent" : "default"}
                />
              </View>

              <View
                className={`gap-2 ${
                  isDesktop ? "flex-row flex-wrap items-center" : "flex-col"
                }`}
              >
                <Pressable
                  onPress={() => {
                    if (tracking?.inWatchlist) {
                      void handleRemoveFromWatchlist();
                      return;
                    }
                    void handleAddToWatchlist();
                  }}
                  disabled={!canTrackShow || isStatusMenuBusy}
                  className={`rounded-lg border border-border-default bg-bg-base px-3.5 py-2.5 ${
                    isDesktop
                      ? "flex-row items-center gap-1.5"
                      : "w-full flex-row items-center justify-center gap-1.5"
                  }`}
                  style={({ pressed }) => ({
                    opacity: !canTrackShow || isStatusMenuBusy ? 0.45 : pressed ? 0.85 : 1,
                  })}
                >
                  {isWatchlistActionPending ? (
                    <ActivityIndicator size="small" color="#a1a1aa" />
                  ) : (
                    <Ionicons
                      name={tracking?.inWatchlist ? "remove-circle-outline" : "add-circle-outline"}
                      size={15}
                      color={tracking?.inWatchlist ? "#ef4444" : "#a1a1aa"}
                    />
                  )}
                  <Text
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      tracking?.inWatchlist ? "text-primary" : "text-text-secondary"
                    }`}
                  >
                    {watchlistActionLabel}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setIsStatusMenuVisible(true)}
                  disabled={!canTrackShow || isStatusMenuBusy}
                  className={`rounded-lg border border-border-default bg-bg-base px-3.5 py-2.5 ${
                    isDesktop
                      ? "flex-row items-center gap-1.5"
                      : "w-full flex-row items-center justify-center gap-1.5"
                  }`}
                  style={({ pressed }) => ({
                    opacity: !canTrackShow || isStatusMenuBusy ? 0.45 : pressed ? 0.85 : 1,
                  })}
                >
                  <Ionicons
                    name="ellipsis-horizontal-circle-outline"
                    size={15}
                    color="#a1a1aa"
                  />
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Edit Status
                  </Text>
                </Pressable>
              </View>

              {show.mediaType === "anime" ? (
                <Text className="mt-3 text-xs text-text-muted">
                  Franchise note: related anime can be auto-followed in timeline order.
                  Status changes here apply to this title.
                </Text>
              ) : null}

              {isSettingStatus ? (
                <View className="mt-3 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#52525b" />
                  <Text className="text-xs text-text-secondary">
                    Updating status...
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Action Buttons - Radio button style */}
          {canTrackShow && (
            <View className="mb-6 flex-row flex-wrap items-center gap-6">
              {/* Show-level action for TV/anime */}
              {show.mediaType !== "movie" && seasons.length > 0 && (
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={
                      isShowFullyWatched
                        ? handleOpenShowActionMenu
                        : handleMarkShowWatched
                    }
                    disabled={!canTrackShow || isMarkingShow}
                    className="relative h-7 w-7 items-center justify-center"
                    style={({ pressed }) => ({
                      opacity: !canTrackShow || isMarkingShow ? 0.5 : 1,
                      transform: [{ scale: pressed ? 0.9 : 1 }],
                    })}
                  >
                    <View
                      className={`absolute h-7 w-7 rounded-full border-2 ${
                        isShowFullyWatched ? "border-success" : "border-text-secondary"
                      }`}
                    />
                    {isShowFullyWatched && (
                      <>
                        <View className="h-4 w-4 rounded-full bg-success" />
                        <View className="absolute inset-0 items-center justify-center">
                          <Text className="text-xs font-bold text-white">✓</Text>
                        </View>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={
                      isShowFullyWatched
                        ? handleOpenShowActionMenu
                        : handleMarkShowWatched
                    }
                    disabled={!canTrackShow || isMarkingShow}
                    className="active:opacity-70"
                  >
                    <Text
                      className={`text-sm ${
                        isShowFullyWatched ? "text-success font-medium" : "text-text-secondary"
                      }`}
                    >
                      {isMarkingShow
                        ? "Saving..."
                        : isShowFullyWatched
                          ? "Watched"
                          : "Mark All Watched"}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Add to List Button */}
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={() => setIsAddToListModalVisible(true)}
                  className="relative h-7 w-7 items-center justify-center"
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  })}
                >
                  <View className="absolute h-7 w-7 rounded-full border-2 border-text-secondary" />
                  <Ionicons name="bookmark-outline" size={14} color="#a1a1aa" />
                </Pressable>
                <Pressable
                  onPress={() => setIsAddToListModalVisible(true)}
                  className="active:opacity-70"
                >
                  <Text className="text-sm text-text-secondary">Add to List</Text>
                </Pressable>
              </View>
            </View>
          )}

          {trackingError && (
            <View className="mb-6 rounded-xl bg-primary/10 p-4">
              <Text className="text-sm text-primary">{trackingError}</Text>
            </View>
          )}

          {/* Related Anime */}
          {show.mediaType === "anime" && (relatedAnime.length > 0 || isLoadingRelatedAnime) && (
            <View className="mb-6 rounded-xl border-2 border-border-default bg-bg-surface p-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text
                  className="text-lg text-text-primary"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  Related Anime
                </Text>
                <Text className="text-xs text-text-secondary">
                  {relatedAnime.length} linked
                </Text>
              </View>

              {isLoadingRelatedAnime && relatedAnime.length === 0 ? (
                <View className="items-center py-5">
                  <ActivityIndicator size="small" color="#ef4444" />
                  <Text className="mt-2 text-xs text-text-secondary">
                    Loading franchise links...
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingRight: 4 }}
                >
                  {relatedAnime.map((entry) => {
                    const routeId = getRelatedAnimeRouteId(entry);
                    const relationLabel = formatRelationTypeLabel(entry.relationType);
                    const seasonLabel = formatAnimeSeasonLabel(
                      entry.animeSeason,
                      entry.animeSeasonYear
                    );
                    const statusLabel = formatTrackingStatus(entry.status);
                    const yearLabel = entry.firstAired?.slice(0, 4) ?? "TBA";
                    const posterUrl = toHttpsImageUrl(entry.posterUrl);

                    const cardContent = (
                      <View className="w-36 gap-2">
                        <View className="relative h-52 overflow-hidden rounded-lg border-2 border-border-default bg-bg-elevated">
                          {posterUrl ? (
                            <Image
                              source={{ uri: posterUrl }}
                              className="h-full w-full"
                              resizeMode="cover"
                            />
                          ) : (
                            <View className="h-full items-center justify-center px-2">
                              <Text
                                className="text-center text-xs font-semibold text-text-secondary"
                                numberOfLines={3}
                              >
                                {entry.title}
                              </Text>
                            </View>
                          )}
                          {entry.isAutoTracked && (
                            <View className="absolute left-2 top-2 rounded-md border border-primary/40 bg-primary/20 px-1.5 py-0.5">
                              <Text className="text-[10px] font-black uppercase tracking-wide text-primary">
                                Auto
                              </Text>
                            </View>
                          )}
                        </View>

                        <View className="gap-1 px-0.5">
                          <Text className="text-xs font-semibold text-text-primary" numberOfLines={2}>
                            {entry.title}
                          </Text>
                          <Text className="text-[11px] text-text-secondary" numberOfLines={1}>
                            {seasonLabel ? `${seasonLabel} · ${yearLabel}` : yearLabel}
                          </Text>
                          <View className="flex-row flex-wrap gap-1">
                            {relationLabel ? (
                              <Badge label={relationLabel} variant="accent" />
                            ) : null}
                            {statusLabel ? <Badge label={statusLabel} variant="default" /> : null}
                          </View>
                        </View>
                      </View>
                    );

                    if (!routeId) {
                      return (
                        <View key={buildRelatedAnimeKey(entry)} className="opacity-80">
                          {cardContent}
                        </View>
                      );
                    }

                    return (
                      <Link
                        key={buildRelatedAnimeKey(entry)}
                        href={{ pathname: "/show/[id]", params: { id: routeId } }}
                        asChild
                      >
                        <Pressable
                          className="active:opacity-80"
                          style={({ pressed }) =>
                            pressed ? { opacity: 0.95, transform: [{ scale: 0.98 }] } : undefined
                          }
                        >
                          {cardContent}
                        </Pressable>
                      </Link>
                    );
                  })}
                </ScrollView>
              )}

              <Text className="mt-3 text-xs text-text-muted">
                Ordered by franchise chronology (main story first, side stories after). Auto-
                followed entries show the Auto label. Open any related title to change its
                watch status.
              </Text>
            </View>
          )}

          {/* Seasons Section */}
          {seasons.length > 0 && (
            <View>
              <Text
                className="mb-4 text-xl text-text-primary"
                style={{ fontFamily: "Courier New", fontWeight: "900" }}
              >
                Seasons & Episodes
              </Text>
              <View className="gap-3">
                {seasons.map((season) => {
                  const episodes = season.episodes ?? [];
                  // Only calculate released count if episodes are loaded
                  // Otherwise pass 0 to disable the button until loaded
                  const releasedCount = episodes.length > 0
                    ? episodes.filter((ep) => isEpisodeReleased(ep.airDate)).length
                    : 0;

                  return (
                    <SeasonAccordion
                      key={season.seasonNumber}
                      seasonNumber={season.seasonNumber}
                      name={season.name || ""}
                      episodeCount={season.episodeCount}
                      episodes={episodes}
                      isExpanded={!!expandedSeasons[season.seasonNumber]}
                      isLoading={!!seasonLoading[season.seasonNumber]}
                      error={seasonErrors[season.seasonNumber]}
                      watchedCount={countWatchedEpisodesForSeason(
                        season.seasonNumber,
                        watchedEpisodeKeys
                      )}
                      releasedCount={releasedCount}
                      isMarking={!!seasonActionLoading[season.seasonNumber]}
                      pendingEpisodeKeys={pendingEpisodeKeys}
                      watchedEpisodeKeys={watchedEpisodeKeys}
                      episodeWatchCounts={episodeWatchCounts}
                      getEpisodeAvailability={getEpisodeAvailabilityLabel}
                      onToggle={() => toggleSeason(season.seasonNumber)}
                      onMarkSeason={() => handleMarkSeasonWatched(season)}
                      onToggleEpisode={handleToggleEpisodeWatched}
                    />
                  );
                })}
              </View>
            </View>
          )}

          {/* Movie Watch Section */}
          {show.mediaType === "movie" && (
            <View className="rounded-xl border-2 border-border-default bg-bg-surface p-5">
              <Text className="mb-4 text-lg font-bold text-text-primary">
                Watch Status
              </Text>

              {isTogglingMovieWatch ? (
                <View className="items-center py-4">
                  <ActivityIndicator size="small" color="#ef4444" />
                </View>
              ) : (
                <View className="gap-3">
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      onPress={() => {
                        if (movieWatchCount && movieWatchCount > 0) {
                          handleOpenMovieActionMenu();
                        } else {
                          void handleToggleMovieWatched("toggle").catch(() => undefined);
                        }
                      }}
                      className="relative h-8 w-8 items-center justify-center"
                      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.9 : 1 }] })}
                    >
                      <View
                        className={`absolute h-8 w-8 rounded-full border-2 ${
                          movieWatchCount && movieWatchCount > 0 ? "border-success" : "border-text-secondary"
                        }`}
                      />
                      {movieWatchCount && movieWatchCount > 0 ? (
                        <>
                          <View className="h-4 w-4 rounded-full bg-success" />
                          <View className="absolute inset-0 items-center justify-center">
                            <Text className="text-xs font-bold text-white">✓</Text>
                          </View>
                        </>
                      ) : (
                        <Ionicons name="film-outline" size={14} color="#a1a1aa" />
                      )}
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        if (movieWatchCount && movieWatchCount > 0) {
                          handleOpenMovieActionMenu();
                        } else {
                          void handleToggleMovieWatched("toggle").catch(() => undefined);
                        }
                      }}
                      className="active:opacity-70"
                    >
                      <Text
                        className={`text-sm ${
                          movieWatchCount && movieWatchCount > 0
                            ? "font-medium text-success"
                            : "text-text-secondary"
                        }`}
                      >
                        {movieWatchCount && movieWatchCount > 0
                          ? `Watched${movieWatchCount > 1 ? ` (${movieWatchCount}x)` : ""}`
                          : "Mark as Watched"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          )}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={!!nextSeasonPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => !isNavigatingToNextSeason && setNextSeasonPrompt(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => !isNavigatingToNextSeason && setNextSeasonPrompt(null)}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Season Complete
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={2}>
                {nextSeasonPrompt?.completedSeasonName}
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-text-secondary">
                You finished this season. Move to the next entry?
              </Text>
              <Text className="mt-1 text-sm font-semibold text-text-primary" numberOfLines={2}>
                {nextSeasonPrompt?.nextTitle}
              </Text>
            </View>

            <View className="gap-2 p-4">
              <Pressable
                disabled={isNavigatingToNextSeason}
                onPress={handleNavigateToNextSeason}
                className="items-center justify-center rounded-xl border border-primary/40 bg-primary/15 py-3.5 active:bg-primary/20"
              >
                {isNavigatingToNextSeason ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="font-semibold text-text-primary">Opening...</Text>
                  </View>
                ) : (
                  <Text className="font-semibold text-text-primary">Go to Next Season</Text>
                )}
              </Pressable>

              <Pressable
                disabled={isNavigatingToNextSeason}
                onPress={() => setNextSeasonPrompt(null)}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                <Text className="font-semibold text-text-secondary">Stay Here</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!watchActionTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setWatchActionTarget(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => !isWatchActionRunning && setWatchActionTarget(null)}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Watch Options
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={1}>
                {watchActionTarget?.title}
              </Text>
              <Text className="mt-1 text-sm text-text-secondary" numberOfLines={2}>
                {watchActionTarget?.subtitle}
              </Text>
            </View>

            <View className="gap-2 p-4">
              <Pressable
                disabled={isWatchActionRunning}
                onPress={() => void handleWatchActionChoice("rewatch")}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                {isWatchActionRunning ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#a1a1aa" />
                    <Text className="font-semibold text-text-secondary">Processing...</Text>
                  </View>
                ) : (
                  <Text className="font-semibold text-text-primary">Rewatch</Text>
                )}
              </Pressable>

              <Pressable
                disabled={isWatchActionRunning}
                onPress={() => void handleWatchActionChoice("not_watched")}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                <Text className="font-semibold text-text-secondary">Mark Not Watched</Text>
              </Pressable>

              <Pressable
                disabled={isWatchActionRunning}
                onPress={() => setWatchActionTarget(null)}
                className="items-center justify-center rounded-xl py-2"
              >
                <Text className="text-sm text-text-muted">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isStatusMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isStatusMenuBusy) {
            setIsStatusMenuVisible(false);
          }
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => {
              if (!isStatusMenuBusy) {
                setIsStatusMenuVisible(false);
              }
            }}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Edit Tracking
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={2}>
                {cleanedShowTitle}
              </Text>
              <Text className="mt-2 text-sm text-text-secondary">
                {tracking?.inWatchlist
                  ? `Current status: ${activeTrackingOption.label}`
                  : "Pick a status to add this title to your watchlist."}
              </Text>
              {show.mediaType === "anime" ? (
                <Text className="mt-1 text-xs text-text-muted">
                  Related anime may auto-follow as part of the franchise timeline.
                </Text>
              ) : null}
            </View>

            <View className="gap-2 p-4">
              {trackingStatusOptions.map((option) => {
                const isActive = !!tracking?.inWatchlist && activeTrackingStatus === option.value;
                return (
                  <Pressable
                    key={option.value}
                    disabled={isStatusMenuBusy}
                    onPress={() => {
                      void handleSelectStatusFromMenu(option.value);
                    }}
                    className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                      isActive
                        ? "border-primary/60 bg-primary/15"
                        : "border-border-default bg-bg-base"
                    }`}
                    style={({ pressed }) => ({
                      opacity: isStatusMenuBusy ? 0.45 : pressed ? 0.9 : 1,
                    })}
                  >
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          isActive ? "text-primary" : "text-text-primary"
                        }`}
                      >
                        {option.label}
                      </Text>
                      <Text className="mt-0.5 text-xs text-text-secondary">
                        {option.description}
                      </Text>
                    </View>
                    <Ionicons
                      name={isActive ? "radio-button-on" : "radio-button-off"}
                      size={18}
                      color={isActive ? "#ef4444" : "#71717a"}
                    />
                  </Pressable>
                );
              })}

              {tracking?.inWatchlist ? (
                <Pressable
                  disabled={isStatusMenuBusy}
                  onPress={() => {
                    void handleRemoveFromStatusMenu();
                  }}
                  className="items-center justify-center rounded-xl border border-primary/35 bg-primary/10 py-3"
                  style={({ pressed }) => ({
                    opacity: isStatusMenuBusy ? 0.45 : pressed ? 0.85 : 1,
                  })}
                >
                  <Text className="font-semibold text-primary">Remove from Watchlist</Text>
                </Pressable>
              ) : null}

              {isStatusMenuBusy ? (
                <View className="flex-row items-center justify-center gap-2 py-1">
                  <ActivityIndicator size="small" color="#a1a1aa" />
                  <Text className="text-xs text-text-secondary">Saving...</Text>
                </View>
              ) : null}

              <Pressable
                disabled={isStatusMenuBusy}
                onPress={() => setIsStatusMenuVisible(false)}
                className="items-center justify-center rounded-xl py-2"
              >
                <Text className="text-sm text-text-muted">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add to List Modal */}
      <AddToListModal
        visible={isAddToListModalVisible}
        onClose={() => setIsAddToListModalVisible(false)}
        show={show}
      />
    </ScreenWrapper>
  );
}

export default ShowDetailScreen;
