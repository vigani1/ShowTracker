import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  getMovieRecommendations,
  getTvRecommendations,
  getSimilarMovies,
  getSimilarTv,
} from "@/lib/api/tmdb";
import { getAniListRecommendations } from "@/lib/api/anilist";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";

type RecTab = "all" | "tv" | "anime" | "movie";

const tabOptions = [
  { value: "all" as const, label: "All" },
  { value: "tv" as const, label: "TV Shows" },
  { value: "anime" as const, label: "Anime" },
  { value: "movie" as const, label: "Movies" },
];

const MAX_TMDB_SEEDS_PER_CATEGORY = 5;
const MAX_ANIME_SEEDS_PER_CATEGORY = 2;
const ANIME_RATE_LIMIT_COOLDOWN_MS = 90_000;
const ANIME_REQUEST_TIMEOUT_MS = 6_000;
const EMPTY_STREAK_THRESHOLD = 3;

function logRecommendationsDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log(`[ForYou] ${event}`, payload);
}

function isRateLimitError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 429
  );
}

function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  controller?: AbortController
): Promise<T> {
  return new Promise((resolve, reject) => {
    const activeController = controller ?? new AbortController();
    let isSettled = false;

    const settle = (callback: () => void) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      clearTimeout(timeoutId);
      callback();
    };

    const timeoutId = setTimeout(() => {
      if (!activeController.signal.aborted) {
        activeController.abort();
      }
      settle(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    promiseFactory(activeController.signal)
      .then((value) => {
        settle(() => {
          resolve(value);
        });
      })
      .catch((error) => {
        settle(() => {
          reject(error);
        });
      });
  });
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function getGridColumnCount(width: number, isWeb: boolean) {
  if (!isWeb) return 2;
  if (width >= 1800) return 8;
  if (width >= 1500) return 7;
  if (width >= 1260) return 6;
  if (width >= 1040) return 5;
  if (width >= 920) return 4;
  return 3;
}

function toTrackedTmdbKey(mediaType: "tv" | "movie", tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

function toRecommendationKey(item: NormalizedShow) {
  return `${item.id}:${item.mediaType}`;
}

function toAnimeRecommendationKey(item: NormalizedShow) {
  return `${item.anilistId ?? ""}:${item.id}`;
}

function interleaveItems(
  tvItems: NormalizedShow[],
  animeItems: NormalizedShow[],
  movieItems: NormalizedShow[]
): NormalizedShow[] {
  if (tvItems.length === 0 && animeItems.length === 0 && movieItems.length === 0) {
    return [];
  }

  const result: NormalizedShow[] = [];
  const maxLen = Math.max(tvItems.length, animeItems.length, movieItems.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < tvItems.length) result.push(tvItems[i]);
    if (i < animeItems.length) result.push(animeItems[i]);
    if (i < movieItems.length) result.push(movieItems[i]);
  }

  return result;
}

type RecommendationSeed = {
  id: string;
  tmdbId?: number | null;
  anilistId?: number | null;
  malId?: number | null;
  mediaType: "tv" | "anime" | "movie";
  title: string;
};

type SeedResultItem = {
  item: NormalizedShow;
  seedMediaType: "tv" | "anime" | "movie";
};

function selectSeeds(
  activeTab: RecTab,
  seedPool: RecommendationSeed[],
  animeCooldownActive: boolean
) {
  const availableTvSeeds = seedPool.filter((seed) => seed.mediaType === "tv");
  const availableAnimeSeeds = seedPool.filter((seed) => seed.mediaType === "anime");
  const availableMovieSeeds = seedPool.filter((seed) => seed.mediaType === "movie");

  if (activeTab === "all") {
    const tvSeeds = availableTvSeeds.slice(0, MAX_TMDB_SEEDS_PER_CATEGORY);
    const animeSeeds = animeCooldownActive
      ? []
      : availableAnimeSeeds.slice(0, MAX_ANIME_SEEDS_PER_CATEGORY);
    const movieSeeds = availableMovieSeeds.slice(0, MAX_TMDB_SEEDS_PER_CATEGORY);

    return {
      relevantSeeds: [...tvSeeds, ...animeSeeds, ...movieSeeds],
      selectedMovieSeeds: movieSeeds,
      availableCounts: {
        tv: availableTvSeeds.length,
        anime: availableAnimeSeeds.length,
        movie: availableMovieSeeds.length,
      },
      selectedCounts: {
        tv: tvSeeds.length,
        anime: animeSeeds.length,
        movie: movieSeeds.length,
      },
    };
  }

  const availableForActiveTab = seedPool.filter(
    (seed) => seed.mediaType === activeTab
  );
  const maxSeeds =
    activeTab === "anime"
      ? MAX_ANIME_SEEDS_PER_CATEGORY
      : MAX_TMDB_SEEDS_PER_CATEGORY;
  const relevantSeeds =
    activeTab === "anime" && animeCooldownActive
      ? []
      : availableForActiveTab.slice(0, maxSeeds);

  return {
    relevantSeeds,
    selectedMovieSeeds: [] as RecommendationSeed[],
    availableCounts: {
      tv: availableTvSeeds.length,
      anime: availableAnimeSeeds.length,
      movie: availableMovieSeeds.length,
    },
    selectedCounts: {
      tv: activeTab === "tv" ? relevantSeeds.length : 0,
      anime: activeTab === "anime" ? relevantSeeds.length : 0,
      movie: activeTab === "movie" ? relevantSeeds.length : 0,
    },
  };
}

function categorizeAndDedupe(
  seedResults: SeedResultItem[][],
  options: {
    trackedTmdbKeys: Set<string>;
    trackedAnimeIds: Set<number>;
    initialSeenTv: Set<string>;
    initialSeenAnime: Set<string>;
    initialSeenMovie: Set<string>;
  }
) {
  const seenTvIds = new Set(options.initialSeenTv);
  const seenAnimeIds = new Set(options.initialSeenAnime);
  const seenMovieIds = new Set(options.initialSeenMovie);

  const tvRecs: NormalizedShow[] = [];
  const animeRecs: NormalizedShow[] = [];
  const movieRecs: NormalizedShow[] = [];

  for (const resultSet of seedResults) {
    for (const { item, seedMediaType } of resultSet) {
      if (
        (item.mediaType === "tv" || item.mediaType === "movie") &&
        typeof item.tmdbId === "number" &&
        options.trackedTmdbKeys.has(toTrackedTmdbKey(item.mediaType, item.tmdbId))
      ) {
        continue;
      }

      if (
        item.mediaType === "anime" &&
        typeof item.anilistId === "number" &&
        options.trackedAnimeIds.has(item.anilistId)
      ) {
        continue;
      }

      if (seedMediaType === "tv") {
        const tvKey = toRecommendationKey(item);
        if (!seenTvIds.has(tvKey)) {
          seenTvIds.add(tvKey);
          tvRecs.push(item);
        }
        continue;
      }

      if (seedMediaType === "anime") {
        const animeKey = toAnimeRecommendationKey(item);
        if (!seenAnimeIds.has(animeKey)) {
          seenAnimeIds.add(animeKey);
          animeRecs.push(item);
        }
        continue;
      }

      const movieKey = toRecommendationKey(item);
      if (!seenMovieIds.has(movieKey)) {
        seenMovieIds.add(movieKey);
        movieRecs.push(item);
      }
    }
  }

  return {
    tvRecs,
    animeRecs,
    movieRecs,
    seenSets: {
      tv: seenTvIds,
      anime: seenAnimeIds,
      movie: seenMovieIds,
    },
  };
}

export function RecommendationsScreen() {
  const [activeTab, setActiveTab] = useState<RecTab>("all");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const columns = getGridColumnCount(width, isWeb);

  const [recommendations, setRecommendations] = useState<NormalizedShow[]>([]);
  const [tvRecommendations, setTvRecommendations] = useState<NormalizedShow[]>([]);
  const [animeRecommendations, setAnimeRecommendations] = useState<NormalizedShow[]>([]);
  const [movieRecommendations, setMovieRecommendations] = useState<NormalizedShow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreTv, setHasMoreTv] = useState(true);
  const [hasMoreAnime, setHasMoreAnime] = useState(true);
  const [hasMoreMovie, setHasMoreMovie] = useState(true);
  const [isAnimeRateLimited, setIsAnimeRateLimited] = useState(false);
  const effectiveHasMoreAnime = hasMoreAnime && !isAnimeRateLimited;
  const isAnimeRateLimitedRef = useRef(isAnimeRateLimited);
  const tvEmptyStreakRef = useRef(0);
  const animeEmptyStreakRef = useRef(0);
  const movieEmptyStreakRef = useRef(0);
  const tvRecommendationsRef = useRef<NormalizedShow[]>([]);
  const animeRecommendationsRef = useRef<NormalizedShow[]>([]);
  const movieRecommendationsRef = useRef<NormalizedShow[]>([]);
  const currentPageRef = useRef(1);
  const fetchRecommendationsRef = useRef<
    ((page?: number, isLoadMore?: boolean) => Promise<void>) | null
  >(null);

  useEffect(() => {
    isAnimeRateLimitedRef.current = isAnimeRateLimited;
  }, [isAnimeRateLimited]);

  // Reset page and hasMore when switching tabs
  useEffect(() => {
    setCurrentPage(1);
    setHasMoreTv(true);
    setHasMoreAnime(true);
    setHasMoreMovie(true);
    tvEmptyStreakRef.current = 0;
    animeEmptyStreakRef.current = 0;
    movieEmptyStreakRef.current = 0;
  }, [activeTab]);

  useEffect(() => {
    if (!isAnimeRateLimited) {
      return;
    }

    const timer = setTimeout(() => {
      setIsAnimeRateLimited(false);
      setHasMoreAnime(true);
      animeEmptyStreakRef.current = 0;
    }, ANIME_RATE_LIMIT_COOLDOWN_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isAnimeRateLimited]);

  useEffect(() => {
    tvRecommendationsRef.current = tvRecommendations;
  }, [tvRecommendations]);

  useEffect(() => {
    animeRecommendationsRef.current = animeRecommendations;
  }, [animeRecommendations]);

  useEffect(() => {
    movieRecommendationsRef.current = movieRecommendations;
  }, [movieRecommendations]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const hasMoreForActiveTab = useMemo(() => {
    if (activeTab === "all") {
      return hasMoreTv || effectiveHasMoreAnime || hasMoreMovie;
    }
    if (activeTab === "tv") return hasMoreTv;
    if (activeTab === "anime") return effectiveHasMoreAnime;
    if (activeTab === "movie") return hasMoreMovie;
    return false;
  }, [activeTab, effectiveHasMoreAnime, hasMoreTv, hasMoreMovie]);

  const trackedIds = useQuery(api.shows.getTrackedIds, {});
  const trackedTmdbKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of trackedIds ?? []) {
      if (
        (item.mediaType === "tv" || item.mediaType === "movie") &&
        item.tmdbId !== null
      ) {
        keys.add(toTrackedTmdbKey(item.mediaType, item.tmdbId));
      }
    }
    return keys;
  }, [trackedIds]);
  const isTrackedLibraryLoading = trackedIds === undefined;

  // Track anime IDs separately
  const trackedAnimeIds = useMemo(() => {
    const ids = new Set<number>();
    for (const item of trackedIds ?? []) {
      if (item.mediaType === "anime" && item.anilistId !== null) {
        ids.add(item.anilistId);
      }
    }
    return ids;
  }, [trackedIds]);

  // Get all recommendation seeds in one backend call and split by media type.
  const recommendationSeeds = useQuery(api.shows.getRecommendationSeedsByMedia, {
    limitPerType: 10,
  });
  const tvSeedShows = recommendationSeeds?.tv;
  const animeSeedShows = recommendationSeeds?.anime;
  const movieSeedShows = recommendationSeeds?.movie;

  const seedShows = useMemo(() => {
    if (activeTab === "tv") return tvSeedShows;
    if (activeTab === "anime") return animeSeedShows;
    if (activeTab === "movie") return movieSeedShows;

    if (
      tvSeedShows === undefined ||
      animeSeedShows === undefined ||
      movieSeedShows === undefined
    ) {
      return undefined;
    }

    return [...tvSeedShows, ...animeSeedShows, ...movieSeedShows];
  }, [activeTab, animeSeedShows, movieSeedShows, tvSeedShows]);

  useEffect(() => {
    const controller = new AbortController();

    const fetchRecommendations = async (page: number = 1, isLoadMore: boolean = false) => {
      const { signal } = controller;

      if (isTrackedLibraryLoading) {
        if (!signal.aborted) {
          setIsLoading(true);
        }
        return;
      }

      if (seedShows === undefined) {
        if (!signal.aborted) {
          setIsLoading(true);
        }
        return;
      }

      if (seedShows.length === 0) {
        if (!signal.aborted) {
          setRecommendations([]);
          setTvRecommendations([]);
          setAnimeRecommendations([]);
          setMovieRecommendations([]);
          setError(null);
          setIsLoading(false);
          setHasMoreTv(false);
          setHasMoreAnime(false);
          setHasMoreMovie(false);
        }
        return;
      }

      if (signal.aborted) {
        return;
      }

      if (isLoadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        // Reset state for fresh load
        setTvRecommendations([]);
        setAnimeRecommendations([]);
        setMovieRecommendations([]);
      }
      setError(null);

      try {
        const initialSeenTv = new Set<string>(
          (isLoadMore ? tvRecommendationsRef.current : []).map((item) =>
            toRecommendationKey(item)
          )
        );
        const initialSeenAnime = new Set<string>(
          (isLoadMore ? animeRecommendationsRef.current : []).map((item) =>
            toAnimeRecommendationKey(item)
          )
        );
        const initialSeenMovie = new Set<string>(
          (isLoadMore ? movieRecommendationsRef.current : []).map((item) =>
            toRecommendationKey(item)
          )
        );

        const animeCooldownActive = isAnimeRateLimitedRef.current;
        const seedSelection = selectSeeds(
          activeTab,
          seedShows as RecommendationSeed[],
          animeCooldownActive
        );

        logRecommendationsDebug("seed-selection", {
          activeTab,
          page,
          isLoadMore,
          animeCooldownActive,
          availableSeedCounts: seedSelection.availableCounts,
          selectedSeedCounts: seedSelection.selectedCounts,
          ...(activeTab === "all"
            ? {
                selectedMovieSeedTitles: seedSelection.selectedMovieSeeds.map(
                  (seed) => seed.title
                ),
              }
            : {}),
        });

        const seedResults: SeedResultItem[][] = await Promise.all(
          seedSelection.relevantSeeds.map(async (seed): Promise<SeedResultItem[]> => {
            if (signal.aborted) {
              return [];
            }

            try {
              if (seed.mediaType === "anime" && typeof seed.anilistId === "number") {
                const anilistId = seed.anilistId;
                const requestController = new AbortController();
                const abortFromParent = () => {
                  requestController.abort();
                };
                signal.addEventListener("abort", abortFromParent, { once: true });

                try {
                  const recs = await withTimeout(
                    (timeoutSignal) =>
                      getAniListRecommendations(anilistId, page, 10, {
                        signal: timeoutSignal,
                      }),
                    ANIME_REQUEST_TIMEOUT_MS,
                    `AniList recommendations for ${seed.title}`,
                    requestController
                  );
                  if (signal.aborted) return [];
                  return recs.items.map((item) => ({ item, seedMediaType: "anime" as const }));
                } catch (e) {
                  if (isRateLimitError(e) && !signal.aborted) {
                    setIsAnimeRateLimited(true);
                    setHasMoreAnime(false);
                    logRecommendationsDebug("anime-rate-limited", {
                      source: "initial-fetch",
                      activeTab,
                      page,
                      seedTitle: seed.title,
                      cooldownMs: ANIME_RATE_LIMIT_COOLDOWN_MS,
                    });
                  }
                  console.warn("Anime API failed for", seed.title, e);
                  return [];
                } finally {
                  signal.removeEventListener("abort", abortFromParent);
                }
              }

              if (seed.mediaType === "movie" && typeof seed.tmdbId === "number") {
                try {
                  const [recs, similar] = await Promise.all([
                    getMovieRecommendations(seed.tmdbId, page, { signal }),
                    getSimilarMovies(seed.tmdbId, page, { signal }),
                  ]);
                  if (signal.aborted) return [];
                  return [
                    ...recs,
                    ...similar.filter((s) => !recs.some((r) => r.id === s.id && r.mediaType === s.mediaType)),
                  ].map((item) => ({ item, seedMediaType: "movie" as const }));
                } catch (e) {
                  console.warn("Movie API failed for", seed.title, e);
                  return [];
                }
              }

              if (seed.mediaType === "tv" && typeof seed.tmdbId === "number") {
                try {
                  const [recs, similar] = await Promise.all([
                    getTvRecommendations(seed.tmdbId, page, { signal }),
                    getSimilarTv(seed.tmdbId, page, { signal }),
                  ]);
                  if (signal.aborted) return [];
                  return [
                    ...recs,
                    ...similar.filter((s) => !recs.some((r) => r.id === s.id && r.mediaType === s.mediaType)),
                  ].map((item) => ({ item, seedMediaType: "tv" as const }));
                } catch (e) {
                  console.warn("TV API failed for", seed.title, e);
                  return [];
                }
              }

              return [];
            } catch (err) {
              if (signal.aborted || isAbortError(err)) {
                return [];
              }
              console.error(`Failed to get recommendations for ${seed.title}:`, err);
              return [];
            }
          })
        );

        if (signal.aborted) {
          return;
        }

        const { tvRecs, animeRecs, movieRecs } = categorizeAndDedupe(seedResults, {
          trackedTmdbKeys,
          trackedAnimeIds,
          initialSeenTv,
          initialSeenAnime,
          initialSeenMovie,
        });

        if (!signal.aborted) {
          logRecommendationsDebug("recommendation-results", {
            activeTab,
            page,
            isLoadMore,
            recommendationCounts: {
              tv: tvRecs.length,
              anime: animeRecs.length,
              movie: movieRecs.length,
            },
          });

          if (
            activeTab === "all" &&
            seedSelection.selectedMovieSeeds.length > 0 &&
            movieRecs.length === 0
          ) {
            logRecommendationsDebug("movie-seeds-without-results", {
              page,
              selectedMovieSeedTitles: seedSelection.selectedMovieSeeds.map(
                (seed) => seed.title
              ),
            });
          }

          if (isLoadMore) {
            // Append new items
            setTvRecommendations((prev) => {
              const next = [...prev, ...tvRecs];
              tvRecommendationsRef.current = next;
              return next;
            });
            setAnimeRecommendations((prev) => {
              const next = [...prev, ...animeRecs];
              animeRecommendationsRef.current = next;
              return next;
            });
            setMovieRecommendations((prev) => {
              const next = [...prev, ...movieRecs];
              movieRecommendationsRef.current = next;
              return next;
            });
          } else {
            // Replace with new items
            tvRecommendationsRef.current = tvRecs;
            animeRecommendationsRef.current = animeRecs;
            movieRecommendationsRef.current = movieRecs;
            setTvRecommendations(tvRecs);
            setAnimeRecommendations(animeRecs);
            setMovieRecommendations(movieRecs);
          }
          
          // Update current page
          currentPageRef.current = page;
          setCurrentPage(page);

          // Update empty streak counters only for categories we actually queried.
          if (seedSelection.selectedCounts.tv > 0) {
            tvEmptyStreakRef.current =
              tvRecs.length === 0 ? tvEmptyStreakRef.current + 1 : 0;
          }
          if (seedSelection.selectedCounts.anime > 0) {
            animeEmptyStreakRef.current =
              animeRecs.length === 0 ? animeEmptyStreakRef.current + 1 : 0;
          }
          if (seedSelection.selectedCounts.movie > 0) {
            movieEmptyStreakRef.current =
              movieRecs.length === 0 ? movieEmptyStreakRef.current + 1 : 0;
          }
          
          const hasMoreTvRecs = tvEmptyStreakRef.current < EMPTY_STREAK_THRESHOLD;
          const hasMoreAnimeRecs = animeEmptyStreakRef.current < EMPTY_STREAK_THRESHOLD;
          const hasMoreMovieRecs = movieEmptyStreakRef.current < EMPTY_STREAK_THRESHOLD;
          setHasMoreTv(hasMoreTvRecs);
          setHasMoreAnime(hasMoreAnimeRecs);
          setHasMoreMovie(hasMoreMovieRecs);
        }
      } catch (err) {
        if (!signal.aborted && !isAbortError(err)) {
          setError("Failed to load recommendations. Please try again.");
          console.error(err);
        }
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    };

    fetchRecommendationsRef.current = fetchRecommendations;

    // Initial load
    void fetchRecommendations(1, false);

    return () => {
      controller.abort();
      fetchRecommendationsRef.current = null;
    };
  }, [
    activeTab,
    isTrackedLibraryLoading,
    seedShows,
    trackedTmdbKeys,
    trackedAnimeIds,
  ]);

  // Update displayed recommendations when TV, anime, or movie lists change
  useEffect(() => {
    if (activeTab === "all") {
      // Interleave TV, anime, and movie recommendations
      const interleaved = interleaveItems(tvRecommendations, animeRecommendations, movieRecommendations);
      setRecommendations(interleaved);
    } else if (activeTab === "tv") {
      setRecommendations(tvRecommendations);
    } else if (activeTab === "anime") {
      setRecommendations(animeRecommendations);
    } else if (activeTab === "movie") {
      setRecommendations(movieRecommendations);
    }
  }, [activeTab, tvRecommendations, animeRecommendations, movieRecommendations]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore) return;

    if (!hasMoreForActiveTab) {
      logRecommendationsDebug("load-more-skipped", {
        activeTab,
        reason: "no-more-results",
        currentPage: currentPageRef.current,
        hasMoreTv,
        hasMoreAnime,
        hasMoreMovie,
      });
      return;
    }

    if (!seedShows || seedShows.length === 0) {
      logRecommendationsDebug("load-more-skipped", {
        activeTab,
        reason: "no-seeds",
        currentPage: currentPageRef.current,
      });
      return;
    }

    const nextPage = currentPageRef.current + 1;
    if (!fetchRecommendationsRef.current) {
      return;
    }

    void fetchRecommendationsRef.current(nextPage, true);
  }, [
    activeTab,
    hasMoreAnime,
    hasMoreForActiveTab,
    hasMoreMovie,
    hasMoreTv,
    isLoading,
    isLoadingMore,
    seedShows,
  ]);

  const headerTitle = useMemo(() => {
    switch (activeTab) {
      case "movie":
        return "Movie Recommendations";
      case "tv":
        return "TV Show Recommendations";
      case "anime":
        return "Anime Recommendations";
      default:
        return "Recommended For You";
    }
  }, [activeTab]);

  const headerSubtitle = useMemo(() => {
    if (seedShows?.length === 0) {
      return "Watch some shows to get personalized recommendations";
    }
    return `Based on your watch history`;
  }, [seedShows]);

  return (
    <ScreenWrapper>
      <View className="flex-1">
        <FlashList
          data={recommendations}
          key={`rec-grid-${columns}`}
          numColumns={columns}
          keyExtractor={(item) => `${item.id}-${item.mediaType}`}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View className="h-3" />}
          ListHeaderComponent={
            <View className="pb-2">
              <PageIntro
                title={headerTitle}
                subtitle={headerSubtitle}
                eyebrow="Personalized"
                icon="sparkles-outline"
                rightLabel={
                  !isLoading && recommendations.length > 0
                    ? `${recommendations.length} suggestions`
                    : undefined
                }
                className="mb-4"
              />

              <SegmentedControl
                options={tabOptions}
                value={activeTab}
                onValueChange={setActiveTab}
                className="mb-4"
              />

              {isLoading && (
                <View className="mb-4 items-center gap-2 rounded-xl border-2 border-border-default bg-bg-surface py-8">
                  <ActivityIndicator size="small" color="#ef4444" />
                  <Text className="text-sm text-text-secondary">
                    Finding shows you'll love...
                  </Text>
                </View>
              )}

              {error && (
                <View className="mb-4 rounded-xl border-2 border-warning/30 bg-warning/10 p-4">
                  <Text className="text-sm text-warning">{error}</Text>
                </View>
              )}

              {isAnimeRateLimited && (
                <View className="mb-4 rounded-xl border-2 border-warning/30 bg-warning/10 p-4">
                  <Text className="text-sm text-warning">
                    Anime recommendations are temporarily rate-limited. TV and movie suggestions
                    will keep loading.
                  </Text>
                </View>
              )}

              {!isLoading && seedShows?.length === 0 && (
                <View className="mb-4 rounded-xl border-2 border-border-default bg-bg-surface px-4 py-8">
                  <Text className="text-lg font-bold text-text-primary">
                    Start Watching to Get Recommendations
                  </Text>
                  <Text className="mt-2 text-sm text-text-secondary">
                    We'll analyze your watch history and suggest shows based on what you like.
                    Try searching for shows or browsing the Discover page.
                  </Text>
                </View>
              )}

              {!isLoading && recommendations.length === 0 && seedShows && seedShows.length > 0 && (
                <View className="mb-4 rounded-xl border-2 border-border-default bg-bg-surface px-4 py-8">
                  <Text className="text-lg font-bold text-text-primary">
                    No Recommendations Found
                  </Text>
                  <Text className="mt-2 text-sm text-text-secondary">
                    We couldn't find recommendations for your current watch history.
                    Try watching more shows or switching to a different tab.
                  </Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-1 px-1.5">
              <MediaPosterCard
                show={item}
                href={{
                  pathname: "/show/[id]",
                  params: { id: createShowRouteId(item) },
                }}
                className="w-full"
                posterClassName={isWeb ? "h-56" : "h-64"}
              />
            </View>
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            <View className="h-8">
              {isLoadingMore && (
                <View className="items-center py-4">
                  <ActivityIndicator size="small" color="#ef4444" />
                  <Text className="mt-2 text-sm text-text-secondary">
                    Loading more...
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={null}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </View>
    </ScreenWrapper>
  );
}

export default RecommendationsScreen;
