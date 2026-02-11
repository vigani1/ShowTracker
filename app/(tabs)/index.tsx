import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Badge } from "@/components/Badge";
import { FlashList } from "@shopify/flash-list";

type HomeTab = "shows" | "movies";

type DashboardItem = {
  id: string | null;
  title: string;
  mediaType: "tv" | "anime" | "movie";
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  firstAired: string | null;
  tmdbId: number | null;
  anilistId: number | null;
  tvmazeId: number | null;
  imdbId: string | null;
  watchedEpisodes: number;
  totalEpisodes: number | null;
  remainingEpisodes: number | null;
  progressPercent: number | null;
  lastActivityAt: number;
};

type HomeDashboardItem = DashboardItem & { isDemo?: boolean };

const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TODAY_TS = Date.now();

const DEMO_SHOW_ITEMS: HomeDashboardItem[] = [
  {
    id: "demo-tv-106379", title: "Fallout", mediaType: "tv", status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/c15BtJxCXMrISLVmysdsnZUPQft.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/coaPCIqQBPUZsOnJcWZxhaORcDT.jpg`,
    overview: "In a retro-future wasteland, survivors navigate alliances, danger, and mystery.",
    firstAired: "2024-04-10", tmdbId: 106379, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 3, totalEpisodes: 8, remainingEpisodes: 5, progressPercent: 38,
    lastActivityAt: TODAY_TS - 1_800_000, isDemo: true,
  },
  {
    id: "demo-anime-154587", title: "Frieren: Beyond Journey's End", mediaType: "anime", status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/dqZENchTd7lp5zht7BdlqM7RBhD.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/rBOnrVlck7BIlGeWVlzYiZeg4l2.jpg`,
    overview: "An immortal elf reflects on friendship and time while embarking on a new journey.",
    firstAired: "2023-09-29", tmdbId: null, anilistId: 154587, tvmazeId: null, imdbId: null,
    watchedEpisodes: 17, totalEpisodes: 28, remainingEpisodes: 11, progressPercent: 61,
    lastActivityAt: TODAY_TS - 10_800_000, isDemo: true,
  },
  {
    id: "demo-tv-224372", title: "A Knight of the Seven Kingdoms", mediaType: "tv", status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/abrZg2iodq4XeBngpNESOgfPvBM.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/7mkUu1F2hVUNgz24xO8HPx0D6mK.jpg`,
    overview: "A wandering knight and his squire cross a realm where old oaths still matter.",
    firstAired: "2026-01-18", tmdbId: 224372, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 0, totalEpisodes: 6, remainingEpisodes: 6, progressPercent: 0,
    lastActivityAt: TODAY_TS - 21_600_000, isDemo: true,
  },
  {
    id: "demo-tv-240459", title: "Spartacus: House of Ashur", mediaType: "tv", status: "paused",
    posterUrl: `${TMDB_POSTER_BASE}/vNByuzy60v31nmUVPMA8oAtneUK.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/c78kbj781ddvmSn5mgLWFQbC7di.jpg`,
    overview: "Power struggles reignite when a former slave owner claims his own dominion.",
    firstAired: "2025-12-05", tmdbId: 240459, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 4, totalEpisodes: 10, remainingEpisodes: 6, progressPercent: 40,
    lastActivityAt: TODAY_TS - 32_400_000, isDemo: true,
  },
  {
    id: "demo-anime-113415", title: "JUJUTSU KAISEN", mediaType: "anime", status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/fHpKWq9ayzSk8nSwqRuaAUemRKh.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/gmECX1DvFgdUPjtio2zaL8BPYPu.jpg`,
    overview: "A reluctant student enters a brutal world of curses and exorcists.",
    firstAired: "2020-10-03", tmdbId: null, anilistId: 113415, tvmazeId: null, imdbId: null,
    watchedEpisodes: 28, totalEpisodes: 47, remainingEpisodes: 19, progressPercent: 60,
    lastActivityAt: TODAY_TS - 43_200_000, isDemo: true,
  },
  {
    id: "demo-tv-66732", title: "Stranger Things", mediaType: "tv", status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/8zbAoryWbtH0DKdev8abFAjdufy.jpg`,
    overview: "A small town uncovers experiments, secrets, and a terrifying alternate dimension.",
    firstAired: "2016-07-15", tmdbId: 66732, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 21, totalEpisodes: 34, remainingEpisodes: 13, progressPercent: 62,
    lastActivityAt: TODAY_TS - 54_000_000, isDemo: true,
  },
];

const DEMO_MOVIE_ITEMS: HomeDashboardItem[] = [
  {
    id: "demo-movie-1084242", title: "Zootopia 2", mediaType: "movie", status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/oJ7g2CifqpStmoYQyaLQgEU32qO.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/5h2EsPKNDdB3MAtOk9MB9Ycg9Rz.jpg`,
    overview: "Nick and Judy return to a larger conspiracy in the city they protect.",
    firstAired: "2025-11-26", tmdbId: 1084242, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 0, totalEpisodes: null, remainingEpisodes: null, progressPercent: null,
    lastActivityAt: TODAY_TS - 1_800_000, isDemo: true,
  },
  {
    id: "demo-movie-1368166", title: "The Housemaid", mediaType: "movie", status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/cWsBscZzwu5brg9YjNkGewRUvJX.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/tNONILTe9OJz574KZWaLze4v6RC.jpg`,
    overview: "A tense psychological drama where loyalty and class lines begin to fracture.",
    firstAired: "2025-12-18", tmdbId: 1368166, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 0, totalEpisodes: null, remainingEpisodes: null, progressPercent: null,
    lastActivityAt: TODAY_TS - 10_800_000, isDemo: true,
  },
  {
    id: "demo-movie-858024", title: "Hamnet", mediaType: "movie", status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/vbeyOZm2bvBXcbgPD3v6o94epPX.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/73BClq9FOcrWrutnpiqhCNEWEwJ.jpg`,
    overview: "A family reckons with grief and memory in Shakespearean England.",
    firstAired: "2025-11-26", tmdbId: 858024, anilistId: null, tvmazeId: null, imdbId: null,
    watchedEpisodes: 0, totalEpisodes: null, remainingEpisodes: null, progressPercent: null,
    lastActivityAt: TODAY_TS - 21_600_000, isDemo: true,
  },
];

function getRouteId(item: DashboardItem) {
  if (typeof item.tmdbId === "number") {
    return `tmdb:${item.mediaType}:${item.tmdbId}`;
  }
  if (typeof item.anilistId === "number" && item.mediaType === "anime") {
    return `anilist:anime:${item.anilistId}`;
  }
  return null;
}

function getItemKey(item: DashboardItem) {
  return getRouteId(item) ?? item.id ?? `${item.mediaType}:${item.title}:${item.firstAired ?? "unknown"}`;
}

function formatStatus(status: DashboardItem["status"]) {
  if (status === "plan_to_watch") return "Plan to Watch";
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function getHomeColumnCount(width: number, isWeb: boolean) {
  if (isWeb) {
    if (width >= 1600) return 6;
    if (width >= 1300) return 5;
    if (width >= 1050) return 4;
    if (width >= 800) return 3;
    return 2;
  }
  return width >= 500 ? 3 : 2;
}

const GRID_GAP = 12;

function DashboardCard({
  item,
  isWeb,
}: {
  item: HomeDashboardItem;
  isWeb: boolean;
}) {
  const routeId = getRouteId(item);
  const isMovie = item.mediaType === "movie";
  const rawPercent = typeof item.progressPercent === "number" ? item.progressPercent : 0;
  const progress = Math.max(0, Math.min(100, rawPercent)) / 100;

  const posterHeight = isWeb ? 280 : 240;

  const card = (
    <View className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      {/* Poster image - portrait ratio */}
      <View className="relative overflow-hidden" style={{ height: posterHeight }}>
        {item.posterUrl ? (
          <Image
            source={{ uri: item.posterUrl }}
            className="absolute inset-0"
            contentFit="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-zinc-800 px-3">
            <Text className="text-center text-sm font-semibold text-zinc-400">{item.title}</Text>
          </View>
        )}
        {/* Gradient fade at bottom */}
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          className="absolute bottom-0 left-0 right-0"
          style={{ height: 120 }}
        />
        {/* Badges */}
        {item.isDemo ? (
          <View className="absolute left-2 top-2">
            <Badge label="Demo" variant="warning" />
          </View>
        ) : null}
        {typeof item.remainingEpisodes === "number" && item.remainingEpisodes > 0 ? (
          <View className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1">
            <Text className="text-xs font-bold text-sky-400">{item.remainingEpisodes} left</Text>
          </View>
        ) : null}
        {/* Bottom overlay: title + meta + progress */}
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <Text className="mb-0.5 text-sm font-bold text-white" numberOfLines={1}>{item.title}</Text>
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {item.firstAired?.slice(0, 4) ?? "TBA"} · {formatStatus(item.status)}
          </Text>
          {!isMovie && progress > 0 ? (
            <View className="mt-1.5 h-0.5 overflow-hidden rounded-sm bg-white/15">
              <View className="h-full rounded-sm bg-red-500" style={{ width: `${Math.round(progress * 100)}%` }} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!routeId) {
    return card;
  }

  return (
    <Link href={{ pathname: "/show/[id]", params: { id: routeId } }} asChild>
      <Pressable style={({ pressed }) => pressed ? { opacity: 0.95, transform: [{ scale: 0.98 }] } : undefined}>
        {card}
      </Pressable>
    </Link>
  );
}

const tabOptions = [
  { value: "shows" as const, label: "Shows" },
  { value: "movies" as const, label: "Movies" },
];

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<HomeTab>("shows");
  const [visibleCount, setVisibleCount] = useState(8);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const posterHeight = isWeb ? 280 : 240;
  const estimatedRowHeight = posterHeight + GRID_GAP;
  const [gridWidth, setGridWidth] = useState(0);
  const dashboard = useQuery(api.shows.getHomeDashboard, {});
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  const sourceItems = useMemo(() => {
    if (!dashboard) return [] as HomeDashboardItem[];
    return (activeTab === "shows" ? dashboard.shows : dashboard.movies) as HomeDashboardItem[];
  }, [activeTab, dashboard]);

  const activeItems = useMemo(() => {
    if (!dashboard) return [] as HomeDashboardItem[];
    if (sourceItems.length >= 8) return sourceItems;
    const demos = activeTab === "shows" ? DEMO_SHOW_ITEMS : DEMO_MOVIE_ITEMS;
    const merged = [...sourceItems];
    const seen = new Set(sourceItems.map(getItemKey));
    for (const demo of demos) {
      if (merged.length >= 12) break;
      const key = getItemKey(demo);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(demo);
    }
    return merged;
  }, [activeTab, dashboard, sourceItems]);

  const isLoading = dashboard === undefined;
  const usingDemoItems = !isLoading && activeItems.some((item) => item.isDemo);
  // Use measured grid width (accounts for scrollbar, sidebar, padding)
  const effectiveWidth = gridWidth || width;
  const columns = getHomeColumnCount(effectiveWidth, isWeb);
  const cardWidth = gridWidth
    ? Math.floor((gridWidth - (columns - 1) * GRID_GAP) / columns)
    : Math.floor((effectiveWidth / (columns + 0.5))); // conservative fallback
  const pageSize = Math.max(columns * 3, 6);
  const hasMore = visibleCount < activeItems.length;

  useEffect(() => {
    setVisibleCount(Math.min(pageSize, activeItems.length));
    setIsLoadingMore(false);
  }, [activeItems.length, activeTab, pageSize]);

  useEffect(() => {
    return () => { if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current); };
  }, []);

  const visibleItems = useMemo(() => activeItems.slice(0, visibleCount), [activeItems, visibleCount]);

  const loadMoreItems = () => {
    if (!hasMore || isLoadingMore || isLoading) return;
    setIsLoadingMore(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + pageSize, activeItems.length));
      setIsLoadingMore(false);
    }, 140);
  };

  const renderDashboardItem = useCallback(({ item }: { item: HomeDashboardItem }) => (
    <View className="flex-1 px-1.5">
      <DashboardCard item={item} isWeb={isWeb} />
    </View>
  ), [isWeb]);

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={onGridLayout}>
        {gridWidth > 0 ? (
        <FlashList
          key={activeTab}
          data={visibleItems}
          keyExtractor={getItemKey}
          renderItem={renderDashboardItem}
          numColumns={columns}
          estimatedItemSize={estimatedRowHeight}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          onEndReached={loadMoreItems}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListHeaderComponent={
            <View className="pb-2">
              <Text className="mb-1 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
                My Shows
              </Text>
              <Text className="mb-4 text-sm text-text-secondary">
                {activeTab === "shows" ? "TV shows and anime you're tracking" : "Movies in your queue"}
              </Text>

              <SegmentedControl options={tabOptions} value={activeTab} onValueChange={setActiveTab} className="mb-4" />

              {isLoading ? (
                <View className="items-center gap-2 rounded-2xl border border-border-default bg-bg-surface py-8">
                  <ActivityIndicator size="small" color="#ef4444" />
                  <Text className="text-sm text-text-secondary">Loading your dashboard</Text>
                </View>
              ) : null}

              {!isLoading && usingDemoItems ? (
                <View className="mb-4 rounded-xl border border-border-default bg-bg-surface px-4 py-3">
                  <Text className="text-sm leading-relaxed text-text-secondary">
                    Showing sample titles to preview layout. Add your real titles from Discover and this list will update.
                  </Text>
                </View>
              ) : null}

              {!isLoading && !activeItems.length ? (
                <View className="rounded-2xl border border-border-default bg-bg-surface px-4 py-6">
                  <Text className="text-lg font-bold text-text-primary">
                    {activeTab === "shows" ? "No active shows yet" : "No queued movies yet"}
                  </Text>
                  <Text className="mt-1 text-sm leading-relaxed text-text-secondary">
                    {activeTab === "shows"
                      ? "Start tracking episodes from any show detail page and they will appear here."
                      : "Add movies to your watchlist and they will appear here as your queue."}
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            !isLoading && hasMore ? (
              <Pressable onPress={loadMoreItems} className="items-center py-4">
                <ActivityIndicator size="small" color={isLoadingMore ? "#ef4444" : "#52525b"} />
                <Text className="mt-1 text-xs text-text-secondary">
                  {isLoadingMore ? "Loading more..." : "Tap to load more"}
                </Text>
              </Pressable>
            ) : null
          }
        />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="#ef4444" />
          </View>
        )}
      </View>
    </ScreenWrapper>
  );
}

export default HomeScreen;
