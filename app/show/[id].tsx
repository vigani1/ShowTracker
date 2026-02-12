import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Badge } from "@/components/Badge";
import { ProgressBar } from "@/components/ProgressBar";
import { ShowHeader } from "@/components/ShowHeader";
import { SeasonAccordion } from "@/components/SeasonAccordion";
import { getAniListMediaById } from "@/lib/api/anilist";
import { getJikanAnime } from "@/lib/api/jikan";
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
import { parseShowRouteId } from "@/lib/show-route";
import { toHttpsImageUrl } from "@/lib/image-url";

type SeasonLoadState = Record<number, boolean>;
type SeasonErrorState = Record<number, string | null>;
type EpisodePendingState = Record<string, boolean>;
type SeasonActionState = Record<number, boolean>;

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

function createAnimeSeason(totalEpisodes?: number) {
  const episodeCount = Math.max(1, Math.min(totalEpisodes ?? 12, 80));
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
      })),
    },
  ] as NormalizedSeason[];
}

function buildShowPayload(show: NormalizedShow) {
  return {
    tmdbId: show.tmdbId,
    anilistId: show.anilistId,
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
    lastUpdated: Date.now(),
  };
}

function buildTrackingArgs(show: NormalizedShow | null) {
  if (!show) return "skip" as const;
  if (typeof show.tmdbId === "number") return { tmdbId: show.tmdbId };
  if (typeof show.anilistId === "number") return { anilistId: show.anilistId };
  if (typeof show.tvmazeId === "number") return { tvmazeId: show.tvmazeId };
  return "skip" as const;
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
  const [isMarkingShow, setIsMarkingShow] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const addToWatchlist = useMutation(api.shows.addToWatchlist);
  const toggleEpisodeWatched = useMutation(api.shows.toggleEpisodeWatched);
  const markSeasonWatched = useMutation(api.shows.markSeasonWatched);
  const unmarkSeasonWatched = useMutation(api.shows.unmarkSeasonWatched);

  const trackingArgs = useMemo(() => buildTrackingArgs(show), [show]);
  const tracking = useQuery(api.shows.getUserShowTracking, trackingArgs);
  const canTrackShow = trackingArgs !== "skip";

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
      Object.values(seasonActionLoading).some(Boolean);
    if (!hasPending) {
      setPendingOverrides({});
    }
  }, [pendingEpisodeKeys, seasonActionLoading]);

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
      setIsMarkingShow(false);

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
          setShow(normalized);
          setSeasons(createAnimeSeason(normalized.totalEpisodes));
          return;
        }

        const jikanShow = await getJikanAnime(parsedId.externalId);
        if (isCancelled) return;
        setShow(jikanShow);
        setSeasons(createAnimeSeason(jikanShow.totalEpisodes));
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

    setIsAddingToWatchlist(true);
    setTrackingError(null);
    try {
      await addToWatchlist(buildShowPayload(show));
    } catch (mutationError) {
      console.error("Failed to add show to watchlist", mutationError);
      setTrackingError("Could not add this show to watchlist.");
    } finally {
      setIsAddingToWatchlist(false);
    }
  };

  const handleToggleEpisodeWatched = async (episode: NormalizedEpisode) => {
    if (!show) return;
    if (!canTrackShow) {
      setTrackingError("This title cannot be tracked yet.");
      return;
    }

    const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
    if (pendingEpisodeKeys[key]) return;

    const wasWatched = watchedEpisodeKeys.has(key);
    setPendingOverrides((prev) => ({ ...prev, [key]: !wasWatched }));
    setPendingEpisodeKeys((prev) => ({ ...prev, [key]: true }));
    setTrackingError(null);

    try {
      await toggleEpisodeWatched({
        show: buildShowPayload(show),
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        runtime: episode.runtime,
        action: "toggle",
      });
    } catch (mutationError) {
      console.error("Failed to toggle episode", mutationError);
      setPendingOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setTrackingError("Could not update episode status.");
    } finally {
      setPendingEpisodeKeys((prev) => ({ ...prev, [key]: false }));
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

    // Check if any episodes in this season are watched
    // Toggle: if any are watched, unmark all. If none are watched, mark all released.
    const seasonWatchedCount = countWatchedEpisodesForSeason(season.seasonNumber, watchedEpisodeKeys);
    const hasAnyWatched = seasonWatchedCount > 0;

    const episodeKeys = releasedEpisodes.map(
      (ep) => `${ep.seasonNumber}:${ep.episodeNumber}`
    );

    setSeasonActionLoading((prev) => ({ ...prev, [season.seasonNumber]: true }));
    setTrackingError(null);

    // Apply optimistic override
    setPendingOverrides((prev) => {
      const next = { ...prev };
      for (const k of episodeKeys) {
        next[k] = !hasAnyWatched;
      }
      return next;
    });

    try {
      if (hasAnyWatched) {
        await unmarkSeasonWatched({
          show: buildShowPayload(show),
          season: season.seasonNumber,
        });
      } else {
        await markSeasonWatched({
          show: buildShowPayload(show),
          season: season.seasonNumber,
          episodes: releasedEpisodes.map((episode) => ({
            episode: episode.episodeNumber,
            runtime: episode.runtime,
          })),
        });
      }
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
        <View className="rounded-2xl border border-primary/30 bg-primary/10 p-6">
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
        <View className={`${isDesktop ? "px-8" : "px-5"} pt-6 pb-8`}>
          <View className={`mx-auto w-full ${isDesktop ? "max-w-4xl" : ""}`}>
          {/* Overview & Poster Row (Mobile Only) */}
          {!isDesktop && (
            <View className="mb-6 flex-row gap-4">
              {showPosterUrl && (
                <View
                  className="overflow-hidden rounded-xl border border-border-default shadow-lg"
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
            {show.totalSeasons && (
              <Badge label={`${show.totalSeasons} Seasons`} variant="accent" />
            )}
            {show.totalEpisodes && (
              <Badge label={`${show.totalEpisodes} Episodes`} variant="accent" />
            )}
            {show.episodeRuntime && (
              <Badge label={`${show.episodeRuntime}m avg`} variant="default" />
            )}
          </View>

          {/* Progress Section */}
          {canTrackShow && (
            <View className="mb-6 rounded-2xl border border-border-default bg-bg-surface p-5">
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

          {/* Action Buttons - Radio button style */}
          {canTrackShow && (
            <View className="mb-6 flex-row flex-wrap items-center gap-6">
              {/* Watchlist Radio */}
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={handleAddToWatchlist}
                  disabled={!canTrackShow || isAddingToWatchlist || !!tracking?.inWatchlist}
                  className="relative h-7 w-7 items-center justify-center"
                  style={({ pressed }) => ({
                    opacity: !canTrackShow || isAddingToWatchlist || !!tracking?.inWatchlist ? 0.5 : 1,
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  })}
                >
                  {isAddingToWatchlist ? (
                    <ActivityIndicator size="small" color="#a1a1aa" />
                  ) : (
                    <>
                      <View
                        className={`absolute h-7 w-7 rounded-full border-2 ${
                          tracking?.inWatchlist ? "border-success" : "border-text-secondary"
                        }`}
                      />
                      {tracking?.inWatchlist && (
                        <>
                          <View className="h-4 w-4 rounded-full bg-success" />
                          <View className="absolute inset-0 items-center justify-center">
                            <Text className="text-xs font-bold text-white">✓</Text>
                          </View>
                        </>
                      )}
                    </>
                  )}
                </Pressable>
                <Pressable
                  onPress={handleAddToWatchlist}
                  disabled={!canTrackShow || isAddingToWatchlist || !!tracking?.inWatchlist}
                  className="active:opacity-70"
                >
                  <Text className={`text-sm ${
                    tracking?.inWatchlist ? "text-success font-medium" : "text-text-secondary"
                  }`}>
                    {isAddingToWatchlist
                      ? "Adding..."
                      : tracking?.inWatchlist
                        ? "In Watchlist"
                        : "Add to Watchlist"}
                  </Text>
                </Pressable>
              </View>

              {/* Mark All Watched Radio */}
              {seasons.length > 0 && !isShowFullyWatched && (
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={handleMarkShowWatched}
                    disabled={!canTrackShow || isMarkingShow}
                    className="relative h-7 w-7 items-center justify-center"
                    style={({ pressed }) => ({
                      opacity: !canTrackShow || isMarkingShow ? 0.5 : 1,
                      transform: [{ scale: pressed ? 0.9 : 1 }],
                    })}
                  >
                    <View 
                      className="absolute h-7 w-7 rounded-full border-2 border-text-secondary"
                    />
                  </Pressable>
                  <Pressable
                    onPress={handleMarkShowWatched}
                    disabled={!canTrackShow || isMarkingShow}
                    className="active:opacity-70"
                  >
                    <Text className="text-sm text-text-secondary">
                      {isMarkingShow ? "Marking..." : "Mark All Watched"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {trackingError && (
            <View className="mb-6 rounded-xl bg-primary/10 p-4">
              <Text className="text-sm text-primary">{trackingError}</Text>
            </View>
          )}

          {/* Seasons Section */}
          {seasons.length > 0 && (
            <View>
              <Text className="mb-4 text-xl font-bold text-text-primary">
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

          {seasons.length === 0 && show.mediaType === "movie" && (
            <View className="rounded-2xl border border-border-default bg-bg-surface p-6">
              <Text className="text-center text-sm text-text-secondary">
                Movies don't have episodes to track. Add to your watchlist to save this title.
              </Text>
            </View>
          )}
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

export default ShowDetailScreen;
