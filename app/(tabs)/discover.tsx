import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { HeroSection } from "@/components/HeroSection";
import { Button } from "@/components/Button";
import { PageIntro } from "@/components/PageIntro";
import { getTrendingAniList } from "@/lib/api/anilist";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { getTrendingTmdb } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";
import { Link } from "expo-router";

type DiscoverTab = "tv" | "anime" | "movie";

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

const tabOptions = [
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

const GRID_GAP = 12;

function getSectionError(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason !== null && "status" in reason) {
    return `${fallback} (API ${(reason as { status: number }).status})`;
  }
  return fallback;
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
        <Text className="text-[11px] font-black uppercase tracking-wide text-text-secondary">{count} titles</Text>
      </View>
    </View>
  );
}

export function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("tv");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const [gridWidth, setGridWidth] = useState(0);

  // Tab states
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

  const activeState = useMemo(() => {
    if (activeTab === "anime") return animeState;
    if (activeTab === "movie") return movieState;
    return tvState;
  }, [activeTab, animeState, movieState, tvState]);

  const setActiveState = useCallback(
    (updater: (prev: TabState) => TabState) => {
      if (activeTab === "anime") {
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

  // Calculate grid dimensions
  const effectiveWidth = gridWidth || Math.max(width - 40, 0);
  const columns = getGridColumnCount(effectiveWidth, isWeb);
  const gridItemWidth = (effectiveWidth - (columns - 1) * GRID_GAP) / columns;

  // Load initial data for all tabs
  useEffect(() => {
    let isCancelled = false;

    const loadInitialData = async () => {
      // Load TV Shows
      try {
        const tvResult = await getTrendingTmdb("tv", "week", 1);
        if (!isCancelled) {
          setTvState({
            items: tvResult.results.map(normalizeTmdbMedia),
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: 1,
            hasMore: tvResult.page < tvResult.total_pages,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setTvState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load trending TV shows."),
            currentPage: 0,
            hasMore: true,
          });
        }
      }

      // Load Anime
      try {
        const animeResult = await getTrendingAniList(1, INITIAL_ITEMS_PER_PAGE);
        if (!isCancelled) {
          setAnimeState({
            items: animeResult.data.Page.media.map(normalizeAniListMedia),
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: 1,
            hasMore: animeResult.data.Page.pageInfo.currentPage < animeResult.data.Page.pageInfo.lastPage,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setAnimeState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load trending anime."),
            currentPage: 0,
            hasMore: true,
          });
        }
      }

      // Load Movies
      try {
        const movieResult = await getTrendingTmdb("movie", "week", 1);
        if (!isCancelled) {
          setMovieState({
            items: movieResult.results.map(normalizeTmdbMedia),
            isLoading: false,
            isLoadingMore: false,
            error: null,
            currentPage: 1,
            hasMore: movieResult.page < movieResult.total_pages,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setMovieState({
            items: [],
            isLoading: false,
            isLoadingMore: false,
            error: getSectionError(error, "Could not load popular movies."),
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
  }, []);

  // Load more items when scrolling
  const loadMoreItems = useCallback(async () => {
    if (activeState.isLoading || activeState.isLoadingMore || !activeState.hasMore) {
      return;
    }

    setActiveState((prev) => ({ ...prev, isLoadingMore: true }));

    const nextPage = activeState.currentPage + 1;

    try {
      if (activeTab === "anime") {
        const result = await getTrendingAniList(nextPage, INITIAL_ITEMS_PER_PAGE);
        const newItems = result.data.Page.media.map(normalizeAniListMedia);
        setAnimeState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.data.Page.pageInfo.currentPage < result.data.Page.pageInfo.lastPage,
        }));
      } else if (activeTab === "movie") {
        const result = await getTrendingTmdb("movie", "week", nextPage);
        const newItems = result.results.map(normalizeTmdbMedia);
        setMovieState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.page < result.total_pages,
        }));
      } else {
        // TV Shows
        const result = await getTrendingTmdb("tv", "week", nextPage);
        const newItems = result.results.map(normalizeTmdbMedia);
        setTvState((prev) => ({
          ...prev,
          items: [...prev.items, ...newItems],
          isLoadingMore: false,
          currentPage: nextPage,
          hasMore: result.page < result.total_pages,
        }));
      }
    } catch (error) {
      setActiveState((prev) => ({
        ...prev,
        isLoadingMore: false,
        error: getSectionError(error, `Could not load more ${activeTab === "anime" ? "anime" : activeTab === "movie" ? "movies" : "TV shows"}.`),
      }));
    }
  }, [activeState, activeTab, setActiveState]);

  // Hero show for active tab
  const heroShow = activeState.items[0] ?? null;

  // Render grid item
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

  // Render footer loader
  const renderFooter = useCallback(() => {
    if (!activeState.isLoadingMore) return null;
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color="#ef4444" />
      </View>
    );
  }, [activeState.isLoadingMore]);

  // Empty state
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
        <Text className="text-sm text-text-secondary">No discovery data available right now.</Text>
      </View>
    );
  }, [activeState.isLoading, activeState.error]);

  // List header component
  const ListHeader = useCallback(
    () => (
      <View>
        <PageIntro
          title="Discover"
          subtitle="Trending across TV, anime, and movies"
          eyebrow="Fresh picks"
          icon="compass-outline"
          rightLabel={activeState.items.length > 0 ? `${activeState.items.length} live` : undefined}
          className="mb-4"
        />

        {/* Hero banner */}
        {heroShow ? (
          <View className="mb-5 overflow-hidden rounded-xl border-2 border-border-default">
            <HeroSection
              imageUrl={heroShow.backdropUrl ?? heroShow.posterUrl}
              title={heroShow.title}
              subtitle={heroShow.overview ?? undefined}
              mobileHeight={180}
            >
              <Link href={{ pathname: "/show/[id]", params: { id: createShowRouteId(heroShow) } }} asChild>
                <Button label="View Details" variant="primary" className="self-start" />
              </Link>
            </HeroSection>
          </View>
        ) : null}

        <SegmentedControl options={tabOptions} value={activeTab} onValueChange={setActiveTab} className="mb-5" />

        {activeState.items.length > 0 && (
          <SectionHeader
            title={`Trending ${activeTab === "anime" ? "Anime" : activeTab === "movie" ? "Movies" : "TV Shows"}`}
            count={activeState.items.length}
          />
        )}
      </View>
    ),
    [heroShow, activeTab, activeState.items.length]
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
