import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { HeroSection } from "@/components/HeroSection";
import { Button } from "@/components/Button";
import { PageIntro } from "@/components/PageIntro";
import { getTrendingAniList } from "@/lib/api/anilist";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { getTrendingTmdb, type TmdbMedia, type TmdbSearchResult } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";
import { Link } from "expo-router";

type DiscoverTab = "tv" | "anime" | "movie";

type SectionState = {
  isLoading: boolean;
  error: string | null;
  items: NormalizedShow[];
};

const initialSectionState: SectionState = { isLoading: true, error: null, items: [] };

function getSectionError(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason !== null && "status" in reason) {
    return `${fallback} (API ${(reason as { status: number }).status})`;
  }
  return fallback;
}

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
const DISCOVER_MAX_ITEMS = 60;
const TMDB_DISCOVER_PAGES = [1, 2, 3] as const;

function flattenTmdbTrendingPages(results: PromiseSettledResult<TmdbSearchResult>[]) {
  const deduped = new Map<number, TmdbMedia>();

  results.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }
    result.value.results.forEach((item) => {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    });
  });

  return Array.from(deduped.values()).slice(0, DISCOVER_MAX_ITEMS);
}

function getFirstRejectedReason(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  return rejected?.reason;
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text className="text-lg font-bold text-text-primary">
        {title}
      </Text>
      <View className="rounded-full border border-border-default bg-bg-surface px-3 py-1">
        <Text className="text-xs font-semibold text-text-secondary">{count} titles</Text>
      </View>
    </View>
  );
}

export default function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("tv");
  const [visibleCountByTab, setVisibleCountByTab] = useState<Record<DiscoverTab, number>>({
    tv: 0,
    anime: 0,
    movie: 0,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const [gridWidth, setGridWidth] = useState(0);
  const [tvState, setTvState] = useState<SectionState>(initialSectionState);
  const [animeState, setAnimeState] = useState<SectionState>(initialSectionState);
  const [movieState, setMovieState] = useState<SectionState>(initialSectionState);
  const canLoadMoreFromEdgeRef = useRef(true);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadDiscovery = async () => {
      setTvState(initialSectionState);
      setAnimeState(initialSectionState);
      setMovieState(initialSectionState);

      const [tvBatch, animeResult, movieBatch] = await Promise.allSettled([
        Promise.allSettled(TMDB_DISCOVER_PAGES.map((page) => getTrendingTmdb("tv", "week", page))),
        getTrendingAniList(1, 50),
        Promise.allSettled(TMDB_DISCOVER_PAGES.map((page) => getTrendingTmdb("movie", "week", page))),
      ]);

      if (isCancelled) return;

      if (tvBatch.status === "fulfilled") {
        const mergedTv = flattenTmdbTrendingPages(tvBatch.value);
        if (mergedTv.length > 0) {
          setTvState({ isLoading: false, error: null, items: mergedTv.map(normalizeTmdbMedia) });
        } else {
          setTvState({
            isLoading: false,
            error: getSectionError(getFirstRejectedReason(tvBatch.value), "Could not load trending TV shows."),
            items: [],
          });
        }
      } else {
        setTvState({
          isLoading: false,
          error: getSectionError(tvBatch.reason, "Could not load trending TV shows."),
          items: [],
        });
      }

      if (animeResult.status === "fulfilled") {
        setAnimeState({
          isLoading: false,
          error: null,
          items: animeResult.value.data.Page.media.slice(0, DISCOVER_MAX_ITEMS).map(normalizeAniListMedia),
        });
      } else {
        setAnimeState({
          isLoading: false,
          error: getSectionError(animeResult.reason, "Could not load trending anime."),
          items: [],
        });
      }

      if (movieBatch.status === "fulfilled") {
        const mergedMovies = flattenTmdbTrendingPages(movieBatch.value);
        if (mergedMovies.length > 0) {
          setMovieState({ isLoading: false, error: null, items: mergedMovies.map(normalizeTmdbMedia) });
        } else {
          setMovieState({
            isLoading: false,
            error: getSectionError(getFirstRejectedReason(movieBatch.value), "Could not load popular movies."),
            items: [],
          });
        }
      } else {
        setMovieState({
          isLoading: false,
          error: getSectionError(movieBatch.reason, "Could not load popular movies."),
          items: [],
        });
      }
    };

    void loadDiscovery();
    return () => { isCancelled = true; };
  }, []);

  const activeState = useMemo(() => {
    if (activeTab === "anime") return animeState;
    if (activeTab === "movie") return movieState;
    return tvState;
  }, [activeTab, animeState, movieState, tvState]);

  const heroShow = activeState.items[0] ?? null;
  // Use measured grid width when available.
  // On first render, approximate by removing ScreenWrapper horizontal padding.
  const effectiveWidth = gridWidth || Math.max(width - 40, 0);
  const columns = getGridColumnCount(effectiveWidth, isWeb);
  const gridItemWidth = (effectiveWidth - (columns - 1) * GRID_GAP) / columns;
  const pageSize = Math.max(columns * 3, 6);
  const activeVisibleCount = visibleCountByTab[activeTab] ?? 0;
  const visibleDiscoverItems = activeState.items.slice(0, activeVisibleCount);
  const hasMoreItems = activeVisibleCount < activeState.items.length;

  useEffect(() => {
    setVisibleCountByTab((previous) => {
      const current = previous[activeTab] ?? 0;
      const next = Math.min(activeState.items.length, Math.max(current, pageSize));
      if (next === current) return previous;
      return { ...previous, [activeTab]: next };
    });
    setIsLoadingMore(false);
    canLoadMoreFromEdgeRef.current = true;
  }, [activeState.items.length, activeTab, pageSize]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  const loadMoreItems = useCallback(() => {
    if (!hasMoreItems || isLoadingMore || activeState.isLoading) {
      return;
    }

    setIsLoadingMore(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleCountByTab((previous) => ({
        ...previous,
        [activeTab]: Math.min((previous[activeTab] ?? 0) + pageSize, activeState.items.length),
      }));
      setIsLoadingMore(false);
    }, 120);
  }, [activeState.isLoading, activeState.items.length, activeTab, hasMoreItems, isLoadingMore, pageSize]);

  const onScrollDiscover = useCallback(
    (event: any) => {
      const y = event.nativeEvent.contentOffset.y;
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight = event.nativeEvent.contentSize.height;
      const distanceFromBottom = contentHeight - (y + viewportHeight);

      if (distanceFromBottom > 320) {
        canLoadMoreFromEdgeRef.current = true;
      }

      if (
        distanceFromBottom <= 200 &&
        canLoadMoreFromEdgeRef.current &&
        !activeState.isLoading &&
        !isLoadingMore
      ) {
        canLoadMoreFromEdgeRef.current = false;
        loadMoreItems();
      }
    },
    [activeState.isLoading, isLoadingMore, loadMoreItems]
  );

  return (
    <ScreenWrapper>
      <ScrollView showsVerticalScrollIndicator={false} onScroll={onScrollDiscover} scrollEventThrottle={16}>
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
            <View className="mb-5 overflow-hidden rounded-2xl border border-border-default">
              <HeroSection
                imageUrl={heroShow.backdropUrl ?? heroShow.posterUrl}
                title={heroShow.title}
                subtitle={heroShow.overview ?? undefined}
                mobileHeight={180}
              >
                <Link
                  href={{ pathname: "/show/[id]", params: { id: createShowRouteId(heroShow) } }}
                  asChild
                >
                  <Button label="View Details" variant="primary" className="self-start" />
                </Link>
              </HeroSection>
            </View>
          ) : null}

          <SegmentedControl options={tabOptions} value={activeTab} onValueChange={setActiveTab} className="mb-5" />

          {activeState.isLoading ? (
            <View className="items-center gap-2 rounded-2xl border border-border-default bg-bg-surface py-8">
              <ActivityIndicator size="small" color="#ef4444" />
              <Text className="text-sm text-text-secondary">Loading trending titles</Text>
            </View>
          ) : null}

          {activeState.error ? (
            <View className="mb-4 rounded-2xl border border-primary/30 bg-primary/10 p-4">
              <Text className="text-sm text-primary">{activeState.error}</Text>
            </View>
          ) : null}

          {!activeState.isLoading && activeState.items.length > 0 ? (
            <>
              <SectionHeader
                title={`Trending ${activeTab === "anime" ? "Anime" : activeTab === "movie" ? "Movies" : "TV Shows"}`}
                count={activeState.items.length}
              />
              <View className="flex-row flex-wrap" onLayout={onGridLayout}>
                {visibleDiscoverItems.map((item, index) => (
                  <View
                    key={`${item.id}-${activeTab}-${index}`}
                    style={{
                      width: gridItemWidth,
                      marginRight:
                        index % columns === columns - 1 || index === visibleDiscoverItems.length - 1
                          ? 0
                          : GRID_GAP,
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
                ))}
              </View>

              {hasMoreItems ? (
                <View className="items-center py-3">
                  <ActivityIndicator size="small" color={isLoadingMore ? "#ef4444" : "#52525b"} />
                </View>
              ) : null}
            </>
          ) : null}

          {!activeState.isLoading && !activeState.error && !activeState.items.length ? (
            <View className="mt-5 rounded-2xl border border-border-default bg-bg-surface px-4 py-5">
              <Text className="text-sm text-text-secondary">No discovery data available right now.</Text>
            </View>
          ) : null}

          <View className="h-8" />
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}
