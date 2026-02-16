import { useCallback, useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "convex/react";
import { Link } from "expo-router";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/Button";
import { HeroSection } from "@/components/HeroSection";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import { getTrendingAniList, searchAniList } from "@/lib/api/anilist";
import { discoverTmdb, getTrendingTmdb, type TmdbFilterParams } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";
import { getFiltersForMediaType } from "@/lib/filters";

type DiscoverTab = "all" | "tv" | "anime" | "movie";

type TabState = {
  items: NormalizedShow[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  currentPage: number;
  hasMore: boolean;
};

const INITIAL_ITEMS_PER_PAGE = 20;
const LOAD_MORE_THRESHOLD = 0.5;
const GRID_GAP = 12;

const tabOptions = [
  { value: "all" as const, label: "All" },
  { value: "tv" as const, label: "TV Shows" },
  { value: "anime" as const, label: "Anime" },
  { value: "movie" as const, label: "Movies" },
];

function getGridColumnCount(width: number, isWeb: boolean) {
  if (!isWeb) return 2;
  if (width >= 1800) return 8;
  if (width >= 1500) return 7;
  if (width >= 1260) return 6;
  if (width >= 1040) return 5;
  if (width >= 920) return 4;
  return 3;
}

function getSectionError(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason !== null && "status" in reason) {
    return `${fallback} (API ${(reason as { status: number }).status})`;
  }
  return fallback;
}

function toTrackedTmdbKey(mediaType: "tv" | "movie", tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

function filterTrackedTmdbItems(items: NormalizedShow[], trackedTmdbKeys: Set<string>) {
  return items.filter((item) => {
    if (
      (item.mediaType === "tv" || item.mediaType === "movie") &&
      typeof item.tmdbId === "number"
    ) {
      return !trackedTmdbKeys.has(toTrackedTmdbKey(item.mediaType, item.tmdbId));
    }
    return true;
  });
}

function interleaveDiscoverItems(
  tvItems: NormalizedShow[],
  animeItems: NormalizedShow[],
  movieItems: NormalizedShow[]
): NormalizedShow[] {
  const result: NormalizedShow[] = [];
  const maxLen = Math.max(tvItems.length, animeItems.length, movieItems.length);

  for (let i = 0; i < maxLen; i += 1) {
    if (i < tvItems.length) result.push(tvItems[i]);
    if (i < animeItems.length) result.push(animeItems[i]);
    if (i < movieItems.length) result.push(movieItems[i]);
  }

  return result;
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text
        className="text-lg text-text-primary"
        style={{ fontFamily: "Courier New", fontWeight: "900" }}
      >
        {title}
      </Text>
      <View className="rounded-md border-2 border-border-bright bg-bg-surface px-3 py-1">
        <Text className="text-[11px] font-black uppercase tracking-wide text-text-secondary">
          {count} titles
        </Text>
      </View>
    </View>
  );
}

export function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("all");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const [gridWidth, setGridWidth] = useState(0);

  // Filter states
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedRating, setSelectedRating] = useState<string>("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const [tvState, setTvState] = useState<TabState>({
    items: [],
    isLoading: true,
    isLoadingMore: false,
    error: null,
    currentPage: 0,
    hasMore: true,
  });
  const [animeState, setAnimeState] = useState<TabState>({
    items: [],
    isLoading: true,
    isLoadingMore: false,
    error: null,
    currentPage: 0,
    hasMore: true,
  });
  const [movieState, setMovieState] = useState<TabState>({
    items: [],
    isLoading: true,
    isLoadingMore: false,
    error: null,
    currentPage: 0,
    hasMore: true,
  });

  const trackedLibrary = useQuery(api.shows.getLibrary, {});
  const trackedTmdbKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of trackedLibrary ?? []) {
      if (
        (item.mediaType === "tv" || item.mediaType === "movie") &&
        typeof item.tmdbId === "number"
      ) {
        keys.add(toTrackedTmdbKey(item.mediaType, item.tmdbId));
      }
    }
    return keys;
  }, [trackedLibrary]);
  const isTrackedLibraryLoading = trackedLibrary === undefined;

  const allTabItems = useMemo(
    () => interleaveDiscoverItems(tvState.items, animeState.items, movieState.items),
    [animeState.items, movieState.items, tvState.items]
  );

  const activeState = useMemo(() => {
    if (activeTab === "all") {
      const isLoading = tvState.isLoading || animeState.isLoading || movieState.isLoading;
      const isLoadingMore = tvState.isLoadingMore || animeState.isLoadingMore || movieState.isLoadingMore;
      const error = tvState.error || animeState.error || movieState.error;
      return {
        items: allTabItems,
        isLoading,
        isLoadingMore,
        error,
        currentPage: Math.max(tvState.currentPage, animeState.currentPage, movieState.currentPage),
        hasMore: tvState.hasMore || animeState.hasMore || movieState.hasMore,
      };
    }
    if (activeTab === "anime") return animeState;
    if (activeTab === "movie") return movieState;
    return tvState;
  }, [activeTab, allTabItems, animeState, movieState, tvState]);

  const setActiveState = useCallback(
    (updater: (prev: TabState) => TabState) => {
      if (activeTab === "all") {
        setTvState(updater);
        setAnimeState(updater);
        setMovieState(updater);
      } else if (activeTab === "anime") {
        setAnimeState(updater);
      } else if (activeTab === "movie") {
        setMovieState(updater);
      } else {
        setTvState(updater);
      }
    },
    [activeTab]
  );

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  const effectiveWidth = gridWidth || Math.max(width - 40, 0);
  const columns = getGridColumnCount(effectiveWidth, isWeb);
  const gridItemWidth = (effectiveWidth - (columns - 1) * GRID_GAP) / columns;

  // Get filter options for current tab
  const availableFilters = useMemo(
    () => getFiltersForMediaType(activeTab),
    [activeTab]
  );

  const genreOptions = useMemo(
    () => availableFilters.find((f) => f.id === "genres")?.options || [],
    [availableFilters]
  );
  const yearOptions = useMemo(
    () => availableFilters.find((f) => f.id === "year")?.options || [],
    [availableFilters]
  );
  const ratingOptions = useMemo(
    () => availableFilters.find((f) => f.id === "minRating")?.options || [],
    [availableFilters]
  );

  const hasActiveFilters = useMemo(
    () =>
      selectedGenres.length > 0 ||
      selectedYear !== "" ||
      selectedRating !== "",
    [selectedGenres, selectedYear, selectedRating]
  );

  const clearFilters = () => {
    setSelectedGenres([]);
    setSelectedYear("");
    setSelectedRating("");
    setOpenDropdown(null);
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  useEffect(() => {
    if (isTrackedLibraryLoading) {
      return;
    }

    let isCancelled = false;

    const loadInitialData = async () => {
      // TV Shows
      try {
        let tvItems: NormalizedShow[] = [];
        let tvHasMore = true;
        let tvPage = 1;

        if (hasActiveFilters) {
          const filters: TmdbFilterParams = {
            with_genres: selectedGenres.join(","),
            first_air_date_year: selectedYear ? Number(selectedYear) : undefined,
            vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
          };
          const result = await discoverTmdb("tv", 1, filters);
          tvItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
          tvHasMore = result.page < result.totalPages;
        } else {
          const result = await getTrendingTmdb("tv", "week", 1);
          tvItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
          tvHasMore = result.page < result.totalPages;
        }

        if (!isCancelled) {
          setTvState({
            items: tvItems,
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: tvPage,
            hasMore: tvHasMore,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setTvState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load TV shows."),
            currentPage: 0,
            hasMore: true,
          });
        }
      }

      // Anime
      try {
        let animeItems: NormalizedShow[] = [];
        let animeHasMore = true;
        let animePage = 1;

        if (hasActiveFilters) {
          const filters = {
            genres: selectedGenres.length > 0 ? selectedGenres : undefined,
            seasonYear: selectedYear ? Number(selectedYear) : undefined,
            minScore: selectedRating ? Number(selectedRating) * 10 : undefined,
          };
          const result = await searchAniList("", 1, INITIAL_ITEMS_PER_PAGE, filters);
          animeItems = result.items;
          animeHasMore = result.pageInfo.currentPage < result.pageInfo.lastPage;
        } else {
          const result = await getTrendingAniList(1, INITIAL_ITEMS_PER_PAGE);
          animeItems = result.items;
          animeHasMore = result.pageInfo.currentPage < result.pageInfo.lastPage;
        }

        if (!isCancelled) {
          setAnimeState({
            items: animeItems,
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: animePage,
            hasMore: animeHasMore,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setAnimeState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load anime."),
            currentPage: 0,
            hasMore: true,
          });
        }
      }

      // Movies
      try {
        let movieItems: NormalizedShow[] = [];
        let movieHasMore = true;
        let moviePage = 1;

        if (hasActiveFilters) {
          const filters: TmdbFilterParams = {
            with_genres: selectedGenres.join(","),
            primary_release_year: selectedYear ? Number(selectedYear) : undefined,
            vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
          };
          const result = await discoverTmdb("movie", 1, filters);
          movieItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
          movieHasMore = result.page < result.totalPages;
        } else {
          const result = await getTrendingTmdb("movie", "week", 1);
          movieItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
          movieHasMore = result.page < result.totalPages;
        }

        if (!isCancelled) {
          setMovieState({
            items: movieItems,
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: moviePage,
            hasMore: movieHasMore,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setMovieState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load movies."),
            currentPage: 0,
            hasMore: true,
          });
        }
      }
    };

    void loadInitialData();
    return () => {
      isCancelled = true;
    };
  }, [
    hasActiveFilters,
    isTrackedLibraryLoading,
    selectedGenres,
    selectedRating,
    selectedYear,
    trackedTmdbKeys,
  ]);

  const loadMoreItems = useCallback(async () => {
    if (activeState.isLoading || activeState.isLoadingMore || !activeState.hasMore) {
      return;
    }

    setActiveState((prev) => ({ ...prev, isLoadingMore: true }));

    const nextPage = activeState.currentPage + 1;

    try {
      if (activeTab === "all") {
        // Fetch each category independently with error handling for partial success
        let tvResult: { items: any[]; page: number; totalPages: number } | null = null;
        let animeResult: { items: any[]; pageInfo: { currentPage: number; lastPage: number } } | null = null;
        let movieResult: { items: any[]; page: number; totalPages: number } | null = null;

        // Only fetch TV if hasMore is true
        if (tvState.hasMore) {
          try {
            tvResult = hasActiveFilters
              ? await discoverTmdb("tv", nextPage, {
                  with_genres: selectedGenres.join(","),
                  first_air_date_year: selectedYear ? Number(selectedYear) : undefined,
                  vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
                })
              : await getTrendingTmdb("tv", "week", nextPage);
          } catch (err) {
            console.warn("Failed to fetch TV shows:", err);
          }
        }

        // Only fetch Anime if hasMore is true
        if (animeState.hasMore) {
          try {
            animeResult = hasActiveFilters
              ? await searchAniList("", nextPage, INITIAL_ITEMS_PER_PAGE, {
                  genres: selectedGenres.length > 0 ? selectedGenres : undefined,
                  seasonYear: selectedYear ? Number(selectedYear) : undefined,
                  minScore: selectedRating ? Number(selectedRating) * 10 : undefined,
                })
              : await getTrendingAniList(nextPage, INITIAL_ITEMS_PER_PAGE);
          } catch (err) {
            console.warn("Failed to fetch anime:", err);
          }
        }

        // Only fetch Movies if hasMore is true
        if (movieState.hasMore) {
          try {
            movieResult = hasActiveFilters
              ? await discoverTmdb("movie", nextPage, {
                  with_genres: selectedGenres.join(","),
                  primary_release_year: selectedYear ? Number(selectedYear) : undefined,
                  vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
                })
              : await getTrendingTmdb("movie", "week", nextPage);
          } catch (err) {
            console.warn("Failed to fetch movies:", err);
          }
        }

        // Update state for each category that returned results
        if (tvResult) {
          const newTvItems = filterTrackedTmdbItems(tvResult.items, trackedTmdbKeys);
          setTvState((prev) => ({
            ...prev,
            items: [...prev.items, ...newTvItems],
            currentPage: nextPage,
            hasMore: tvResult!.page < tvResult!.totalPages,
          }));
        }

        if (animeResult) {
          const newAnimeItems = animeResult.items;
          setAnimeState((prev) => ({
            ...prev,
            items: [...prev.items, ...newAnimeItems],
            currentPage: nextPage,
            hasMore: animeResult!.pageInfo.currentPage < animeResult!.pageInfo.lastPage,
          }));
        }

        if (movieResult) {
          const newMovieItems = filterTrackedTmdbItems(movieResult.items, trackedTmdbKeys);
          setMovieState((prev) => ({
            ...prev,
            items: [...prev.items, ...newMovieItems],
            currentPage: nextPage,
            hasMore: movieResult!.page < movieResult!.totalPages,
          }));
        }

        setActiveState((prev) => ({
          ...prev,
          isLoadingMore: false,
        }));
      } else if (activeTab === "anime") {
        let result;
        if (hasActiveFilters) {
          const filters = {
            genres: selectedGenres.length > 0 ? selectedGenres : undefined,
            seasonYear: selectedYear ? Number(selectedYear) : undefined,
            minScore: selectedRating ? Number(selectedRating) * 10 : undefined,
          };
          result = await searchAniList("", nextPage, INITIAL_ITEMS_PER_PAGE, filters);
        } else {
          result = await getTrendingAniList(nextPage, INITIAL_ITEMS_PER_PAGE);
        }
        const newItems = result.items;
        setAnimeState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.pageInfo.currentPage < result.pageInfo.lastPage,
        }));
      } else if (activeTab === "movie") {
        let result;
        if (hasActiveFilters) {
          const filters: TmdbFilterParams = {
            with_genres: selectedGenres.join(","),
            primary_release_year: selectedYear ? Number(selectedYear) : undefined,
            vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
          };
          result = await discoverTmdb("movie", nextPage, filters);
        } else {
          result = await getTrendingTmdb("movie", "week", nextPage);
        }
        const newItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
        setMovieState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.page < result.totalPages,
        }));
      } else {
        let result;
        if (hasActiveFilters) {
          const filters: TmdbFilterParams = {
            with_genres: selectedGenres.join(","),
            first_air_date_year: selectedYear ? Number(selectedYear) : undefined,
            vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
          };
          result = await discoverTmdb("tv", nextPage, filters);
        } else {
          result = await getTrendingTmdb("tv", "week", nextPage);
        }
        const newItems = filterTrackedTmdbItems(result.items, trackedTmdbKeys);
        setTvState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.page < result.totalPages,
        }));
      }
    } catch (error) {
      setActiveState((prev) => ({
        ...prev,
        isLoadingMore: false,
        error: getSectionError(
          error,
          `Could not load more ${
            activeTab === "anime"
              ? "anime"
              : activeTab === "movie"
                ? "movies"
                : activeTab === "all"
                  ? "content"
                  : "TV shows"
          }.`
        ),
      }));
    }
  }, [
    activeState,
    activeTab,
    animeState.hasMore,
    hasActiveFilters,
    movieState.hasMore,
    selectedGenres,
    selectedRating,
    selectedYear,
    setActiveState,
    setTvState,
    setAnimeState,
    setMovieState,
    trackedTmdbKeys,
    tvState.hasMore,
  ]);

  const heroShow = activeState.items[0] ?? null;

  const renderItem = useCallback(
    ({ item, index }: { item: NormalizedShow; index: number }) => (
      <View
        style={{
          width: gridItemWidth,
          marginRight: index % columns === columns - 1 ? 0 : GRID_GAP,
          marginBottom: GRID_GAP,
        }}
      >
        <MediaPosterCard
          show={item}
          href={{ pathname: "/show/[id]", params: { id: createShowRouteId(item) } }}
          rank={index < 3 ? index + 1 : undefined}
          className="w-full"
          posterClassName={isWeb ? "h-56" : "h-64"}
        />
      </View>
    ),
    [gridItemWidth, columns, isWeb]
  );

  const renderFooter = useCallback(() => {
    if (!activeState.isLoadingMore) return null;
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color="#ef4444" />
      </View>
    );
  }, [activeState.isLoadingMore]);

  const renderEmpty = useCallback(() => {
    if (activeState.isLoading) {
      return (
        <View className="items-center gap-2 rounded-xl border-2 border-border-default bg-bg-surface py-8">
          <ActivityIndicator size="small" color="#ef4444" />
          <Text className="text-sm text-text-secondary">Loading trending titles</Text>
        </View>
      );
    }

    if (activeState.error) {
      return (
        <View className="mb-4 rounded-xl border-2 border-primary/30 bg-primary/10 p-4">
          <Text className="text-sm text-primary">{activeState.error}</Text>
        </View>
      );
    }

    return (
      <View className="mt-5 rounded-xl border-2 border-border-default bg-bg-surface px-4 py-5">
        <Text className="text-sm text-text-secondary">
          No discovery data available right now.
        </Text>
      </View>
    );
  }, [activeState.isLoading, activeState.error]);

  const ListHeader = useCallback(
    () => (
      <View>
        <PageIntro
          title="Discover"
          subtitle={hasActiveFilters ? "Filtered results" : "Trending across TV, anime, and movies"}
          eyebrow={hasActiveFilters ? "Filtered" : "Fresh picks"}
          icon="compass-outline"
          rightLabel={
            activeState.items.length > 0 ? `${activeState.items.length} live` : undefined
          }
          className="mb-4"
        />

        {!isDesktop ? (
          <Link href="/search" asChild>
            <Pressable className="mb-4 flex-row items-center gap-3 rounded-xl border-2 border-border-default bg-bg-surface px-3 py-2.5">
              <View className="h-8 w-8 items-center justify-center rounded-lg bg-bg-base/70">
                <Feather name="search" size={15} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-text-primary">Search</Text>
                <Text className="text-xs text-text-secondary">Find shows, anime, and movies</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#71717a" />
            </Pressable>
          </Link>
        ) : null}

        {heroShow && !hasActiveFilters ? (
          <View className="mb-5 overflow-hidden rounded-xl border-2 border-border-default">
            <HeroSection
              imageUrl={heroShow.backdropUrl ?? heroShow.posterUrl}
              title={heroShow.title}
              subtitle={heroShow.overview ?? undefined}
              mobileHeight={180}
            >
              <Link
                href={{
                  pathname: "/show/[id]",
                  params: { id: createShowRouteId(heroShow) },
                }}
                asChild
              >
                <Button label="View Details" variant="primary" className="self-start" />
              </Link>
            </HeroSection>
          </View>
        ) : null}

        <SegmentedControl
          options={tabOptions}
          value={activeTab}
          onValueChange={(newTab) => {
            setActiveTab(newTab);
            clearFilters();
          }}
          className="mb-3"
        />

        {/* Filter Buttons */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          className="mb-2"
        >
          {genreOptions.length > 0 && (
            <Pressable
              onPress={() => setOpenDropdown(openDropdown === "genres" ? null : "genres")}
              className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${
                selectedGenres.length > 0
                  ? "border-primary bg-primary"
                  : "border-border-default bg-bg-surface"
              }`}
            >
              <Text className={`text-sm font-semibold ${selectedGenres.length > 0 ? "text-white" : "text-text-secondary"}`}>
                {selectedGenres.length > 0 ? `${selectedGenres.length} Genre${selectedGenres.length > 1 ? "s" : ""}` : "Genre"}
              </Text>
              <Text className={selectedGenres.length > 0 ? "text-white" : "text-text-secondary"}>
                {openDropdown === "genres" ? "▲" : "▼"}
              </Text>
            </Pressable>
          )}

          {yearOptions.length > 0 && (
            <Pressable
              onPress={() => setOpenDropdown(openDropdown === "year" ? null : "year")}
              className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${
                selectedYear ? "border-primary bg-primary" : "border-border-default bg-bg-surface"
              }`}
            >
              <Text className={`text-sm font-semibold ${selectedYear ? "text-white" : "text-text-secondary"}`}>
                {selectedYear || "Year"}
              </Text>
              <Text className={selectedYear ? "text-white" : "text-text-secondary"}>
                {openDropdown === "year" ? "▲" : "▼"}
              </Text>
            </Pressable>
          )}

          {ratingOptions.length > 0 && (
            <Pressable
              onPress={() => setOpenDropdown(openDropdown === "rating" ? null : "rating")}
              className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${
                selectedRating ? "border-primary bg-primary" : "border-border-default bg-bg-surface"
              }`}
            >
              <Text className={`text-sm font-semibold ${selectedRating ? "text-white" : "text-text-secondary"}`}>
                {selectedRating ? `${selectedRating}+ ⭐` : "Rating"}
              </Text>
              <Text className={selectedRating ? "text-white" : "text-text-secondary"}>
                {openDropdown === "rating" ? "▲" : "▼"}
              </Text>
            </Pressable>
          )}

          {hasActiveFilters && (
            <Pressable
              onPress={clearFilters}
              className="rounded-full border border-border-default bg-bg-surface px-4 py-2"
            >
              <Text className="text-sm font-semibold text-text-secondary">Clear</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Dropdown Content */}
        {openDropdown === "genres" && genreOptions.length > 0 && (
          <View className="mb-4 rounded-xl border border-border-default bg-bg-surface p-3">
            <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Select Genres</Text>
            <View className="flex-row flex-wrap gap-2">
              {genreOptions.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => toggleGenre(option.value)}
                  className={`rounded-full border px-3 py-1.5 ${
                    selectedGenres.includes(option.value)
                      ? "border-primary bg-primary"
                      : "border-border-default bg-bg-primary"
                  }`}
                >
                  <Text className={`text-xs ${selectedGenres.includes(option.value) ? "text-white" : "text-text-secondary"}`}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {openDropdown === "year" && yearOptions.length > 0 && (
          <View className="mb-4 rounded-xl border border-border-default bg-bg-surface p-3">
            <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Select Year</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => { setSelectedYear(""); setOpenDropdown(null); }}
                  className={`rounded-full border px-4 py-2 ${!selectedYear ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                >
                  <Text className={`text-sm ${!selectedYear ? "text-white" : "text-text-secondary"}`}>Any</Text>
                </Pressable>
                {yearOptions.slice(0, 15).map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => { setSelectedYear(option.value); setOpenDropdown(null); }}
                    className={`rounded-full border px-4 py-2 ${selectedYear === option.value ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                  >
                    <Text className={`text-sm ${selectedYear === option.value ? "text-white" : "text-text-secondary"}`}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {openDropdown === "rating" && ratingOptions.length > 0 && (
          <View className="mb-4 rounded-xl border border-border-default bg-bg-surface p-3">
            <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Min Rating</Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => { setSelectedRating(""); setOpenDropdown(null); }}
                className={`flex-1 rounded-lg border py-2 ${!selectedRating ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
              >
                <Text className={`text-center text-sm ${!selectedRating ? "text-white" : "text-text-secondary"}`}>Any</Text>
              </Pressable>
              {ratingOptions.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => { setSelectedRating(option.value); setOpenDropdown(null); }}
                  className={`flex-1 rounded-lg border py-2 ${selectedRating === option.value ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                >
                  <Text className={`text-center text-sm ${selectedRating === option.value ? "text-white" : "text-text-secondary"}`}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Active Filter Tags */}
        {hasActiveFilters && (
          <View className="mb-3 flex-row flex-wrap gap-2">
            {selectedGenres.map((genre) => (
              <Pressable
                key={genre}
                onPress={() => toggleGenre(genre)}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1"
              >
                <Text className="text-xs font-medium text-white">
                  {genreOptions.find((g) => g.value === genre)?.label || genre}
                </Text>
                <Text className="text-xs text-white">×</Text>
              </Pressable>
            ))}
            {selectedYear && (
              <Pressable
                onPress={() => setSelectedYear("")}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1"
              >
                <Text className="text-xs font-medium text-white">{selectedYear}</Text>
                <Text className="text-xs text-white">×</Text>
              </Pressable>
            )}
            {selectedRating && (
              <Pressable
                onPress={() => setSelectedRating("")}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1"
              >
                <Text className="text-xs font-medium text-white">{selectedRating}+ ⭐</Text>
                <Text className="text-xs text-white">×</Text>
              </Pressable>
            )}
          </View>
        )}

        {activeState.items.length > 0 ? (
          <SectionHeader
            title={hasActiveFilters ? "Filtered Results" : `Trending ${
              activeTab === "anime"
                ? "Anime"
                : activeTab === "movie"
                  ? "Movies"
                  : activeTab === "tv"
                    ? "TV Shows"
                    : "Content"
            }`}
            count={activeState.items.length}
          />
        ) : null}
      </View>
    ),
    [
      heroShow,
      activeTab,
      activeState.items.length,
      hasActiveFilters,
      isDesktop,
      selectedGenres,
      selectedYear,
      selectedRating,
      openDropdown,
      genreOptions,
      yearOptions,
      ratingOptions,
    ]
  );

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={onGridLayout}>
        <FlashList
          data={activeState.items}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id}-${activeTab}-${index}`}
          key={`discover-grid-${columns}`}
          numColumns={columns}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMoreItems}
          onEndReachedThreshold={LOAD_MORE_THRESHOLD}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      </View>
    </ScreenWrapper>
  );
}

export default DiscoverScreen;
