import { useCallback, useEffect, useMemo, useState } from "react";
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
import { getTrendingAniList } from "@/lib/api/anilist";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { getTrendingTmdb } from "@/lib/api/tmdb";
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

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text className="text-lg font-bold text-text-primary">
        {title}
      </Text>
    </View>
  );
}

export default function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("tv");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const [gridWidth, setGridWidth] = useState(0);
  const [tvState, setTvState] = useState<SectionState>(initialSectionState);
  const [animeState, setAnimeState] = useState<SectionState>(initialSectionState);
  const [movieState, setMovieState] = useState<SectionState>(initialSectionState);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadDiscovery = async () => {
      setTvState(initialSectionState);
      setAnimeState(initialSectionState);
      setMovieState(initialSectionState);

      const [tvResult, animeResult, movieResult] = await Promise.allSettled([
        getTrendingTmdb("tv"),
        getTrendingAniList(1, 24),
        getTrendingTmdb("movie"),
      ]);

      if (isCancelled) return;

      if (tvResult.status === "fulfilled") {
        setTvState({ isLoading: false, error: null, items: tvResult.value.results.slice(0, 24).map(normalizeTmdbMedia) });
      } else {
        setTvState({ isLoading: false, error: getSectionError(tvResult.reason, "Could not load trending TV shows."), items: [] });
      }

      if (animeResult.status === "fulfilled") {
        setAnimeState({ isLoading: false, error: null, items: animeResult.value.data.Page.media.slice(0, 24).map(normalizeAniListMedia) });
      } else {
        setAnimeState({ isLoading: false, error: getSectionError(animeResult.reason, "Could not load trending anime."), items: [] });
      }

      if (movieResult.status === "fulfilled") {
        setMovieState({ isLoading: false, error: null, items: movieResult.value.results.slice(0, 24).map(normalizeTmdbMedia) });
      } else {
        setMovieState({ isLoading: false, error: getSectionError(movieResult.reason, "Could not load popular movies."), items: [] });
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
  // Use measured grid width (accounts for scrollbar, sidebar, padding)
  // Fall back to window width estimate before first layout
  const effectiveWidth = gridWidth || width;
  const columns = getGridColumnCount(effectiveWidth, isWeb);
  const gridItemWidth = gridWidth
    ? Math.floor((gridWidth - (columns - 1) * GRID_GAP) / columns)
    : Math.floor((effectiveWidth / (columns + 0.5))); // conservative fallback

  return (
    <ScreenWrapper contentClassName="px-0 py-0">
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero banner */}
        {heroShow ? (
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
        ) : null}

        <View className="px-4 pt-4">
          <Text className="mb-1 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
            Discover
          </Text>
          <Text className="mb-4 text-sm text-text-secondary">
            Trending across TV, Anime, and Movies
          </Text>

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
              <SectionHeader title={`Trending ${activeTab === "anime" ? "Anime" : activeTab === "movie" ? "Movies" : "TV Shows"}`} />
              <View className="flex-row flex-wrap gap-3" onLayout={onGridLayout}>
                {activeState.items.map((item, index) => (
                  <View key={`${item.id}-${activeTab}-${index}`} style={isWeb ? { width: gridItemWidth } : { width: "48%" }}>
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
