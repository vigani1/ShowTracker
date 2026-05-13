import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Badge } from "@/components/Badge";
import { ProgressBar } from "@/components/ProgressBar";
import { OverlayDetailFrame } from "@/components/OverlayDetailFrame";
import { ShowHeader } from "@/components/ShowHeader";
import { ShowActionBar } from "@/components/ShowActionBar";
import { SeasonAccordion } from "@/components/SeasonAccordion";
import {
  ContinueTrackingRail,
  type ContinueTrackingRailItem,
} from "@/components/ContinueTrackingRail";
import { AddToListModal } from "@/components/AddToListModal";
import {
  getAniListAnimeRelations,
  getAniListMediaById,
  getAniListMediaByMalId,
  type AniListRelatedShow,
} from "@/lib/api/anilist";
import {
  getJikanAnime,
  getJikanAnimeEpisodes,
  getJikanAnimeEpisodesPage,
} from "@/lib/api/jikan";
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
type SeasonWatchedKeyErrorState = Record<number, string | null>;
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

type PreviousEpisodesPrompt = {
  episode: NormalizedEpisode;
  missingEpisodes: NormalizedEpisode[];
  completedSeasonName: string;
  shouldPromptNextSeason: boolean;
};

type RemoveLibraryPrompt = {
  message: string;
};

type AnimeHomeRelationMode = "core_only" | "all_relations";
type AnimeCompletionBehavior =
  | "ask_every_time"
  | "auto_open_next"
  | "auto_pause_others_keep_next";

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
const FULL_JIKAN_EPISODE_PAGE_BUDGET = 100;
const FIRST_EPISODE_PAGE = 1;
const FRANCHISE_AUTO_SYNC_FRESH_MS = 1000 * 60 * 60 * 24 * 30;
const CAUGHT_UP_LINES = [
  { text: "And now my watch is ended.", credit: "Game of Thrones" },
  { text: "That's all. The rest is confetti.", credit: "Nell Crain" },
  { text: "Then our business here is finished.", credit: "Gus Fring" },
  { text: "That's it.", credit: "Gus Fring" },
  { text: "Just like that.", credit: "Gus Fring" },
  { text: "It's finished, okay?", credit: "Emmit Stussy" },
  { text: "I'm done.", credit: "Walter White" },
  { text: "Because of you, there will be a tomorrow.", credit: "Wu" },
  { text: "And if we did it once, we can do it again!", credit: "Goliath" },
  { text: "They're final, yet festival.", credit: "Lexi Carter" },
  { text: "All's well that ends well.", credit: "Star Trek" },
  { text: "The work is done.", credit: "The Lord of the Rings" },
  { text: "There and back again.", credit: "Bilbo Baggins" },
  { text: "We're all stories in the end.", credit: "The Doctor" },
  { text: "Everybody lives!", credit: "The Doctor" },
  { text: "It is over.", credit: "Obi-Wan Kenobi" },
  { text: "We did it.", credit: "Dora" },
  { text: "Mission accomplished.", credit: "Kim Possible" },
  { text: "The deed is done.", credit: "Macbeth" },
  { text: "All good things...", credit: "Star Trek" },
];

function shouldRefreshFullAnimeEpisodes(
  page1HasNext: boolean,
  totalEpisodes: number | null | undefined,
  loadedEpisodes: NormalizedEpisode[]
) {
  return (
    page1HasNext ||
    (typeof totalEpisodes === "number" && loadedEpisodes.length < totalEpisodes)
  );
}

function isValidAnimeHomeRelationMode(value: unknown): value is AnimeHomeRelationMode {
  return value === "core_only" || value === "all_relations";
}

function isValidAnimeCompletionBehavior(value: unknown): value is AnimeCompletionBehavior {
  return (
    value === "ask_every_time" ||
    value === "auto_open_next" ||
    value === "auto_pause_others_keep_next"
  );
}

function shouldAutoCompleteShow(
  show: Pick<NormalizedShow, "mediaType" | "status" | "totalEpisodes">,
  watchedEpisodes: number
) {
  if (show.mediaType === "movie") {
    return watchedEpisodes > 0;
  }

  if (
    typeof show.totalEpisodes !== "number" ||
    !Number.isFinite(show.totalEpisodes) ||
    show.totalEpisodes <= 0
  ) {
    return false;
  }

  if (watchedEpisodes < show.totalEpisodes) {
    return false;
  }

  const normalizedStatus = show.status?.trim().toLowerCase();
  return normalizedStatus ? TERMINAL_SHOW_LIFECYCLE_STATUSES.has(normalizedStatus) : false;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getCaughtUpLine(showId: string, date = new Date()) {
  const dayKey = date.toISOString().slice(0, 10);
  const index = hashString(`${showId}:${dayKey}`) % CAUGHT_UP_LINES.length;
  return CAUGHT_UP_LINES[index];
}

const ANIME_SETTINGS_UPDATE_TIMEOUT_MS = 12000;

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

const seriesTrackingStatusOptions: {
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

const movieTrackingStatusOptions: {
  value: ShowTrackingStatus;
  label: string;
  description: string;
}[] = [
  {
    value: "plan_to_watch",
    label: "Planned",
    description: "Saved for later",
  },
  {
    value: "completed",
    label: "Watched",
    description: "Already watched this movie",
  },
  {
    value: "dropped",
    label: "Dropped",
    description: "No longer in your movie queue",
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

function buildShowLookupArgs(show: NormalizedShow | null) {
  if (!show) return "skip" as const;

  const lookupArgs: {
    tmdbId?: number;
    anilistId?: number;
    malId?: number;
    tvmazeId?: number;
    mediaType: "tv" | "anime" | "movie";
  } = {
    mediaType: show.mediaType,
  };

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

  if (
    typeof lookupArgs.tmdbId !== "number" &&
    typeof lookupArgs.anilistId !== "number" &&
    typeof lookupArgs.malId !== "number" &&
    typeof lookupArgs.tvmazeId !== "number"
  ) {
    return "skip" as const;
  }

  return lookupArgs;
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

function sortEpisodesByPosition(a: NormalizedEpisode, b: NormalizedEpisode) {
  return a.seasonNumber === b.seasonNumber
    ? a.episodeNumber - b.episodeNumber
    : a.seasonNumber - b.seasonNumber;
}

function getEpisodePositionKey(episode: NormalizedEpisode) {
  return `${episode.seasonNumber}:${episode.episodeNumber}`;
}

function getRailSeasonLoadKey(seasonNumber: number, reason: "previous" | "next" | "anchor") {
  return `${seasonNumber}:${reason}`;
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
  if (!parsedAirDate) return false;
  return startOfLocalDay(parsedAirDate).getTime() <= startOfLocalDay(now).getTime();
}

function getEpisodeAvailabilityLabel(airDate?: string | null, now = new Date()) {
  const parsedAirDate = parseEpisodeAirDate(airDate);
  if (!parsedAirDate) {
    return {
      isReleased: false,
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
  const { isAuthenticated } = useConvexAuth();
  const isDesktop = Platform.OS === "web" && width >= 1024;
  const isOverlayDetailRoute = router.canDismiss();
  const closeOverlayDetailRoute = useCallback(() => {
    if (router.canDismiss()) {
      router.dismiss();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/home");
  }, [router]);

  const [show, setShow] = useState<NormalizedShow | null>(null);
  const [seasons, setSeasons] = useState<NormalizedSeason[]>([]);
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  const [expandedSeasonsInitialized, setExpandedSeasonsInitialized] = useState(false);
  const [seasonLoading, setSeasonLoading] = useState<SeasonLoadState>({});
  const [seasonErrors, setSeasonErrors] = useState<SeasonErrorState>({});
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, boolean>>({});
  const [pendingEpisodeKeys, setPendingEpisodeKeys] = useState<EpisodePendingState>({});
  const [seasonActionLoading, setSeasonActionLoading] = useState<SeasonActionState>({});
  const [isRailLoadingMore, setIsRailLoadingMore] = useState(false);
  const [seasonWatchedKeyErrors, setSeasonWatchedKeyErrors] =
    useState<SeasonWatchedKeyErrorState>({});
  const [isRemovingFromWatchlist, setIsRemovingFromWatchlist] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [isRepairingTracking, setIsRepairingTracking] = useState(false);
  const [isSettingStatus, setIsSettingStatus] = useState(false);
  const [isStatusMenuVisible, setIsStatusMenuVisible] = useState(false);
  const [isMarkingShow, setIsMarkingShow] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddToListModalVisible, setIsAddToListModalVisible] = useState(false);
  const [isTogglingMovieWatch, setIsTogglingMovieWatch] = useState(false);
  const [movieWatchCount, setMovieWatchCount] = useState<number | null>(null);
  const [episodeWatchCounts, setEpisodeWatchCounts] = useState<Record<string, number>>({});
  const [hasRailInitialized, setHasRailInitialized] = useState(false);
  const [seasonWatchedKeys, setSeasonWatchedKeys] = useState<Record<number, Set<string>>>({});
  const [optimisticTrackingStatus, setOptimisticTrackingStatus] = useState<ShowTrackingStatus | null>(null);
  const [watchActionTarget, setWatchActionTarget] = useState<WatchActionTarget | null>(null);
  const [isWatchActionRunning, setIsWatchActionRunning] = useState(false);
  const [nextSeasonPrompt, setNextSeasonPrompt] = useState<NextSeasonPrompt | null>(null);
  const [previousEpisodesPrompt, setPreviousEpisodesPrompt] =
    useState<PreviousEpisodesPrompt | null>(null);
  const [removeLibraryPrompt, setRemoveLibraryPrompt] =
    useState<RemoveLibraryPrompt | null>(null);
  const [isPreviousEpisodesPromptRunning, setIsPreviousEpisodesPromptRunning] =
    useState(false);
  const [isNavigatingToNextSeason, setIsNavigatingToNextSeason] = useState(false);
  const [isPausingRelatedEntries, setIsPausingRelatedEntries] = useState(false);
  const [isUpdatingAnimeSettings, setIsUpdatingAnimeSettings] = useState(false);
  const [isSyncingRelatedAnime, setIsSyncingRelatedAnime] = useState(false);
  const [isFranchiseSettingsModalVisible, setIsFranchiseSettingsModalVisible] =
    useState(false);
  const animeSettingsUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animeSettingsOpIdRef = useRef(0);
  const widthRef = useRef(width);
  const expandedSeasonsRef = useRef(expandedSeasons);
  const seasonWatchedKeysRef = useRef(seasonWatchedKeys);
  const seasonWatchedKeyErrorsRef = useRef(seasonWatchedKeyErrors);
  const loadingSeasonsRef = useRef<Set<number>>(new Set());
  const inFlightSeasonsRef = useRef<Set<string>>(new Set());
  const railAutoPrefetchKeyRef = useRef<string | null>(null);
  const seasonLoadGenerationRef = useRef(0);
  const prevInWatchlistRef = useRef<boolean | null>(null);
  const metadataRefreshKeyRef = useRef<string | null>(null);
  const relationAutoSyncKeyRef = useRef<string | null>(null);
  const removeLibraryPromptResolveRef = useRef<((didConfirm: boolean) => void) | null>(
    null
  );
  const [apiRelatedAnime, setApiRelatedAnime] = useState<AniListRelatedShow[]>([]);
  const [isLoadingRelatedAnime, setIsLoadingRelatedAnime] = useState(false);

  const resetLocalTrackingProgress = useCallback(() => {
    seasonLoadGenerationRef.current += 1;
    loadingSeasonsRef.current.clear();
    railAutoPrefetchKeyRef.current = null;
    setPendingOverrides({});
    setPendingEpisodeKeys({});
    setSeasonActionLoading({});
    setSeasonWatchedKeys({});
    setSeasonWatchedKeyErrors({});
    setEpisodeWatchCounts({});
    setHasRailInitialized(false);
    setMovieWatchCount(null);
    setOptimisticTrackingStatus(null);
    setWatchActionTarget(null);
    setNextSeasonPrompt(null);
    setPreviousEpisodesPrompt(null);
    setIsWatchActionRunning(false);
  }, []);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const removeFromWatchlist = useMutation(api.shows.removeFromWatchlist);
  const setWatchlistStatus = useMutation(api.shows.setWatchlistStatus);
  const setFavoriteStatus = useMutation(api.shows.setFavoriteStatus);
  const repairTrackingForShow = useMutation(api.shows.repairTrackingForShow);
  const refreshTrackedShowMetadata = useAction(api.shows.refreshTrackedShowMetadata);
  const addAnimeToWatchlistWithRelations = useAction(
    api.shows.addAnimeToWatchlistWithRelations
  );
  const getWatchedEpisodesForSeasonAction = useAction(
    api.shows.getWatchedEpisodesForSeasonAction
  );
  const toggleEpisodeWatched = useMutation(api.shows.toggleEpisodeWatched);
  const batchMarkEpisodesWatched = useMutation(api.shows.batchMarkEpisodesWatched);
  const batchRewatchEpisodes = useMutation(api.shows.batchRewatchEpisodes);
  const markSeasonWatched = useMutation(api.shows.markSeasonWatched);
  const unmarkSeasonWatched = useMutation(api.shows.unmarkSeasonWatched);
  const clearShowWatched = useMutation(api.shows.clearShowWatched);
  const clearRelatedAnimeWatched = useMutation(api.shows.clearRelatedAnimeWatched);
  const pauseOtherRelatedAnimeEntries = useMutation(
    api.shows.pauseOtherRelatedAnimeEntries
  );
  const setAnimeFranchiseRelationMode = useMutation(
    api.shows.setAnimeFranchiseRelationMode
  );
  const syncAnimeRelationsForRoot = useAction(api.shows.syncAnimeRelationsForRoot);
  const pruneAnimeFranchiseToCoreRelations = useAction(
    api.shows.pruneAnimeFranchiseToCoreRelations
  );
  const toggleMovieWatched = useMutation(api.shows.toggleMovieWatched);

  const trackingArgs = useMemo(() => buildTrackingArgs(show), [show]);
  const showLookupArgs = useMemo(() => buildShowLookupArgs(show), [show]);
  const tracking = useQuery(api.shows.getUserShowTracking, trackingArgs);
  const watchedSeasonProgress = useQuery(
    api.shows.getWatchedSeasonProgress,
    trackingArgs
  );
  const canTrackShow = trackingArgs !== "skip";
  const trackingLoaded = tracking !== undefined || !canTrackShow;
  const isInWatchlist = trackingLoaded && tracking?.inWatchlist === true;
  
  // Use optimistic status if set, otherwise fall back to query result
  const activeTrackingStatus: ShowTrackingStatus = optimisticTrackingStatus ?? (
    isTrackingStatus(tracking?.status)
      ? tracking.status
      : "plan_to_watch"
  );
  
  // Reset optimistic status when tracking query updates
  useEffect(() => {
    if (tracking?.status && optimisticTrackingStatus !== null) {
      setOptimisticTrackingStatus(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking?.status]);

  useEffect(() => {
    if (isRemovingFromWatchlist && tracking?.inWatchlist === false) {
      setIsRemovingFromWatchlist(false);
    }
  }, [
    isRemovingFromWatchlist,
    tracking?.inWatchlist,
  ]);

  useEffect(() => {
    const currentInWatchlist =
      typeof tracking?.inWatchlist === "boolean" ? tracking.inWatchlist : null;

    if (prevInWatchlistRef.current === true && currentInWatchlist === false) {
      resetLocalTrackingProgress();
    }

    prevInWatchlistRef.current = currentInWatchlist;
  }, [resetLocalTrackingProgress, tracking?.inWatchlist]);

  useEffect(() => {
    if (!isUpdatingAnimeSettings) {
      if (animeSettingsUpdateTimeoutRef.current) {
        clearTimeout(animeSettingsUpdateTimeoutRef.current);
        animeSettingsUpdateTimeoutRef.current = null;
      }
      return;
    }

    if (animeSettingsUpdateTimeoutRef.current) {
      clearTimeout(animeSettingsUpdateTimeoutRef.current);
    }

    animeSettingsUpdateTimeoutRef.current = setTimeout(() => {
      setIsUpdatingAnimeSettings(false);
      setTrackingError("Anime settings update timed out. Please try again.");
    }, ANIME_SETTINGS_UPDATE_TIMEOUT_MS);

    return () => {
      if (animeSettingsUpdateTimeoutRef.current) {
        clearTimeout(animeSettingsUpdateTimeoutRef.current);
        animeSettingsUpdateTimeoutRef.current = null;
      }
    };
  }, [isUpdatingAnimeSettings]);

  const trackingStatusOptions = useMemo(
    () =>
      show?.mediaType === "movie"
        ? movieTrackingStatusOptions
        : seriesTrackingStatusOptions,
    [show?.mediaType]
  );

  const activeTrackingStatusForMenu = useMemo<ShowTrackingStatus>(() => {
    const isCurrentStatusInMenu = trackingStatusOptions.some(
      (option) => option.value === activeTrackingStatus
    );
    if (isCurrentStatusInMenu) {
      return activeTrackingStatus;
    }

    if (show?.mediaType === "movie") {
      return "plan_to_watch";
    }

    return activeTrackingStatus;
  }, [activeTrackingStatus, show?.mediaType, trackingStatusOptions]);

  const relationRootAnilistId = useMemo(() => {
    if (!show || show.mediaType !== "anime") {
      return null;
    }

    const trackedRoot =
      tracking &&
      typeof tracking === "object" &&
      "relationRootAnilistId" in tracking &&
      typeof tracking.relationRootAnilistId === "number"
        ? tracking.relationRootAnilistId
        : null;

    if (typeof show.rootAnilistId === "number") {
      return show.rootAnilistId;
    }
    if (typeof trackedRoot === "number") {
      return trackedRoot;
    }
    if (typeof show.anilistId === "number") {
      return show.anilistId;
    }
    return null;
  }, [show, tracking]);

  const animeFranchiseSettings = useQuery(
    api.shows.getAnimeFranchiseHomeSettings,
    typeof relationRootAnilistId === "number"
      ? { relationRootAnilistId }
      : "skip"
  );

  const globalAnimeRelationMode = isValidAnimeHomeRelationMode(
    animeFranchiseSettings?.globalRelationMode
  )
    ? animeFranchiseSettings.globalRelationMode
    : "core_only";
  const franchiseAnimeRelationMode =
    animeFranchiseSettings?.franchiseRelationMode === null
      ? null
      : isValidAnimeHomeRelationMode(animeFranchiseSettings?.franchiseRelationMode)
        ? animeFranchiseSettings.franchiseRelationMode
        : null;
  const effectiveAnimeRelationMode = isValidAnimeHomeRelationMode(
    animeFranchiseSettings?.effectiveRelationMode
  )
    ? animeFranchiseSettings.effectiveRelationMode
    : globalAnimeRelationMode;
  const animeCompletionBehavior = isValidAnimeCompletionBehavior(
    animeFranchiseSettings?.completionBehavior
  )
    ? animeFranchiseSettings.completionBehavior
    : "ask_every_time";
  const animeFranchiseLastRelationSyncAt =
    typeof animeFranchiseSettings?.lastRelationSyncAt === "number"
      ? animeFranchiseSettings.lastRelationSyncAt
      : null;

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

  // Build watched keys from loaded season data + optimistic overrides
  const watchedEpisodeKeys = useMemo(() => {
    const result = new Set<string>();
    // Add keys from all loaded seasons
    for (const keys of Object.values(seasonWatchedKeys)) {
      for (const key of keys) {
        result.add(key);
      }
    }
    // Apply optimistic overrides
    for (const [key, isWatched] of Object.entries(pendingOverrides)) {
      if (isWatched) result.add(key);
      else result.delete(key);
    }
    return result;
  }, [seasonWatchedKeys, pendingOverrides]);

  const watchedSeasonCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of watchedSeasonProgress ?? []) {
      map.set(entry.season, entry.watchedEpisodes);
    }
    return map;
  }, [watchedSeasonProgress]);
  const hasLoadedWatchedSeasonProgress = watchedSeasonProgress !== undefined;

  const getSeasonWatchedCount = useCallback(
    (seasonNumber: number) => {
      const hasLoadedSeasonKeys = seasonWatchedKeys[seasonNumber] !== undefined;
      const hasSeasonWatchedKeyError = seasonWatchedKeyErrors[seasonNumber] !== undefined;
      const hasPendingOverridesForSeason = Object.keys(pendingOverrides).some((key) =>
        key.startsWith(`${seasonNumber}:`)
      );

      if ((hasLoadedSeasonKeys && !hasSeasonWatchedKeyError) || hasPendingOverridesForSeason) {
        return countWatchedEpisodesForSeason(seasonNumber, watchedEpisodeKeys);
      }

      return watchedSeasonCountMap.get(seasonNumber) ?? 0;
    },
    [pendingOverrides, seasonWatchedKeyErrors, seasonWatchedKeys, watchedEpisodeKeys, watchedSeasonCountMap]
  );

  const totalWatchedEpisodesCount = useMemo(() => {
    const watchedFromTracking =
      typeof tracking?.watchedEpisodes === "number" ? tracking.watchedEpisodes : 0;
    const loadedSeasonNumbers = Object.keys(seasonWatchedKeys).map((value) => Number(value));
    const hasLoadedAllKnownSeasons =
      seasons.length > 0 && loadedSeasonNumbers.length >= seasons.length;

    if (hasLoadedAllKnownSeasons) {
      return watchedEpisodeKeys.size;
    }

    if (!hasLoadedWatchedSeasonProgress) {
      return Math.max(watchedFromTracking, watchedEpisodeKeys.size);
    }

    let totalFromProgress = 0;
    for (const count of watchedSeasonCountMap.values()) {
      totalFromProgress += count;
    }

    for (const seasonNumber of loadedSeasonNumbers) {
      const baselineSeasonCount = watchedSeasonCountMap.get(seasonNumber) ?? 0;
      const loadedSeasonCount = countWatchedEpisodesForSeason(seasonNumber, watchedEpisodeKeys);
      totalFromProgress += loadedSeasonCount - baselineSeasonCount;
    }

    return Math.max(totalFromProgress, 0);
  }, [
    hasLoadedWatchedSeasonProgress,
    seasons.length,
    seasonWatchedKeys,
    watchedEpisodeKeys,
    watchedSeasonCountMap,
    tracking?.watchedEpisodes,
  ]);

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
    if (episodeWatchCountsData && episodeWatchCountsData.length > 0) {
      const counts: Record<string, number> = {};
      for (const entry of episodeWatchCountsData) {
        counts[`${entry.season}:${entry.episode}`] = entry.count;
      }
      setEpisodeWatchCounts(counts);
      return;
    }

    setEpisodeWatchCounts({});
  }, [episodeWatchCountsData]);

  useEffect(() => {
    expandedSeasonsRef.current = expandedSeasons;
  }, [expandedSeasons]);

  useEffect(() => {
    seasonWatchedKeysRef.current = seasonWatchedKeys;
  }, [seasonWatchedKeys]);

  useEffect(() => {
    seasonWatchedKeyErrorsRef.current = seasonWatchedKeyErrors;
  }, [seasonWatchedKeyErrors]);

  useEffect(() => {
    if (!trackingNotice) {
      return;
    }

    const timer = setTimeout(() => {
      setTrackingNotice(null);
    }, 2500);

    return () => {
      clearTimeout(timer);
    };
  }, [trackingNotice]);

  const loadWatchedKeysForSeason = useCallback(
    async (seasonNumber: number) => {
      if (trackingArgs === "skip" || !getWatchedEpisodesForSeasonAction || !isInWatchlist) {
        return;
      }
      const inFlightKey = getRailSeasonLoadKey(seasonNumber, "anchor");
      if (seasonWatchedKeysRef.current[seasonNumber]) return;
      if (loadingSeasonsRef.current.has(seasonNumber)) return;
      if (inFlightSeasonsRef.current.has(inFlightKey)) return;

      loadingSeasonsRef.current.add(seasonNumber);
      inFlightSeasonsRef.current.add(inFlightKey);
      const loadGeneration = seasonLoadGenerationRef.current;
      setSeasonWatchedKeyErrors((prev) => {
        if (prev[seasonNumber] === undefined) {
          return prev;
        }
        const next = { ...prev };
        delete next[seasonNumber];
        return next;
      });

      try {
        const keys = await getWatchedEpisodesForSeasonAction({
          ...trackingArgs,
          season: seasonNumber,
        });

        if (seasonLoadGenerationRef.current !== loadGeneration) {
          return;
        }
        if (seasonWatchedKeysRef.current[seasonNumber]) {
          return;
        }

        setSeasonWatchedKeys((prev) => {
          if (prev[seasonNumber]) {
            return prev;
          }

          return {
            ...prev,
            [seasonNumber]: new Set(keys),
          };
        });
        setSeasonWatchedKeyErrors((prev) => {
          if (prev[seasonNumber] === undefined) {
            return prev;
          }
          const next = { ...prev };
          delete next[seasonNumber];
          return next;
        });
      } catch (error) {
        console.error("Failed to load watched episodes for season", seasonNumber, error);
        setSeasonWatchedKeyErrors((prev) => ({
          ...prev,
          [seasonNumber]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        loadingSeasonsRef.current.delete(seasonNumber);
        inFlightSeasonsRef.current.delete(inFlightKey);
      }
    },
    [getWatchedEpisodesForSeasonAction, isInWatchlist, trackingArgs]
  );

  // Load watched episodes for expanded seasons
  useEffect(() => {
    if (trackingArgs === "skip" || !getWatchedEpisodesForSeasonAction || !isInWatchlist) {
      return;
    }

    const expandedSeasonNumbers = Object.entries(expandedSeasons)
      .filter(([, isExpanded]) => isExpanded)
      .map(([seasonNum]) => Number(seasonNum));

    for (const seasonNumber of expandedSeasonNumbers) {
      void loadWatchedKeysForSeason(seasonNumber);
    }
  }, [expandedSeasons, getWatchedEpisodesForSeasonAction, isInWatchlist, loadWatchedKeysForSeason, trackingArgs]);

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

  useEffect(() => {
    if (
      !show ||
      show.mediaType !== "anime" ||
      typeof relationRootAnilistId !== "number" ||
      animeFranchiseSettings === undefined
    ) {
      return;
    }

    const syncKey = `${relationRootAnilistId}:${animeFranchiseLastRelationSyncAt ?? "never"}`;
    if (relationAutoSyncKeyRef.current === syncKey) {
      return;
    }

    if (
      animeFranchiseLastRelationSyncAt !== null &&
      Date.now() - animeFranchiseLastRelationSyncAt < FRANCHISE_AUTO_SYNC_FRESH_MS
    ) {
      relationAutoSyncKeyRef.current = syncKey;
      return;
    }

    relationAutoSyncKeyRef.current = syncKey;
    void syncAnimeRelationsForRoot({ relationRootAnilistId, force: false }).catch((syncError) => {
      console.warn("Background franchise relation sync failed", syncError);
      relationAutoSyncKeyRef.current = null;
    });
  }, [
    animeFranchiseLastRelationSyncAt,
    animeFranchiseSettings,
    relationRootAnilistId,
    show,
    syncAnimeRelationsForRoot,
  ]);

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
    async (seasonNumber: number, seasonName?: string) => {
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

      if (animeCompletionBehavior === "auto_open_next") {
        try {
          router.push({ pathname: "/show/[id]", params: { id: nextRouteId } });
        } catch (navigationError) {
          console.error("Failed to auto-open next season", navigationError);
          setTrackingError("Could not open the next season.");
        }
        return;
      }

      if (
        animeCompletionBehavior === "auto_pause_others_keep_next" &&
        showLookupArgs !== "skip"
      ) {
        const keepNext = {
          anilistId: nextMainlineRelatedEntry.anilistId ?? undefined,
          malId: nextMainlineRelatedEntry.malId ?? undefined,
          mediaType: "anime" as const,
        };

        try {
          await pauseOtherRelatedAnimeEntries({
            show: showLookupArgs,
            keepNext,
          });
          setTrackingNotice("Paused related franchise titles and kept next season active.");
        } catch (pauseError) {
          console.error("Failed to auto-pause related seasons", pauseError);
          setTrackingError("Could not apply franchise pause preference.");
        }
        return;
      }

      setNextSeasonPrompt({
        completedSeasonNumber: seasonNumber,
        completedSeasonName,
        nextTitle: nextMainlineRelatedEntry.title,
        nextRouteId,
      });
    },
    [
      animeCompletionBehavior,
      getSeasonByNumber,
      nextMainlineRelatedEntry,
      pauseOtherRelatedAnimeEntries,
      router,
      show,
      showLookupArgs,
    ]
  );

  const resolveSeasonEpisodes = useCallback(async (season: NormalizedSeason) => {
    if (season.episodes?.length) return season.episodes;
    if (!parsedId || parsedId.source !== "tmdb" || parsedId.mediaType !== "tv") {
      return season.episodes ?? [];
    }
    const inFlightKey = `episodes:${season.seasonNumber}`;
    if (seasonLoading[season.seasonNumber]) return season.episodes ?? [];
    if (inFlightSeasonsRef.current.has(inFlightKey)) return season.episodes ?? [];

    inFlightSeasonsRef.current.add(inFlightKey);
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
      inFlightSeasonsRef.current.delete(inFlightKey);
      setSeasonLoading((prev) => ({ ...prev, [season.seasonNumber]: false }));
    }
  }, [parsedId, seasonLoading]);

  // Auto-expand earliest season with unwatched episodes
  // Wait for tracking data so we know which episodes are watched
  const seasonProgressLoaded = watchedSeasonProgress !== undefined || !canTrackShow;

  useEffect(() => {
    if (
      seasons.length === 0 ||
      expandedSeasonsInitialized ||
      !trackingLoaded ||
      !seasonProgressLoaded
    ) {
      return;
    }

    // Sort seasons by season number (earliest first)
    const sortedSeasons = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);

    const seasonWithUnwatched = sortedSeasons.find((season) => {
      const seasonEpisodeCount =
        season.episodeCount ?? season.episodes?.length ?? null;
      if (typeof seasonEpisodeCount !== "number" || seasonEpisodeCount <= 0) {
        return false;
      }
      return getSeasonWatchedCount(season.seasonNumber) < seasonEpisodeCount;
    });

    const seasonToExpand =
      seasonWithUnwatched?.seasonNumber ?? sortedSeasons[0]?.seasonNumber ?? null;

    if (seasonToExpand !== null) {
      setExpandedSeasons({ [seasonToExpand]: true });

      // Load episodes for the expanded season
      const season = sortedSeasons.find((s) => s.seasonNumber === seasonToExpand);
      if (season && !season.episodes && !seasonLoading[seasonToExpand!]) {
        void resolveSeasonEpisodes(season);
      }
    }
    setExpandedSeasonsInitialized(true);
  }, [
    seasons,
    trackingLoaded,
    seasonProgressLoaded,
    getSeasonWatchedCount,
    seasonLoading,
    resolveSeasonEpisodes,
    expandedSeasonsInitialized,
  ]);

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
      setIsRailLoadingMore(false);
      setEpisodeWatchCounts({});
      setHasRailInitialized(false);
      setIsMarkingShow(false);
      setMovieWatchCount(null);
      setWatchActionTarget(null);
      setIsWatchActionRunning(false);
      setNextSeasonPrompt(null);
      setPreviousEpisodesPrompt(null);
      setIsPreviousEpisodesPromptRunning(false);
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
          let normalized: NormalizedShow | null = null;
          try {
            normalized = await getAniListMediaById(parsedId.externalId);
          } catch (anilistError) {
            console.warn("Failed to load from AniList (CORS or network error):", anilistError);
          }
          if (isCancelled) return;
          if (!normalized) {
            throw new Error("Anime not found. AniList may be unavailable.");
          }

          let animeEpisodes: NormalizedEpisode[] = [];
          let animePage1HasNext = false;
          if (typeof normalized.malId === "number") {
            try {
              const page1 = await getJikanAnimeEpisodesPage(
                normalized.malId,
                FIRST_EPISODE_PAGE
              );
              animeEpisodes = page1.episodes;
              animePage1HasNext = page1.hasNextPage;
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

          if (
            typeof normalized.malId === "number" &&
            shouldRefreshFullAnimeEpisodes(
              animePage1HasNext,
              normalized.totalEpisodes,
              animeEpisodes
            )
          ) {
            void getJikanAnimeEpisodes(
              normalized.malId,
              FULL_JIKAN_EPISODE_PAGE_BUDGET
            )
              .then((fullEpisodes) => {
                if (isCancelled || fullEpisodes.length === 0) {
                  return;
                }

                setSeasons(
                  createAnimeSeason(
                    normalized.totalEpisodes,
                    fullEpisodes,
                    normalized.backdropUrl ?? normalized.posterUrl
                  )
                );
              })
              .catch((episodeError) => {
                if (!isCancelled) {
                  console.warn("Could not refresh full Jikan episodes for AniList anime", episodeError);
                }
              });
          }
          return;
        }

        const [jikanShow, jikanPage1] = await Promise.all([
          getJikanAnime(parsedId.externalId),
          getJikanAnimeEpisodesPage(
            parsedId.externalId,
            FIRST_EPISODE_PAGE
          ).catch(() => ({
            episodes: [] as NormalizedEpisode[],
            hasNextPage: false,
          })),
        ]);
        if (isCancelled) return;
        const jikanEpisodes = jikanPage1.episodes;

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

        if (
          shouldRefreshFullAnimeEpisodes(
            jikanPage1.hasNextPage,
            resolvedShow.totalEpisodes,
            jikanEpisodes
          )
        ) {
          void getJikanAnimeEpisodes(
            parsedId.externalId,
            FULL_JIKAN_EPISODE_PAGE_BUDGET
          )
            .then((fullEpisodes) => {
              if (isCancelled || fullEpisodes.length === 0) {
                return;
              }

              setSeasons(
                createAnimeSeason(
                  resolvedShow.totalEpisodes,
                  fullEpisodes,
                  resolvedShow.backdropUrl ?? resolvedShow.posterUrl
                )
              );
            })
            .catch((episodeError) => {
              if (!isCancelled) {
                console.warn("Could not refresh full Jikan episodes for MAL anime", episodeError);
              }
            });
        }
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

  useEffect(() => {
    if (!isAuthenticated || !trackingLoaded || !isInWatchlist || showLookupArgs === "skip") {
      return;
    }

    const refreshKey = JSON.stringify(showLookupArgs);
    if (metadataRefreshKeyRef.current === refreshKey) {
      return;
    }

    metadataRefreshKeyRef.current = refreshKey;
    void refreshTrackedShowMetadata(showLookupArgs).catch((refreshError) => {
      console.warn("Background tracked show metadata refresh failed", refreshError);
      metadataRefreshKeyRef.current = null;
    });
  }, [
    isAuthenticated,
    isInWatchlist,
    refreshTrackedShowMetadata,
    showLookupArgs,
    trackingLoaded,
  ]);

  const handleRemoveFromWatchlist = async () => {
    if (!show) return false;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return false;
    }
    if (!trackingLoaded) {
      setTrackingError("Tracking is still loading. Please try again.");
      return false;
    }
    if (!isInWatchlist) {
      return true;
    }
    if (isRemovingFromWatchlist || isSettingStatus) {
      return false;
    }

    setIsRemovingFromWatchlist(true);
    setTrackingError(null);
    try {
      await removeFromWatchlist({
        show: buildShowPayload(show),
      });
      resetLocalTrackingProgress();
      return true;
    } catch (mutationError) {
      console.error("Failed to remove show from watchlist", mutationError);
      setTrackingError("Could not remove this show from watchlist.");
      return false;
    } finally {
      setIsRemovingFromWatchlist(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (!trackingLoaded) {
      setTrackingError("Tracking is still loading. Please try again.");
      return;
    }
    if (isTogglingFavorite) {
      return;
    }

    const nextFavoriteState = !(tracking?.isFavorite ?? false);

    setIsTogglingFavorite(true);
    setTrackingError(null);
    try {
      await setFavoriteStatus({
        show: buildShowPayload(show),
        isFavorite: nextFavoriteState,
      });
    } catch (mutationError) {
      console.error("Failed to update favorite status", mutationError);
      setTrackingError("Could not update favorite status.");
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  const handleRepairTracking = async () => {
    if (!show) return;
    if (!canTrackShow || showLookupArgs === "skip") {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (!trackingLoaded) {
      setTrackingError("Tracking is still loading. Please try again.");
      return;
    }
    if (!isInWatchlist) {
      setTrackingError("Track this title before refreshing tracking.");
      return;
    }
    if (isRepairingTracking) {
      return;
    }

    setIsRepairingTracking(true);
    setTrackingError(null);
    setTrackingNotice(null);

    try {
      const result = await repairTrackingForShow(showLookupArgs);
      if (result.reason === "not_tracked") {
        setTrackingError("Track this title before refreshing tracking.");
        return;
      }
      if (result.reason !== "ok") {
        setTrackingError("Could not refresh tracking for this title.");
        return;
      }

      setTrackingNotice("Tracking refreshed.");
    } catch (mutationError) {
      console.error("Failed to repair tracking for show", mutationError);
      setTrackingError("Could not refresh tracking for this title.");
    } finally {
      setIsRepairingTracking(false);
    }
  };

  const handleSetTrackingStatus = async (nextStatus: ShowTrackingStatus) => {
    if (!show) return false;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return false;
    }
    if (!trackingLoaded) {
      setTrackingError("Tracking is still loading. Please try again.");
      return false;
    }
    if (isSettingStatus || isRemovingFromWatchlist) {
      return false;
    }
    if (isInWatchlist && tracking?.status === nextStatus) {
      return true;
    }

    const payload = buildShowPayload(show);

    setIsSettingStatus(true);
    setTrackingError(null);
    try {
      if (!isInWatchlist && show.mediaType === "anime") {
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

  const handleOpenAddToWatchlistPrompt = () => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }
    if (!trackingLoaded) {
      setTrackingError("Tracking is still loading. Please try again.");
      return;
    }
    if (isInWatchlist) {
      return;
    }
    if (isRemovingFromWatchlist || isSettingStatus) {
      return;
    }

    setTrackingError(null);
    setIsStatusMenuVisible(true);
  };

  const confirmRemoveFromLibrary = () => {
    const message =
      watchedEpisodesCount > 0 || tracking?.status
        ? "This removes tracking status and watched episode progress for this title. Favorites and custom lists are unchanged."
        : "This removes the title from your tracked library. Favorites and custom lists are unchanged.";

    if (Platform.OS === "web") {
      return new Promise<boolean>((resolve) => {
        removeLibraryPromptResolveRef.current = resolve;
        setRemoveLibraryPrompt({ message });
      });
    }

    return new Promise<boolean>((resolve) => {
      Alert.alert("Remove from Library?", message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => resolve(true),
        },
      ]);
    });
  };

  const handleResolveRemoveLibraryPrompt = (didConfirm: boolean) => {
    removeLibraryPromptResolveRef.current?.(didConfirm);
    removeLibraryPromptResolveRef.current = null;
    setRemoveLibraryPrompt(null);
  };

  const handleToggleLibrary = async () => {
    if (isInWatchlist) {
      const didConfirm = await confirmRemoveFromLibrary();
      if (!didConfirm) {
        return;
      }
      void handleRemoveFromWatchlist();
      return;
    }

    handleOpenAddToWatchlistPrompt();
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
          // Also update seasonWatchedKeys to remove the unwatched episode
          const seasonNum = episode.seasonNumber;
          setSeasonWatchedKeys((prev) => {
            const seasonKeys = prev[seasonNum];
            if (!seasonKeys) return prev;
            const newSeasonKeys = new Set(seasonKeys);
            newSeasonKeys.delete(key);
            return { ...prev, [seasonNum]: newSeasonKeys };
          });
          // Update tracking status if unwatching causes status to drop from completed
          if (
            activeTrackingStatus === "completed" &&
            show?.totalEpisodes &&
            totalWatchedEpisodesCount - 1 < show.totalEpisodes
          ) {
            setOptimisticTrackingStatus("watching");
          }
        } else {
          setEpisodeWatchCounts((prev) => ({
            ...prev,
            [key]: 1,
          }));
          // Also update seasonWatchedKeys to add the watched episode
          const seasonNum = episode.seasonNumber;
          setSeasonWatchedKeys((prev) => {
            const seasonKeys = prev[seasonNum] ?? new Set<string>();
            const newSeasonKeys = new Set(seasonKeys);
            newSeasonKeys.add(key);
            return { ...prev, [seasonNum]: newSeasonKeys };
          });
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

  const markEpisodesWatchedBatch = async (
    episodes: NormalizedEpisode[],
    options?: {
      completedSeasonNumber?: number;
      completedSeasonName?: string;
      shouldPromptNextSeason?: boolean;
    }
  ) => {
    if (!show || !canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return false;
    }

    const uniqueEpisodes = Array.from(
      new Map(
        episodes.map((entry) => [`${entry.seasonNumber}:${entry.episodeNumber}`, entry])
      ).values()
    );
    if (!uniqueEpisodes.length) {
      return true;
    }

    const episodeKeys = uniqueEpisodes.map(
      (entry) => `${entry.seasonNumber}:${entry.episodeNumber}`
    );
    const seasonNumbers = Array.from(
      new Set(uniqueEpisodes.map((entry) => entry.seasonNumber))
    );
    setTrackingError(null);
    setPendingOverrides((prev) => {
      const next = { ...prev };
      for (const key of episodeKeys) {
        next[key] = true;
      }
      return next;
    });
    setPendingEpisodeKeys((prev) => {
      const next = { ...prev };
      for (const key of episodeKeys) {
        next[key] = true;
      }
      return next;
    });
    setSeasonActionLoading((prev) => {
      const next = { ...prev };
      for (const seasonNumber of seasonNumbers) {
        next[seasonNumber] = true;
      }
      return next;
    });

    try {
      const result = await batchMarkEpisodesWatched({
        show: buildShowPayload(show),
        episodes: uniqueEpisodes.map((entry) => ({
          season: entry.seasonNumber,
          episode: entry.episodeNumber,
          runtime: entry.runtime,
        })),
      });

      setEpisodeWatchCounts((prev) => {
        const next = { ...prev };
        for (const key of episodeKeys) {
          next[key] = next[key] ?? 1;
        }
        return next;
      });
      setSeasonWatchedKeys((prev) => {
        const next = { ...prev };
        for (const entry of uniqueEpisodes) {
          const seasonKeys = next[entry.seasonNumber] ?? new Set<string>();
          const updatedSeasonKeys = new Set(seasonKeys);
          updatedSeasonKeys.add(`${entry.seasonNumber}:${entry.episodeNumber}`);
          next[entry.seasonNumber] = updatedSeasonKeys;
        }
        return next;
      });

      if (isTrackingStatus(result.status)) {
        setOptimisticTrackingStatus(result.status);
      }

      if (
        options?.shouldPromptNextSeason &&
        typeof options.completedSeasonNumber === "number"
      ) {
        void maybePromptMoveToNextSeason(
          options.completedSeasonNumber,
          options.completedSeasonName
        );
      }

      return true;
    } catch (mutationError) {
      console.error("Failed to mark episodes watched", mutationError);
      setPendingOverrides((prev) => {
        const next = { ...prev };
        for (const key of episodeKeys) {
          delete next[key];
        }
        return next;
      });
      setTrackingError("Could not update episode status.");
      return false;
    } finally {
      setPendingEpisodeKeys((prev) => {
        const next = { ...prev };
        for (const key of episodeKeys) {
          next[key] = false;
        }
        return next;
      });
      setSeasonActionLoading((prev) => {
        const next = { ...prev };
        for (const seasonNumber of seasonNumbers) {
          next[seasonNumber] = false;
        }
        return next;
      });
    }
  };

  const getPreviousUnwatchedEpisodes = useCallback(
    async (targetEpisode: NormalizedEpisode) => {
      const priorEpisodes: NormalizedEpisode[] = [];
      const knownWatchedKeys = new Set(watchedEpisodeKeys);
      const relevantSeasons = seasons
        .filter((season) => season.seasonNumber <= targetEpisode.seasonNumber)
        .sort((a, b) => a.seasonNumber - b.seasonNumber);

      for (const season of relevantSeasons) {
        let seasonKeys = seasonWatchedKeysRef.current[season.seasonNumber];
        if (
          !seasonKeys &&
          trackingArgs !== "skip" &&
          getWatchedEpisodesForSeasonAction &&
          isInWatchlist
        ) {
          const loadedKeys = await getWatchedEpisodesForSeasonAction({
            ...trackingArgs,
            season: season.seasonNumber,
          });
          seasonKeys = new Set(loadedKeys);
          setSeasonWatchedKeys((prev) => {
            if (prev[season.seasonNumber]) {
              return prev;
            }

            return {
              ...prev,
              [season.seasonNumber]: seasonKeys,
            };
          });
        }

        if (seasonKeys) {
          for (const key of seasonKeys) {
            knownWatchedKeys.add(key);
          }
        }

        for (const [key, isWatched] of Object.entries(pendingOverrides)) {
          if (isWatched) {
            knownWatchedKeys.add(key);
          } else {
            knownWatchedKeys.delete(key);
          }
        }

        if (
          season.seasonNumber < targetEpisode.seasonNumber &&
          typeof season.episodeCount === "number" &&
          season.episodeCount > 0 &&
          countWatchedEpisodesForSeason(season.seasonNumber, knownWatchedKeys) >= season.episodeCount
        ) {
          continue;
        }

        const seasonEpisodes =
          season.seasonNumber === targetEpisode.seasonNumber && season.episodes?.length
            ? season.episodes
            : await resolveSeasonEpisodes(season);
        if (!seasonEpisodes?.length) {
          continue;
        }

        for (const episode of seasonEpisodes) {
          if (!isEpisodeReleased(episode.airDate)) {
            continue;
          }

          const isEarlierSeason = season.seasonNumber < targetEpisode.seasonNumber;
          const isEarlierEpisode =
            season.seasonNumber === targetEpisode.seasonNumber &&
            episode.episodeNumber < targetEpisode.episodeNumber;

          if (!isEarlierSeason && !isEarlierEpisode) {
            continue;
          }

          const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
          if (!knownWatchedKeys.has(key)) {
            priorEpisodes.push(episode);
          }
        }
      }

      return priorEpisodes;
    },
    [
      getWatchedEpisodesForSeasonAction,
      isInWatchlist,
      pendingOverrides,
      resolveSeasonEpisodes,
      seasons,
      trackingArgs,
      watchedEpisodeKeys,
    ]
  );

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

    const missingPreviousEpisodes = await getPreviousUnwatchedEpisodes(episode);
    if (missingPreviousEpisodes.length > 0) {
      const seasonJustCompletedWithBackfill =
        releasedEpisodes.length > 0 &&
        releasedEpisodes.every((entry) => {
          const episodeKey = `${entry.seasonNumber}:${entry.episodeNumber}`;
          return (
            watchedEpisodeKeys.has(episodeKey) ||
            episodeKey === key ||
            missingPreviousEpisodes.some(
              (candidate) =>
                candidate.seasonNumber === entry.seasonNumber &&
                candidate.episodeNumber === entry.episodeNumber
            )
          );
        });

      setPreviousEpisodesPrompt({
        episode,
        missingEpisodes: missingPreviousEpisodes,
        completedSeasonName: seasonEntry?.name ?? `Season ${episode.seasonNumber}`,
        shouldPromptNextSeason: seasonJustCompletedWithBackfill,
      });
      return;
    }

    try {
      const seasonJustCompleted =
        releasedEpisodes.length > 0 &&
        watchedBefore < releasedEpisodes.length &&
        watchedBefore + 1 >= releasedEpisodes.length;
      await markEpisodesWatchedBatch([episode], {
        completedSeasonNumber: episode.seasonNumber,
        completedSeasonName: seasonEntry?.name ?? `Season ${episode.seasonNumber}`,
        shouldPromptNextSeason: seasonJustCompleted,
      });

    } catch {
      // Error already handled in markEpisodesWatchedBatch.
    }
  };

  const handlePreviousEpisodesPromptChoice = async (choice: "current" | "all") => {
    if (!previousEpisodesPrompt || isPreviousEpisodesPromptRunning) {
      return;
    }

    setIsPreviousEpisodesPromptRunning(true);
    const releasedEpisodesForSeason = getReleasedEpisodesForSeason(
      previousEpisodesPrompt.episode.seasonNumber
    );
    const watchedReleasedEpisodesCount = releasedEpisodesForSeason.filter((entry) =>
      watchedEpisodeKeys.has(`${entry.seasonNumber}:${entry.episodeNumber}`)
    ).length;
    const currentChoiceCompletesSeason =
      releasedEpisodesForSeason.length > 0 &&
      watchedReleasedEpisodesCount < releasedEpisodesForSeason.length &&
      watchedReleasedEpisodesCount + 1 >= releasedEpisodesForSeason.length;
    const episodesToMark =
      choice === "all"
        ? [...previousEpisodesPrompt.missingEpisodes, previousEpisodesPrompt.episode]
        : [previousEpisodesPrompt.episode];

    try {
      const didSucceed = await markEpisodesWatchedBatch(episodesToMark, {
        completedSeasonNumber: previousEpisodesPrompt.episode.seasonNumber,
        completedSeasonName: previousEpisodesPrompt.completedSeasonName,
        shouldPromptNextSeason:
          choice === "all"
            ? previousEpisodesPrompt.shouldPromptNextSeason
            : currentChoiceCompletesSeason,
      });

      if (didSucceed) {
        setPreviousEpisodesPrompt(null);
      }
    } finally {
      setIsPreviousEpisodesPromptRunning(false);
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

    const seasonWatchedCount = getSeasonWatchedCount(season.seasonNumber);
    const isSeasonFullyWatched = seasonWatchedCount >= releasedEpisodes.length;

    if (isSeasonFullyWatched) {
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

      // Update seasonWatchedKeys to add all watched episodes
      setSeasonWatchedKeys((prev) => {
        const seasonKeys = prev[season.seasonNumber] ?? new Set<string>();
        const newSeasonKeys = new Set(seasonKeys);
        for (const k of episodeKeys) {
          newSeasonKeys.add(k);
        }
        return { ...prev, [season.seasonNumber]: newSeasonKeys };
      });

      void maybePromptMoveToNextSeason(
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
    const allEpisodeKeys: string[] = [];

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
      for (const payload of seasonPayloads) {
        for (const episode of payload.episodes) {
          allEpisodeKeys.push(`${episode.seasonNumber}:${episode.episodeNumber}`);
        }
      }

      const releasedEpisodeCount = allEpisodeKeys.length;
      const watchedCountInPayloads = seasonPayloads.reduce(
        (sum, payload) =>
          sum + Math.min(getSeasonWatchedCount(payload.seasonNumber), payload.episodes.length),
        0
      );
      const showActionEpisodeCount = totalEpisodesCount ?? releasedEpisodeCount;
      const isFullyWatched =
        showActionEpisodeCount > 0
          ? totalWatchedEpisodesCount >= showActionEpisodeCount
          : watchedCountInPayloads >= releasedEpisodeCount;

      if (isFullyWatched) {
        setWatchActionTarget({
          kind: "show",
          title: show.title,
          subtitle: `${releasedEpisodeCount} released episodes`,
          releasedEpisodes: seasonPayloads.flatMap((payload) => payload.episodes),
        });
        return;
      }

      setSeasonActionLoading((prev) => {
        const next = { ...prev };
        for (const payload of seasonPayloads) {
          next[payload.seasonNumber] = true;
        }
        return next;
      });

      // Apply optimistic override using the previously collected keys.
      setPendingOverrides((prev) => {
        const next = { ...prev };
        for (const k of allEpisodeKeys) {
          next[k] = true;
        }
        return next;
      });

      const result = await batchMarkEpisodesWatched({
        show: buildShowPayload(show),
        episodes: seasonPayloads.flatMap((payload) =>
          payload.episodes.map((episode) => ({
            season: episode.seasonNumber,
            episode: episode.episodeNumber,
            runtime: episode.runtime,
          }))
        ),
      });

      setSeasonWatchedKeys((prev) => {
        const next = { ...prev };
        for (const payload of seasonPayloads) {
          const seasonKeys = prev[payload.seasonNumber] ?? new Set<string>();
          const newSeasonKeys = new Set(seasonKeys);
          for (const episode of payload.episodes) {
            const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
            newSeasonKeys.add(key);
          }
          next[payload.seasonNumber] = newSeasonKeys;
        }
        return next;
      });

      if (isTrackingStatus(result.status)) {
        setOptimisticTrackingStatus(result.status);
      } else {
        const changedEpisodeCount = Math.max(releasedEpisodeCount - watchedCountInPayloads, 0);
        const nextWatchedCount = totalWatchedEpisodesCount + changedEpisodeCount;
        setOptimisticTrackingStatus(
          shouldAutoCompleteShow(show, nextWatchedCount) ? "completed" : "watching"
        );
      }

      if (show.mediaType === "anime") {
        const firstPayload = seasonPayloads[0];
        if (firstPayload) {
          const season = seasons.find(
            (entry) => entry.seasonNumber === firstPayload.seasonNumber
          );
          void maybePromptMoveToNextSeason(
            firstPayload.seasonNumber,
            season?.name || `Season ${firstPayload.seasonNumber}`
          );
        }
      }
    } catch (mutationError) {
      console.error("Failed to mark show watched", mutationError);
      if (allEpisodeKeys.length > 0) {
        setPendingOverrides((prev) => {
          const next = { ...prev };
          for (const k of allEpisodeKeys) {
            delete next[k];
          }
          return next;
        });
      }
      setTrackingError("Could not update show status.");
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

  const handleEpisodeSwipeAction = async (
    episode: NormalizedEpisode,
    action: "watch" | "unwatch" | "rewatch"
  ) => {
    if (action === "watch") {
      await handleToggleEpisodeWatched(episode);
      return;
    }

    if (action === "rewatch") {
      await handleRewatchEpisode(episode);
      return;
    }

    await runEpisodeToggle(episode, "toggle");
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
      // Also update seasonWatchedKeys to remove all unwatched episodes
      setSeasonWatchedKeys((prev) => {
        const seasonKeys = prev[season.seasonNumber];
        if (!seasonKeys) return prev;
        const newSeasonKeys = new Set(seasonKeys);
        for (const key of episodeKeys) {
          newSeasonKeys.delete(key);
        }
        return { ...prev, [season.seasonNumber]: newSeasonKeys };
      });
      // Update tracking status if unwatching causes status to drop from completed
      if (
        activeTrackingStatus === "completed" &&
        show?.totalEpisodes
      ) {
        const remainingKeys = watchedEpisodeKeys.size - episodeKeys.length;
        if (remainingKeys < show.totalEpisodes) {
          setOptimisticTrackingStatus("watching");
        }
      }
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

  const handleWatchActionChoice = async (
    choice: "rewatch" | "not_watched" | "not_watched_related"
  ) => {
    if (!watchActionTarget || isWatchActionRunning) return;
    if (choice === "not_watched_related" && watchActionTarget.kind !== "show") {
      setTrackingError("Could not update watch status. Please try again.");
      setWatchActionTarget(null);
      setIsWatchActionRunning(false);
      return;
    }

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
            if (
              choice === "not_watched_related" &&
              show.mediaType === "anime" &&
              showLookupArgs !== "skip"
            ) {
              await clearRelatedAnimeWatched({
                show: showLookupArgs,
              });
            } else {
              await clearShowWatched({
                show: buildShowPayload(show),
              });
            }
            // Also update seasonWatchedKeys for all seasons
            setSeasonWatchedKeys((prev) => {
              const next: Record<number, Set<string>> = {};
              for (const [seasonNum, seasonKeys] of Object.entries(prev)) {
                const newSeasonKeys = new Set(seasonKeys);
                for (const episode of watchActionTarget.releasedEpisodes) {
                  if (episode.seasonNumber === Number(seasonNum)) {
                    newSeasonKeys.delete(`${episode.seasonNumber}:${episode.episodeNumber}`);
                  }
                }
                next[Number(seasonNum)] = newSeasonKeys;
              }
              return next;
            });
            // Clear all episodes - status becomes plan_to_watch
            setOptimisticTrackingStatus("plan_to_watch");
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

  const handlePauseOtherRelatedSeasons = async () => {
    if (
      !show ||
      show.mediaType !== "anime" ||
      showLookupArgs === "skip" ||
      !nextMainlineRelatedEntry ||
      isPausingRelatedEntries
    ) {
      return;
    }

    const keepNext = {
      anilistId: nextMainlineRelatedEntry.anilistId ?? undefined,
      malId: nextMainlineRelatedEntry.malId ?? undefined,
      mediaType: "anime" as const,
    };

    setIsPausingRelatedEntries(true);
    setTrackingError(null);

    try {
      await pauseOtherRelatedAnimeEntries({
        show: showLookupArgs,
        keepNext,
      });
      setNextSeasonPrompt(null);
    } catch (pauseError) {
      console.error("Failed to pause other related anime entries", pauseError);
      setTrackingError("Could not pause other franchise titles.");
    } finally {
      setIsPausingRelatedEntries(false);
    }
  };

  const handleSetFranchiseRelationMode = async (
    relationMode: "inherit" | AnimeHomeRelationMode
  ) => {
    if (
      !show ||
      show.mediaType !== "anime" ||
      typeof relationRootAnilistId !== "number" ||
      isUpdatingAnimeSettings
    ) {
      return;
    }

    setIsUpdatingAnimeSettings(true);
    const localOpId = animeSettingsOpIdRef.current + 1;
    animeSettingsOpIdRef.current = localOpId;
    setTrackingError(null);

    try {
      await setAnimeFranchiseRelationMode({
        relationRootAnilistId,
        relationMode,
      });
      const effectiveMode =
        relationMode === "inherit" ? globalAnimeRelationMode : relationMode;

      void (async () => {
        try {
          await syncAnimeRelationsForRoot({ relationRootAnilistId, force: true });
          if (localOpId !== animeSettingsOpIdRef.current) {
            return;
          }
          if (effectiveMode !== "all_relations") {
            await pruneAnimeFranchiseToCoreRelations({ relationRootAnilistId });
          }
        } catch (error) {
          console.error("Failed background relation sync after franchise update", error);
          if (localOpId === animeSettingsOpIdRef.current) {
            setTrackingError("Could not sync franchise relations.");
          }
        } finally {
          if (localOpId === animeSettingsOpIdRef.current) {
            setIsUpdatingAnimeSettings(false);
          }
        }
      })();
    } catch (error) {
      console.error("Failed to update franchise relation mode", error);
      setTrackingError("Could not update this franchise preference.");
      if (localOpId === animeSettingsOpIdRef.current) {
        setIsUpdatingAnimeSettings(false);
      }
    }
  };

  const handleRefreshRelatedAnime = async () => {
    if (
      !show ||
      show.mediaType !== "anime" ||
      typeof relationRootAnilistId !== "number" ||
      isSyncingRelatedAnime
    ) {
      return;
    }

    setIsSyncingRelatedAnime(true);
    setTrackingError(null);
    setTrackingNotice(null);

    try {
      await syncAnimeRelationsForRoot({ relationRootAnilistId, force: true });
      relationAutoSyncKeyRef.current = null;
      setTrackingNotice("Related anime refreshed.");
    } catch (error) {
      console.error("Failed to refresh related anime", error);
      setTrackingError("Could not refresh related anime.");
    } finally {
      setIsSyncingRelatedAnime(false);
    }
  };

  // Stats
  const watchedEpisodesCount = totalWatchedEpisodesCount;
  const totalEpisodesCount = useMemo(() => {
    if (show?.totalEpisodes) return show.totalEpisodes;
    const inferred = seasons.reduce((sum, season) => {
      return sum + (season.episodeCount ?? season.episodes?.length ?? 0);
    }, 0);
    return inferred > 0 ? inferred : null;
  }, [seasons, show?.totalEpisodes]);

  const clampedWatchedEpisodesCount =
    totalEpisodesCount !== null
      ? Math.min(watchedEpisodesCount, totalEpisodesCount)
      : watchedEpisodesCount;

  const watchProgressRatio = totalEpisodesCount
    ? Math.min(1, clampedWatchedEpisodesCount / totalEpisodesCount)
    : 0;
  const watchProgressPercent =
    totalEpisodesCount && clampedWatchedEpisodesCount >= totalEpisodesCount
      ? 100
      : Math.floor(watchProgressRatio * 100);

  const releasedEpisodeCountForShowAction = useMemo(() => {
    let count = 0;

    for (const season of seasons) {
      const episodes = season.episodes ?? [];
      if (episodes.length === 0) {
        continue;
      }

      count += episodes.filter((episode) => isEpisodeReleased(episode.airDate)).length;
    }

    return count > 0 ? count : null;
  }, [seasons]);

  const showActionEpisodeCount =
    totalEpisodesCount ?? releasedEpisodeCountForShowAction;
  const isShowFullyWatched =
    showActionEpisodeCount !== null &&
    totalWatchedEpisodesCount >= showActionEpisodeCount;

  const isFavorite = tracking?.isFavorite ?? false;
  const isWatchlistActionPending =
    isSettingStatus || (isRemovingFromWatchlist && (trackingLoaded ? isInWatchlist : true));
  const isStatusMenuBusy =
    !trackingLoaded ||
    isSettingStatus ||
    isWatchlistActionPending ||
    isTogglingFavorite ||
    isRepairingTracking;
  const showMediaType = show?.mediaType;
  const isFirstSavePrompt =
    trackingLoaded && !isInWatchlist && showMediaType != null && showMediaType !== "movie";
  const statusMenuOptions = isFirstSavePrompt
    ? trackingStatusOptions.filter(
        (option) => option.value === "watching" || option.value === "plan_to_watch"
      )
    : trackingStatusOptions;
  const activeTrackingOption =
    trackingStatusOptions.find((option) => option.value === activeTrackingStatusForMenu) ??
    trackingStatusOptions.find((option) => option.value === "plan_to_watch") ??
    trackingStatusOptions[0];
  const canMarkShowWatchedFromActionBar =
    show?.mediaType !== "movie" && seasons.length > 0 && !isShowFullyWatched;
  const globalFranchiseModeLabel =
    globalAnimeRelationMode === "all_relations"
      ? "All franchise titles"
      : "Core franchise titles";
  const effectiveFranchiseModeLabel =
    effectiveAnimeRelationMode === "all_relations"
      ? "All franchise titles"
      : "Core franchise titles";
  const franchiseOverrideLabel =
    franchiseAnimeRelationMode === null
      ? `Inherit global (${globalFranchiseModeLabel})`
      : franchiseAnimeRelationMode === "all_relations"
        ? "All franchise titles"
        : "Core franchise titles";
  const canClearRelatedAnimeWatched =
    show?.mediaType === "anime" && relatedAnime.some((entry) => entry.isInWatchlist);

  const loadedRailEpisodes = useMemo(() => {
    return seasons
      .flatMap((season) => season.episodes ?? [])
      .sort(sortEpisodesByPosition);
  }, [seasons]);

  const railLoadedSeasonNumbers = useMemo(() => {
    return Array.from(
      new Set(loadedRailEpisodes.map((episode) => episode.seasonNumber))
    );
  }, [loadedRailEpisodes]);

  const railWatchedKeysReady = useMemo(() => {
    if (!show || show.mediaType === "movie" || !canTrackShow || !isInWatchlist) {
      return true;
    }

    return railLoadedSeasonNumbers.every(
      (seasonNumber) =>
        seasonWatchedKeys[seasonNumber] !== undefined ||
        seasonWatchedKeyErrors[seasonNumber] !== undefined
    );
  }, [
    canTrackShow,
    isInWatchlist,
    railLoadedSeasonNumbers,
    seasonWatchedKeyErrors,
    seasonWatchedKeys,
    show,
  ]);

  useEffect(() => {
    if (railWatchedKeysReady && loadedRailEpisodes.length > 0) {
      setHasRailInitialized(true);
    }
  }, [loadedRailEpisodes.length, railWatchedKeysReady]);

  const railAnchorMeta = useMemo(() => {
    let latestWatchedIndex = -1;
    let firstUnwatchedIndex = -1;
    let firstReleasedUnwatchedIndex = -1;

    for (let index = 0; index < loadedRailEpisodes.length; index += 1) {
      const episode = loadedRailEpisodes[index];
      const key = getEpisodePositionKey(episode);

      if (watchedEpisodeKeys.has(key)) {
        latestWatchedIndex = index;
        continue;
      }

      if (firstUnwatchedIndex < 0) {
        firstUnwatchedIndex = index;
      }
      if (firstReleasedUnwatchedIndex < 0 && isEpisodeReleased(episode.airDate)) {
        firstReleasedUnwatchedIndex = index;
      }
    }

    let nextEpisodeIndex = firstReleasedUnwatchedIndex >= 0
      ? firstReleasedUnwatchedIndex
      : firstUnwatchedIndex;
    if (nextEpisodeIndex < 0) {
      nextEpisodeIndex = latestWatchedIndex >= 0 ? latestWatchedIndex + 1 : 0;
    }

    const initialScrollIndex = Math.max(0, nextEpisodeIndex - 2);
    return {
      latestWatchedIndex,
      nextEpisodeIndex,
      initialScrollIndex,
    };
  }, [loadedRailEpisodes, watchedEpisodeKeys]);

  const railLoadedSeasonRange = useMemo(() => {
    if (loadedRailEpisodes.length === 0) {
      return { first: null as number | null, last: null as number | null };
    }

    return {
      first: loadedRailEpisodes[0]?.seasonNumber ?? null,
      last: loadedRailEpisodes[loadedRailEpisodes.length - 1]?.seasonNumber ?? null,
    };
  }, [loadedRailEpisodes]);

  const railAnchorEpisode = loadedRailEpisodes[railAnchorMeta.nextEpisodeIndex] ?? null;
  const hasRailWatchedKeyError = Object.keys(seasonWatchedKeyErrors).length > 0;
  const railAnchorEpisodeKey = railAnchorEpisode ? getEpisodePositionKey(railAnchorEpisode) : null;

  const getAdjacentRailSeason = useCallback(
    (direction: "previous" | "next") => {
      if (!show || show.mediaType !== "tv" || parsedId?.source !== "tmdb") {
        return null;
      }

      const sortedSeasons = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
      if (direction === "previous") {
        const firstLoadedSeason = railLoadedSeasonRange.first;
        if (firstLoadedSeason === null) return null;
        return (
          [...sortedSeasons]
            .reverse()
            .find(
              (season) =>
                season.seasonNumber < firstLoadedSeason && !season.episodes?.length
            ) ?? null
        );
      }

      const lastLoadedSeason = railLoadedSeasonRange.last;
      if (lastLoadedSeason === null) return null;
      return (
        sortedSeasons.find(
          (season) => season.seasonNumber > lastLoadedSeason && !season.episodes?.length
        ) ?? null
      );
    },
    [parsedId?.source, railLoadedSeasonRange.first, railLoadedSeasonRange.last, seasons, show]
  );

  const loadAdjacentRailSeason = useCallback(
    async (direction: "previous" | "next") => {
      const season = getAdjacentRailSeason(direction);
      if (!season) return;
      const inFlightKey = getRailSeasonLoadKey(season.seasonNumber, direction);
      if (inFlightSeasonsRef.current.has(inFlightKey)) {
        return;
      }

      inFlightSeasonsRef.current.add(inFlightKey);
      setIsRailLoadingMore(true);
      try {
        await Promise.all([
          resolveSeasonEpisodes(season),
          loadWatchedKeysForSeason(season.seasonNumber),
        ]);
      } finally {
        inFlightSeasonsRef.current.delete(inFlightKey);
        setIsRailLoadingMore(false);
      }
    },
    [getAdjacentRailSeason, loadWatchedKeysForSeason, resolveSeasonEpisodes]
  );

  const canLoadPreviousRail = getAdjacentRailSeason("previous") !== null;
  const canLoadNextRail = getAdjacentRailSeason("next") !== null;

  const continueTrackingRailItems = useMemo<ContinueTrackingRailItem[]>(() => {
    if (!show || show.mediaType === "movie" || !canTrackShow) {
      return [];
    }

    const items: ContinueTrackingRailItem[] = [];
    if (loadedRailEpisodes.length === 0) {
      return items;
    }

    const addEpisodeItem = (episode: NormalizedEpisode) => {
      const key = getEpisodePositionKey(episode);
      items.push({
        kind: "episode",
        episode,
        watched: watchedEpisodeKeys.has(key),
        isUpdating:
          (pendingEpisodeKeys[key] || false) ||
          seasonWatchedKeyErrors[episode.seasonNumber] !== undefined,
        watchCount: episodeWatchCounts[key],
        availability: getEpisodeAvailabilityLabel(episode.airDate),
      });
    };

    for (const episode of loadedRailEpisodes) {
      addEpisodeItem(episode);
    }

    const hasLoadedReleasedUnwatchedEpisode = loadedRailEpisodes.some((episode) => {
      const key = getEpisodePositionKey(episode);
      return !watchedEpisodeKeys.has(key) && isEpisodeReleased(episode.airDate);
    });
    const canShowCaughtUp =
      railAnchorMeta.latestWatchedIndex >= 0 &&
      !hasLoadedReleasedUnwatchedEpisode &&
      !canLoadNextRail &&
      !hasRailWatchedKeyError;

    if (canShowCaughtUp) {
      const line = getCaughtUpLine(show.id);
      items.push({
        kind: "caught-up",
        text: line.text,
        credit: line.credit,
        progressLabel: totalEpisodesCount
          ? `${Math.min(totalWatchedEpisodesCount, totalEpisodesCount)}/${totalEpisodesCount} episodes`
          : `${totalWatchedEpisodesCount} episodes watched`,
      });
    }

    return items;
  }, [
    canLoadNextRail,
    canTrackShow,
    episodeWatchCounts,
    hasRailWatchedKeyError,
    loadedRailEpisodes,
    pendingEpisodeKeys,
    railAnchorMeta.latestWatchedIndex,
    show,
    seasonWatchedKeyErrors,
    totalEpisodesCount,
    totalWatchedEpisodesCount,
    watchedEpisodeKeys,
  ]);

  useEffect(() => {
    if (!railWatchedKeysReady || !railAnchorEpisode || show?.mediaType !== "tv") {
      return;
    }

    const prefetchKey = `${show.id}:${railLoadedSeasonRange.first ?? "none"}:${railLoadedSeasonRange.last ?? "none"}`;
    if (railAutoPrefetchKeyRef.current === prefetchKey) {
      return;
    }
    railAutoPrefetchKeyRef.current = prefetchKey;

    const anchorSeason = seasons.find(
      (season) => season.seasonNumber === railAnchorEpisode.seasonNumber
    );
    const anchorSeasonEpisodes = anchorSeason?.episodes ?? [];
    if (anchorSeasonEpisodes.length === 0) {
      return;
    }

    const anchorIndexInSeason = anchorSeasonEpisodes.findIndex(
      (episode) =>
        episode.seasonNumber === railAnchorEpisode.seasonNumber &&
        episode.episodeNumber === railAnchorEpisode.episodeNumber
    );
    if (anchorIndexInSeason < 0) {
      return;
    }

    if (anchorIndexInSeason <= 1 && canLoadPreviousRail) {
      if (railLoadedSeasonRange.first !== null && railLoadedSeasonRange.first >= railAnchorEpisode.seasonNumber) {
        void loadAdjacentRailSeason("previous");
      }
    }
    if (anchorSeasonEpisodes.length - anchorIndexInSeason <= 2 && canLoadNextRail) {
      if (railLoadedSeasonRange.last !== null && railLoadedSeasonRange.last <= railAnchorEpisode.seasonNumber) {
        void loadAdjacentRailSeason("next");
      }
    }
  }, [
    canLoadNextRail,
    canLoadPreviousRail,
    loadAdjacentRailSeason,
    railAnchorEpisode,
    railAnchorEpisodeKey,
    railLoadedSeasonRange.first,
    railLoadedSeasonRange.last,
    railWatchedKeysReady,
    seasons,
    show?.id,
    show?.mediaType,
  ]);

  useEffect(() => {
    if (!show || show.mediaType === "movie" || !isInWatchlist) {
      return;
    }

    for (const season of seasons) {
      if (season.episodes?.length) {
        void loadWatchedKeysForSeason(season.seasonNumber);
      }
    }
  }, [isInWatchlist, loadWatchedKeysForSeason, seasons, show]);

  const cleanedShowTitle = cleanRichText(show?.title) || show?.title || "";
  const cleanedShowOverview =
    cleanRichText(show?.overview) || "No overview available yet.";
  const showPosterUrl = toHttpsImageUrl(show?.posterUrl);

  const detailScreenEdges: ComponentProps<typeof ScreenWrapper>["edges"] =
    isOverlayDetailRoute ? [] : ["top"];

  const wrapShowDetail = (content: ReactElement) => {
    if (!isOverlayDetailRoute) {
      return content;
    }

    return (
      <OverlayDetailFrame onClose={closeOverlayDetailRoute}>
        {content}
      </OverlayDetailFrame>
    );
  };

  if (isLoading) {
    return wrapShowDetail(
      <ScreenWrapper contentClassName="px-0 py-0" edges={detailScreenEdges}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#ef4444" />
          <Text className="mt-4 text-sm text-text-secondary">Loading show details...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (error) {
    return wrapShowDetail(
      <ScreenWrapper contentClassName="px-4 py-6" edges={detailScreenEdges}>
        <View className="rounded-xl border-2 border-primary/30 bg-primary/10 p-6">
          <Text className="text-lg font-semibold text-primary">Error</Text>
          <Text className="mt-2 text-sm text-text-secondary">{error}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (!show) {
    return wrapShowDetail(
      <ScreenWrapper contentClassName="px-4 py-6" edges={detailScreenEdges}>
        <View className="items-center py-12">
          <Text className="text-text-secondary">Show not found.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return wrapShowDetail(
    <ScreenWrapper contentClassName="px-0 py-0" edges={detailScreenEdges}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={true}
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
          showBackButton={!isOverlayDetailRoute || isDesktop}
          backButtonVariant={isOverlayDetailRoute ? "close" : "back"}
          backFallbackHref="/home"
          actionSlot={
            canTrackShow ? (
              <ShowActionBar
                statusLabel={
                  !trackingLoaded
                    ? "Loading"
                    : isInWatchlist
                      ? activeTrackingOption.label
                      : "Not Tracked"
                }
                isTracked={isInWatchlist}
                isFavorite={isFavorite}
                canAddToList
                isBusy={!canTrackShow || isStatusMenuBusy}
                isCompact={!isDesktop}
                isTogglingFavorite={isTogglingFavorite}
                isRepairingTracking={isRepairingTracking}
                onToggleWatchlist={() => {
                  void handleToggleLibrary();
                }}
                onToggleFavorite={() => {
                  void handleToggleFavorite();
                }}
                onEditStatus={() => setIsStatusMenuVisible(true)}
                onAddToList={() => setIsAddToListModalVisible(true)}
                onRepairTracking={() => {
                  void handleRepairTracking();
                }}
              />
            ) : null
          }
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
                    ? `${clampedWatchedEpisodesCount}/${totalEpisodesCount}`
                    : clampedWatchedEpisodesCount}{" "}
                  episodes
                </Text>
              </View>
              <ProgressBar progress={watchProgressRatio} height={8} animated />
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-xs text-text-muted">
                  {isInWatchlist
                    ? `Saved${tracking?.status ? ` · ${formatTrackingStatus(tracking.status)}` : ""}`
                    : trackingLoaded
                      ? "Add to watchlist to track your progress"
                      : "Loading tracking..."}
                </Text>
                <Text className="text-xs font-semibold text-text-secondary">
                  {watchProgressPercent}%
                </Text>
              </View>
            </View>
          )}

          {canTrackShow && (
            <>
              {show.mediaType === "anime" ? (
                <View className="mb-6 gap-2 rounded-lg border border-border-default/80 bg-bg-surface px-3 py-3">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                        Franchise
                      </Text>
                      <Text className="mt-1 text-xs text-text-secondary">
                        Home uses {effectiveFranchiseModeLabel.toLowerCase()} for this franchise.
                      </Text>
                      <Text className="mt-1 text-xs text-text-muted">
                        Override: {franchiseOverrideLabel}
                      </Text>
                      <Text className="mt-1 text-xs text-text-muted">
                        Global franchise and completion settings are in Profile Settings.
                      </Text>
                    </View>

                    {typeof relationRootAnilistId === "number" ? (
                      <Pressable
                        onPress={() => setIsFranchiseSettingsModalVisible(true)}
                        disabled={isUpdatingAnimeSettings}
                        accessibilityRole="button"
                        className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5"
                        style={({ pressed }) => ({
                          opacity: isUpdatingAnimeSettings ? 0.45 : pressed ? 0.85 : 1,
                        })}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons
                            name="ellipsis-horizontal-circle-outline"
                            size={14}
                            color="#a1a1aa"
                          />
                          <Text className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                            Franchise
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                  </View>

                  {isUpdatingAnimeSettings ? (
                    <View className="flex-row items-center gap-2">
                      <ActivityIndicator size="small" color="#52525b" />
                      <Text className="text-xs text-text-secondary">Updating franchise settings...</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {isSettingStatus ? (
                <View className="mb-6 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#52525b" />
                  <Text className="text-xs text-text-secondary">
                    Updating status...
                  </Text>
                </View>
              ) : null}

              {isRepairingTracking ? (
                <View className="mb-6 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#52525b" />
                  <Text className="text-xs text-text-secondary">
                    Refreshing tracking...
                  </Text>
                </View>
              ) : null}
            </>
          )}

          {trackingError && (
            <View className="mb-6 rounded-xl bg-primary/10 p-4">
              <Text className="text-sm text-primary">{trackingError}</Text>
            </View>
          )}

          {!trackingError && trackingNotice && (
            <View className="mb-6 rounded-xl bg-emerald-500/10 p-4">
              <Text className="text-sm text-emerald-600">{trackingNotice}</Text>
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
                <View className="flex-row items-center gap-2">
                  <View className="items-end gap-1.5">
                    <Text className="text-xs text-text-secondary">
                      {relatedAnime.length} linked
                    </Text>
                    {Platform.OS === "web" ? (
                      <View className="flex-row items-center gap-1.5 rounded-full border border-border-default bg-bg-elevated px-2.5 py-1">
                        <Ionicons name="swap-horizontal" size={12} color="#ef4444" />
                        <Text className="text-[10px] font-bold uppercase tracking-[1px] text-text-secondary">
                          Drag or shift-scroll
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {typeof relationRootAnilistId === "number" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Refresh related anime"
                      disabled={isSyncingRelatedAnime}
                      onPress={handleRefreshRelatedAnime}
                      className={`h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-bg-elevated ${
                        isSyncingRelatedAnime ? "opacity-60" : "active:bg-bg-muted"
                      }`}
                    >
                      {isSyncingRelatedAnime ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Ionicons name="refresh" size={17} color="#ef4444" />
                      )}
                    </Pressable>
                  ) : null}
                </View>
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
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ gap: 12, paddingRight: 4 }}
                  className="pb-2"
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

          {show.mediaType !== "movie" && canTrackShow && (railWatchedKeysReady || hasRailInitialized) && (
            <ContinueTrackingRail
              items={continueTrackingRailItems}
              isLoadingMore={isRailLoadingMore}
              canLoadPrevious={canLoadPreviousRail}
              canLoadNext={canLoadNextRail}
              onLoadPrevious={() => {
                void loadAdjacentRailSeason("previous");
              }}
              onLoadNext={() => {
                void loadAdjacentRailSeason("next");
              }}
              onToggleEpisode={handleToggleEpisodeWatched}
              fallbackImageUrl={show.backdropUrl ?? show.posterUrl ?? null}
              initialScrollIndex={railAnchorMeta.initialScrollIndex}
              resetScrollKey={show.id}
            />
          )}

          {/* Seasons Section */}
          {seasons.length > 0 && (
            <View>
              <View className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
                <Text
                  className="text-xl text-text-primary"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  Seasons & Episodes
                </Text>
                {canMarkShowWatchedFromActionBar ? (
                  <Pressable
                    onPress={handleMarkShowWatched}
                    disabled={!canTrackShow || isMarkingShow}
                    accessibilityRole="button"
                    accessibilityLabel="Mark all episodes watched"
                    className="min-h-[36px] flex-row items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 py-2"
                    style={({ pressed }) => ({
                      opacity: !canTrackShow || isMarkingShow ? 0.45 : pressed ? 0.84 : 1,
                    })}
                  >
                    {isMarkingShow ? (
                      <ActivityIndicator size="small" color="#a1a1aa" />
                    ) : (
                      <Ionicons name="checkmark-done-outline" size={15} color="#a1a1aa" />
                    )}
                    <Text className="text-[11px] font-bold uppercase text-text-secondary">
                      {isMarkingShow ? "Saving" : "Mark All Watched"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
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
                      watchedCount={getSeasonWatchedCount(season.seasonNumber)}
                      releasedCount={releasedCount}
                      isMarking={!!seasonActionLoading[season.seasonNumber]}
                      pendingEpisodeKeys={pendingEpisodeKeys}
                      watchedEpisodeKeys={watchedEpisodeKeys}
                      episodeWatchCounts={episodeWatchCounts}
                      getEpisodeAvailability={getEpisodeAvailabilityLabel}
                      onToggle={() => toggleSeason(season.seasonNumber)}
                      onMarkSeason={() => handleMarkSeasonWatched(season)}
                      onToggleEpisode={handleToggleEpisodeWatched}
                      onEpisodeSwipeAction={(episode, action) => {
                        void handleEpisodeSwipeAction(episode, action);
                      }}
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
        onRequestClose={() =>
          !isNavigatingToNextSeason && !isPausingRelatedEntries && setNextSeasonPrompt(null)
        }
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() =>
              !isNavigatingToNextSeason && !isPausingRelatedEntries && setNextSeasonPrompt(null)
            }
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
                disabled={isNavigatingToNextSeason || isPausingRelatedEntries}
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
                disabled={isNavigatingToNextSeason || isPausingRelatedEntries}
                onPress={() => {
                  void handlePauseOtherRelatedSeasons();
                }}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                {isPausingRelatedEntries ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#a1a1aa" />
                    <Text className="font-semibold text-text-secondary">Pausing...</Text>
                  </View>
                ) : (
                  <Text className="font-semibold text-text-secondary">
                    Pause Other Franchise Titles
                  </Text>
                )}
              </Pressable>

              <Pressable
                disabled={isNavigatingToNextSeason || isPausingRelatedEntries}
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
        visible={!!previousEpisodesPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isPreviousEpisodesPromptRunning) {
            setPreviousEpisodesPrompt(null);
          }
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => {
              if (!isPreviousEpisodesPromptRunning) {
                setPreviousEpisodesPrompt(null);
              }
            }}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Catch Up
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={2}>
                {previousEpisodesPrompt?.episode.name ??
                  `Episode ${previousEpisodesPrompt?.episode.episodeNumber ?? ""}`}
              </Text>
              <Text className="mt-1 text-sm text-text-secondary" numberOfLines={2}>
                {previousEpisodesPrompt
                  ? `S${String(previousEpisodesPrompt.episode.seasonNumber).padStart(2, "0")}E${String(previousEpisodesPrompt.episode.episodeNumber).padStart(2, "0")}`
                  : ""}
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-text-secondary">
                {previousEpisodesPrompt
                  ? `You still have ${previousEpisodesPrompt.missingEpisodes.length} earlier released episode${previousEpisodesPrompt.missingEpisodes.length === 1 ? "" : "s"} not marked as watched.`
                  : ""}
              </Text>
            </View>

            <View className="gap-2 p-4">
              <Pressable
                disabled={isPreviousEpisodesPromptRunning}
                onPress={() => {
                  void handlePreviousEpisodesPromptChoice("all");
                }}
                className="items-center justify-center rounded-xl border border-primary/40 bg-primary/15 py-3.5 active:bg-primary/20"
              >
                {isPreviousEpisodesPromptRunning ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="font-semibold text-text-primary">Processing...</Text>
                  </View>
                ) : (
                  <Text className="font-semibold text-text-primary">
                    Mark Previous Episodes Too
                  </Text>
                )}
              </Pressable>

              <Pressable
                disabled={isPreviousEpisodesPromptRunning}
                onPress={() => {
                  void handlePreviousEpisodesPromptChoice("current");
                }}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                <Text className="font-semibold text-text-secondary">Only This Episode</Text>
              </Pressable>

              <Pressable
                disabled={isPreviousEpisodesPromptRunning}
                onPress={() => setPreviousEpisodesPrompt(null)}
                className="items-center justify-center rounded-xl py-2"
              >
                <Text className="text-sm text-text-muted">Cancel</Text>
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
                <Text className="font-semibold text-text-secondary">
                  {watchActionTarget?.kind === "show" && show?.mediaType === "anime"
                    ? "Mark This Title Not Watched"
                    : "Mark Not Watched"}
                </Text>
              </Pressable>

              {watchActionTarget?.kind === "show" && canClearRelatedAnimeWatched ? (
                <Pressable
                  disabled={isWatchActionRunning}
                  onPress={() => void handleWatchActionChoice("not_watched_related")}
                  className="items-center justify-center rounded-xl border border-primary/35 bg-primary/10 py-3.5 active:bg-primary/15"
                >
                  <Text className="font-semibold text-primary">
                    Mark Entire Franchise Not Watched
                  </Text>
                </Pressable>
              ) : null}

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
        visible={isFranchiseSettingsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isUpdatingAnimeSettings) {
            setIsFranchiseSettingsModalVisible(false);
          }
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => {
              if (!isUpdatingAnimeSettings) {
                setIsFranchiseSettingsModalVisible(false);
              }
            }}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Franchise Settings
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={2}>
                {cleanedShowTitle}
              </Text>
              <Text className="mt-2 text-sm text-text-secondary">
                Choose how this franchise appears on Home.
              </Text>
              <Text className="mt-1 text-xs text-text-muted">
                Current Home view: {effectiveFranchiseModeLabel}
              </Text>
            </View>

            <View className="gap-2 p-4">
              <Pressable
                disabled={isUpdatingAnimeSettings}
                onPress={() => {
                  void handleSetFranchiseRelationMode("inherit");
                }}
                className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                  franchiseAnimeRelationMode === null
                    ? "border-primary/60 bg-primary/15"
                    : "border-border-default bg-bg-base"
                }`}
                style={({ pressed }) => ({
                  opacity: isUpdatingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                })}
              >
                <View className="flex-1">
                  <Text
                    className={`text-sm font-semibold ${
                      franchiseAnimeRelationMode === null
                        ? "text-primary"
                        : "text-text-primary"
                    }`}
                  >
                    Inherit Global Setting
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-secondary">
                    Follow your Profile franchise preference for this title.
                  </Text>
                </View>
                <Ionicons
                  name={
                    franchiseAnimeRelationMode === null
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={18}
                  color={franchiseAnimeRelationMode === null ? "#ef4444" : "#71717a"}
                />
              </Pressable>

              <Pressable
                disabled={isUpdatingAnimeSettings}
                onPress={() => {
                  void handleSetFranchiseRelationMode("core_only");
                }}
                className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                  franchiseAnimeRelationMode === "core_only"
                    ? "border-primary/60 bg-primary/15"
                    : "border-border-default bg-bg-base"
                }`}
                style={({ pressed }) => ({
                  opacity: isUpdatingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                })}
              >
                <View className="flex-1">
                  <Text
                    className={`text-sm font-semibold ${
                      franchiseAnimeRelationMode === "core_only"
                        ? "text-primary"
                        : "text-text-primary"
                    }`}
                  >
                    Core Franchise Titles
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-secondary">
                    Keep Home focused on the main franchise timeline.
                  </Text>
                </View>
                <Ionicons
                  name={
                    franchiseAnimeRelationMode === "core_only"
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={18}
                  color={franchiseAnimeRelationMode === "core_only" ? "#ef4444" : "#71717a"}
                />
              </Pressable>

              <Pressable
                disabled={isUpdatingAnimeSettings}
                onPress={() => {
                  void handleSetFranchiseRelationMode("all_relations");
                }}
                className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                  franchiseAnimeRelationMode === "all_relations"
                    ? "border-primary/60 bg-primary/15"
                    : "border-border-default bg-bg-base"
                }`}
                style={({ pressed }) => ({
                  opacity: isUpdatingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                })}
              >
                <View className="flex-1">
                  <Text
                    className={`text-sm font-semibold ${
                      franchiseAnimeRelationMode === "all_relations"
                        ? "text-primary"
                        : "text-text-primary"
                    }`}
                  >
                    All Franchise Titles
                  </Text>
                  <Text className="mt-0.5 text-xs text-text-secondary">
                    Include side stories and related entries on Home.
                  </Text>
                </View>
                <Ionicons
                  name={
                    franchiseAnimeRelationMode === "all_relations"
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={18}
                  color={franchiseAnimeRelationMode === "all_relations" ? "#ef4444" : "#71717a"}
                />
              </Pressable>

              {isUpdatingAnimeSettings ? (
                <View className="flex-row items-center justify-center gap-2 py-1">
                  <ActivityIndicator size="small" color="#a1a1aa" />
                  <Text className="text-xs text-text-secondary">Saving franchise setting...</Text>
                </View>
              ) : null}

              <Pressable
                disabled={isUpdatingAnimeSettings}
                onPress={() => setIsFranchiseSettingsModalVisible(false)}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-elevated py-3"
                style={({ pressed }) => ({
                  opacity: isUpdatingAnimeSettings ? 0.45 : pressed ? 0.88 : 1,
                })}
              >
                <Text className="text-sm font-semibold text-text-primary">Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!removeLibraryPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => handleResolveRemoveLibraryPrompt(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            focusable={false}
            style={{ outlineWidth: 0, outlineStyle: "solid", outlineColor: "transparent" }}
            onPress={() => handleResolveRemoveLibraryPrompt(false)}
          />

          <View className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <View className="flex-row items-center gap-2">
                <View className="size-8 items-center justify-center rounded-full border border-primary/35 bg-primary/10">
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                </View>
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Remove from Library
                </Text>
              </View>
              <Text className="mt-3 text-lg font-black text-text-primary">
                Remove this title?
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-text-secondary">
                {removeLibraryPrompt?.message}
              </Text>
            </View>

            <View className="gap-2 p-4">
              <Pressable
                onPress={() => handleResolveRemoveLibraryPrompt(true)}
                className="items-center justify-center rounded-xl border border-primary/40 bg-primary/15 py-3.5 active:bg-primary/20"
              >
                <Text className="font-semibold text-primary">Remove from Library</Text>
              </Pressable>

              <Pressable
                onPress={() => handleResolveRemoveLibraryPrompt(false)}
                className="items-center justify-center rounded-xl border border-border-default bg-bg-base py-3.5 active:bg-bg-elevated"
              >
                <Text className="font-semibold text-text-secondary">Cancel</Text>
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
                {showMediaType === "movie" ? "Edit Movie Status" : "Edit Tracking"}
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary" numberOfLines={2}>
                {cleanedShowTitle}
              </Text>
              <Text className="mt-2 text-sm text-text-secondary">
                {!trackingLoaded
                  ? "Loading your current tracking state."
                  : isInWatchlist
                  ? `Current status: ${activeTrackingOption.label}`
                  : isFirstSavePrompt
                    ? "Choose whether this should appear on Home right away or stay saved for later."
                    : showMediaType === "movie"
                      ? "Pick a status to add this movie to your queue."
                      : "Pick a status to add this title to your watchlist."}
              </Text>
              {isFirstSavePrompt ? (
                <Text className="mt-1 text-xs text-text-muted">
                  Show on Home now sets it to Watching. Save for later sets it to Planned.
                </Text>
              ) : null}
              {showMediaType === "anime" ? (
                <Text className="mt-1 text-xs text-text-muted">
                  Franchise titles may auto-follow as part of your timeline.
                </Text>
              ) : null}
            </View>

            <View className="gap-2 p-4">
              {statusMenuOptions.map((option) => {
                const isActive =
                  isInWatchlist && activeTrackingStatusForMenu === option.value;
                const title =
                  isFirstSavePrompt && option.value === "watching"
                    ? "Show on Home now"
                    : isFirstSavePrompt && option.value === "plan_to_watch"
                      ? "Save for later"
                      : option.label;
                const description =
                  isFirstSavePrompt && option.value === "watching"
                    ? "Marks this as Watching so it appears in your Home watchlist."
                    : isFirstSavePrompt && option.value === "plan_to_watch"
                      ? "Marks this as Planned and keeps it off Home until you start it."
                      : option.description;
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
                        {title}
                      </Text>
                      <Text className="mt-0.5 text-xs text-text-secondary">
                        {description}
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

              {isInWatchlist ? (
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
                  <Text className="font-semibold text-primary">Remove from Library</Text>
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
