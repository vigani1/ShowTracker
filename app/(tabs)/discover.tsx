import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  View,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { getTabContentWidth } from "@/constants/navigation";
import { getTrendingAniList } from "@/lib/api/anilist";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { getTrendingTmdb } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";

type DiscoverTab = "tv" | "anime" | "movie";

type SectionState = {
  isLoading: boolean;
  error: string | null;
  items: NormalizedShow[];
};

const initialSectionState: SectionState = {
  isLoading: true,
  error: null,
  items: [],
};

function getSectionError(reason: unknown, fallback: string) {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (
    typeof reason === "object" &&
    reason !== null &&
    "status" in reason &&
    typeof (reason as { status?: unknown }).status === "number"
  ) {
    return `${fallback} (API ${(reason as { status: number }).status})`;
  }

  return fallback;
}

function DiscoverTabs({
  value,
  onChange,
}: {
  value: DiscoverTab;
  onChange: (next: DiscoverTab) => void;
}) {
  return (
    <View className="mb-3 flex-row rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface p-1 dark:border-brand-surface/75 dark:bg-brand-surface/75">
      {([
        { key: "tv", label: "TV Shows" },
        { key: "anime", label: "Anime" },
        { key: "movie", label: "Movies" },
      ] as const).map((tab) => {
        const active = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className={`flex-1 items-center rounded-xl px-2 py-2 ${
              active ? "bg-brand-primary" : "bg-transparent"
            }`}
          >
            <Text
            className={`text-[11px] font-bold uppercase tracking-[1.2px] ${
              active
                ? "text-white"
                : "text-brand-ink dark:text-brand-text"
            }`}
          >
            {tab.label}
          </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function getGridColumnCount(width: number, isWeb: boolean) {
  if (!isWeb) {
    return 2;
  }
  if (width >= 1800) {
    return 8;
  }
  if (width >= 1500) {
    return 7;
  }
  if (width >= 1260) {
    return 6;
  }
  if (width >= 1040) {
    return 5;
  }
  if (width >= 920) {
    return 4;
  }
  return 2;
}

function getGridItemWidth(columns: number) {
  if (columns === 8) {
    return "11.8%";
  }
  if (columns === 7) {
    return "13.7%";
  }
  if (columns === 6) {
    return "15.8%";
  }
  if (columns === 5) {
    return "19%";
  }
  if (columns === 4) {
    return "23.6%";
  }
  if (columns === 3) {
    return "31.8%";
  }
  return "48%";
}

export default function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("tv");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const contentWidth = getTabContentWidth(width, isWeb);
  const [tvState, setTvState] = useState<SectionState>(initialSectionState);
  const [animeState, setAnimeState] = useState<SectionState>(initialSectionState);
  const [movieState, setMovieState] = useState<SectionState>(initialSectionState);

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

      if (isCancelled) {
        return;
      }

      if (tvResult.status === "fulfilled") {
        setTvState({
          isLoading: false,
          error: null,
          items: tvResult.value.results.slice(0, 24).map(normalizeTmdbMedia),
        });
      } else {
        setTvState({
          isLoading: false,
          error: getSectionError(
            tvResult.reason,
            "Could not load trending TV shows right now."
          ),
          items: [],
        });
      }

      if (animeResult.status === "fulfilled") {
        setAnimeState({
          isLoading: false,
          error: null,
          items: animeResult.value.data.Page.media
            .slice(0, 24)
            .map(normalizeAniListMedia),
        });
      } else {
        setAnimeState({
          isLoading: false,
          error: getSectionError(
            animeResult.reason,
            "Could not load trending anime right now."
          ),
          items: [],
        });
      }

      if (movieResult.status === "fulfilled") {
        setMovieState({
          isLoading: false,
          error: null,
          items: movieResult.value.results.slice(0, 24).map(normalizeTmdbMedia),
        });
      } else {
        setMovieState({
          isLoading: false,
          error: getSectionError(
            movieResult.reason,
            "Could not load popular movies right now."
          ),
          items: [],
        });
      }
    };

    void loadDiscovery();

    return () => {
      isCancelled = true;
    };
  }, []);

  const activeState = useMemo(() => {
    if (activeTab === "anime") {
      return animeState;
    }
    if (activeTab === "movie") {
      return movieState;
    }
    return tvState;
  }, [activeTab, animeState, movieState, tvState]);

  const panelTitle =
    activeTab === "anime" ? "Anime" : activeTab === "movie" ? "Movies" : "TV";
  const columns = getGridColumnCount(contentWidth, isWeb);
  const gridItemWidth = getGridItemWidth(columns);
  const showOverview = isWeb && contentWidth >= 1660;

  return (
    <ScreenWrapper>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="pb-0">
          <View className="mb-3 flex-row items-center justify-between px-1">
            <Text className="pt-[4px] text-[10px] font-bold uppercase tracking-[1.5px] text-brand-ink-soft dark:text-[#d8c8ab]">
              Discovery desk
            </Text>
            <Text className="pt-[4px] text-[10px] font-semibold uppercase tracking-[1.4px] text-brand-ink-soft dark:text-[#d8c8ab]">
              {panelTitle}
            </Text>
          </View>

          <DiscoverTabs value={activeTab} onChange={setActiveTab} />

          {activeState.isLoading ? (
            <View className="items-center gap-2 rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface/80 py-8 dark:border-brand-surface/65 dark:bg-brand-surface/70">
              <ActivityIndicator size="small" color="#cf5d3f" />
              <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-brand-ink-soft dark:text-[#d8c8ab]">
                Loading trending titles
              </Text>
            </View>
          ) : null}

          {activeState.error ? (
            <View className="mb-4 rounded-2xl border-2 border-red-400/60 bg-red-500/10 p-4">
              <Text className="text-sm text-red-700 dark:text-red-300">
                {activeState.error}
              </Text>
            </View>
          ) : null}

          <View className="flex-row flex-wrap justify-between gap-y-4">
            {activeState.items.map((item, index) => (
              <MediaPosterCard
                key={`${item.id}-${activeTab}-${index}`}
                show={item}
                href={{
                  pathname: "/show/[id]",
                  params: { id: createShowRouteId(item) },
                }}
                rank={index < 3 ? index + 1 : undefined}
                className={isWeb ? "" : "w-[48%]"}
                containerStyle={isWeb ? { width: gridItemWidth } : undefined}
                posterClassName={isWeb ? "h-56" : "h-64"}
                showOverview={showOverview}
              />
            ))}
          </View>

          {!activeState.isLoading && !activeState.error && !activeState.items.length ? (
            <View className="mt-5 rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface px-4 py-5 dark:border-brand-surface/65 dark:bg-brand-surface/70">
              <Text className="text-sm text-brand-ink-soft dark:text-[#e2d7c1]">
                No discovery data available right now.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}
