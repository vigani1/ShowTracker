import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { getTabContentWidth } from "@/constants/navigation";

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

type HomeDashboardItem = DashboardItem & {
  isDemo?: boolean;
};

const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TODAY_TS = Date.now();

const DEMO_SHOW_ITEMS: HomeDashboardItem[] = [
  {
    id: "demo-tv-106379",
    title: "Fallout",
    mediaType: "tv",
    status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/c15BtJxCXMrISLVmysdsnZUPQft.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/coaPCIqQBPUZsOnJcWZxhaORcDT.jpg`,
    overview: "In a retro-future wasteland, survivors navigate alliances, danger, and mystery.",
    firstAired: "2024-04-10",
    tmdbId: 106379,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 3,
    totalEpisodes: 8,
    remainingEpisodes: 5,
    progressPercent: 38,
    lastActivityAt: TODAY_TS - 1_800_000,
    isDemo: true,
  },
  {
    id: "demo-anime-154587",
    title: "Frieren: Beyond Journey's End",
    mediaType: "anime",
    status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/dqZENchTd7lp5zht7BdlqM7RBhD.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/rBOnrVlck7BIlGeWVlzYiZeg4l2.jpg`,
    overview: "An immortal elf reflects on friendship and time while embarking on a new journey.",
    firstAired: "2023-09-29",
    tmdbId: null,
    anilistId: 154587,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 17,
    totalEpisodes: 28,
    remainingEpisodes: 11,
    progressPercent: 61,
    lastActivityAt: TODAY_TS - 10_800_000,
    isDemo: true,
  },
  {
    id: "demo-tv-224372",
    title: "A Knight of the Seven Kingdoms",
    mediaType: "tv",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/abrZg2iodq4XeBngpNESOgfPvBM.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/7mkUu1F2hVUNgz24xO8HPx0D6mK.jpg`,
    overview: "A wandering knight and his squire cross a realm where old oaths still matter.",
    firstAired: "2026-01-18",
    tmdbId: 224372,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: 6,
    remainingEpisodes: 6,
    progressPercent: 0,
    lastActivityAt: TODAY_TS - 21_600_000,
    isDemo: true,
  },
  {
    id: "demo-tv-240459",
    title: "Spartacus: House of Ashur",
    mediaType: "tv",
    status: "paused",
    posterUrl: `${TMDB_POSTER_BASE}/vNByuzy60v31nmUVPMA8oAtneUK.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/c78kbj781ddvmSn5mgLWFQbC7di.jpg`,
    overview: "Power struggles reignite when a former slave owner claims his own dominion.",
    firstAired: "2025-12-05",
    tmdbId: 240459,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 4,
    totalEpisodes: 10,
    remainingEpisodes: 6,
    progressPercent: 40,
    lastActivityAt: TODAY_TS - 32_400_000,
    isDemo: true,
  },
  {
    id: "demo-anime-113415",
    title: "JUJUTSU KAISEN",
    mediaType: "anime",
    status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/fHpKWq9ayzSk8nSwqRuaAUemRKh.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/gmECX1DvFgdUPjtio2zaL8BPYPu.jpg`,
    overview: "A reluctant student enters a brutal world of curses and exorcists.",
    firstAired: "2020-10-03",
    tmdbId: null,
    anilistId: 113415,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 28,
    totalEpisodes: 47,
    remainingEpisodes: 19,
    progressPercent: 60,
    lastActivityAt: TODAY_TS - 43_200_000,
    isDemo: true,
  },
  {
    id: "demo-tv-66732",
    title: "Stranger Things",
    mediaType: "tv",
    status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/8zbAoryWbtH0DKdev8abFAjdufy.jpg`,
    overview: "A small town uncovers experiments, secrets, and a terrifying alternate dimension.",
    firstAired: "2016-07-15",
    tmdbId: 66732,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 21,
    totalEpisodes: 34,
    remainingEpisodes: 13,
    progressPercent: 62,
    lastActivityAt: TODAY_TS - 54_000_000,
    isDemo: true,
  },
];

const DEMO_MOVIE_ITEMS: HomeDashboardItem[] = [
  {
    id: "demo-movie-1084242",
    title: "Zootopia 2",
    mediaType: "movie",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/oJ7g2CifqpStmoYQyaLQgEU32qO.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/5h2EsPKNDdB3MAtOk9MB9Ycg9Rz.jpg`,
    overview: "Nick and Judy return to a larger conspiracy in the city they protect.",
    firstAired: "2025-11-26",
    tmdbId: 1084242,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 1_800_000,
    isDemo: true,
  },
  {
    id: "demo-movie-1368166",
    title: "The Housemaid",
    mediaType: "movie",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/cWsBscZzwu5brg9YjNkGewRUvJX.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/tNONILTe9OJz574KZWaLze4v6RC.jpg`,
    overview: "A tense psychological drama where loyalty and class lines begin to fracture.",
    firstAired: "2025-12-18",
    tmdbId: 1368166,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 10_800_000,
    isDemo: true,
  },
  {
    id: "demo-movie-858024",
    title: "Hamnet",
    mediaType: "movie",
    status: "watching",
    posterUrl: `${TMDB_POSTER_BASE}/vbeyOZm2bvBXcbgPD3v6o94epPX.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/73BClq9FOcrWrutnpiqhCNEWEwJ.jpg`,
    overview: "A family reckons with grief and memory in Shakespearean England.",
    firstAired: "2025-11-26",
    tmdbId: 858024,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 21_600_000,
    isDemo: true,
  },
  {
    id: "demo-movie-1198994",
    title: "Send Help",
    mediaType: "movie",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/mlV70IuchLZXcXKowjwSpSfdfUB.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/hO2jx1H3XafR7Y8QbFgVH1sHTY9.jpg`,
    overview: "After a disaster, survivors balance cooperation and distrust to stay alive.",
    firstAired: "2026-01-22",
    tmdbId: 1198994,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 43_200_000,
    isDemo: true,
  },
  {
    id: "demo-movie-1198984",
    title: "We Bury the Dead",
    mediaType: "movie",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/xZqo0yPARmyF8TACVNyaOACkYWG.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/vbkW4KerpshPZnP84w9qwSfYrhu.jpg`,
    overview: "A post-disaster story where survival depends on what people choose to remember.",
    firstAired: "2026-01-01",
    tmdbId: 1198984,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 64_800_000,
    isDemo: true,
  },
  {
    id: "demo-movie-1234731",
    title: "Anaconda",
    mediaType: "movie",
    status: "plan_to_watch",
    posterUrl: `${TMDB_POSTER_BASE}/qxMv3HwAB3XPuwNLMhVRg795Ktp.jpg`,
    backdropUrl: `${TMDB_BACKDROP_BASE}/swxhEJsAWms6X1fDZ4HdbvYBSf9.jpg`,
    overview: "A dangerous expedition spirals into survival horror deep in the jungle.",
    firstAired: "2025-12-24",
    tmdbId: 1234731,
    anilistId: null,
    tvmazeId: null,
    imdbId: null,
    watchedEpisodes: 0,
    totalEpisodes: null,
    remainingEpisodes: null,
    progressPercent: null,
    lastActivityAt: TODAY_TS - 86_400_000,
    isDemo: true,
  },
];

function getRouteId(item: DashboardItem) {
  if (typeof item.tmdbId === "number") {
    if (
      item.mediaType === "tv" ||
      item.mediaType === "movie" ||
      item.mediaType === "anime"
    ) {
      return `tmdb:${item.mediaType}:${item.tmdbId}`;
    }
  }

  if (typeof item.anilistId === "number" && item.mediaType === "anime") {
    return `anilist:anime:${item.anilistId}`;
  }

  return null;
}

function getItemKey(item: DashboardItem) {
  return (
    getRouteId(item) ??
    item.id ??
    `${item.mediaType}:${item.title}:${item.firstAired ?? "unknown"}`
  );
}

function formatStatus(status: DashboardItem["status"]) {
  if (status === "plan_to_watch") {
    return "Plan to Watch";
  }
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function formatActivity(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "recently";
  }
}

function SegmentTabs({
  value,
  onChange,
}: {
  value: HomeTab;
  onChange: (next: HomeTab) => void;
}) {
  return (
    <View className="mb-3 flex-row rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface p-1 dark:border-brand-surface/75 dark:bg-brand-surface/75">
      {([
        { key: "shows", label: "Shows" },
        { key: "movies", label: "Movies" },
      ] as const).map((tab) => {
        const active = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className={`flex-1 items-center rounded-xl px-3 py-2 ${
              active ? "bg-brand-primary" : "bg-transparent"
            }`}
          >
            <Text
              className={`text-xs font-bold uppercase tracking-[1.3px] ${
                active ? "text-white" : "text-brand-ink dark:text-brand-text"
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

function getHomeColumnCount(width: number, isWeb: boolean) {
  if (isWeb) {
    if (width >= 1800) {
      return 6;
    }
    if (width >= 1500) {
      return 5;
    }
    if (width >= 1220) {
      return 4;
    }
    if (width >= 940) {
      return 3;
    }
    return 2;
  }

  if (width >= 700) {
    return 3;
  }
  if (width >= 380) {
    return 2;
  }
  return 1;
}

function getHomeCardWidth(columns: number) {
  if (columns === 6) {
    return "15.8%";
  }
  if (columns === 5) {
    return "19.1%";
  }
  if (columns === 4) {
    return "23.8%";
  }
  if (columns === 3) {
    return "31.8%";
  }
  if (columns === 2) {
    return "48.6%";
  }
  return "100%";
}

function DashboardCard({
  item,
  isWeb,
  showOverview,
  containerStyle,
}: {
  item: HomeDashboardItem;
  isWeb: boolean;
  showOverview: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const routeId = getRouteId(item);
  const isMovie = item.mediaType === "movie";
  const mediaLabel =
    item.mediaType === "anime" ? "Anime" : item.mediaType === "tv" ? "TV" : "Movie";

  const content = (
    <View
      className="overflow-hidden rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface dark:border-brand-surface/75 dark:bg-brand-surface/75"
    >
      <View className={`${isWeb ? "h-52" : "h-44"} relative`}>
        {item.posterUrl ? (
          <Image
            source={{ uri: item.posterUrl }}
            className="h-full w-full"
            contentFit="cover"
          />
        ) : (
          <View className="h-full w-full bg-brand-surface/25" />
        )}
        <View className="absolute inset-x-0 bottom-0 border-t border-black/35 bg-black/50 px-2 py-1.5">
          <Text className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#f5ead8]">
            {mediaLabel}
          </Text>
        </View>
        {item.isDemo ? (
          <View className="absolute left-2 top-2 rounded-full border border-brand-primary/75 bg-black/45 px-2 py-1">
            <Text className="text-[9px] font-semibold uppercase tracking-[1.1px] text-brand-primary">
              Demo
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-1 px-3 py-3">
        <Text
          className="font-serif text-lg font-semibold leading-6 text-brand-ink dark:text-brand-text"
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text className="text-[11px] uppercase tracking-[1.2px] text-brand-ink-soft dark:text-[#d8c8ab]">
          {item.firstAired?.slice(0, 4) ?? "TBA"} · {formatStatus(item.status)}
        </Text>
        {showOverview && item.overview ? (
          <Text
            className="text-[12px] leading-5 text-brand-ink-soft dark:text-[#e2d7c1]"
            numberOfLines={2}
          >
            {item.overview}
          </Text>
        ) : null}
        {isMovie ? (
          <Text className="text-xs font-semibold text-brand-ink dark:text-brand-text">
            {item.status === "plan_to_watch" ? "Queued for movie night" : "Ready to watch"}
          </Text>
        ) : (
          <>
            <Text className="text-xs font-semibold text-brand-ink dark:text-brand-text">
              {item.remainingEpisodes === null
                ? `${item.watchedEpisodes} watched`
                : `${item.remainingEpisodes} episodes left`}
            </Text>
            {typeof item.progressPercent === "number" && item.progressPercent > 0 ? (
              <View className="h-1.5 overflow-hidden rounded-full bg-brand-frame/35 dark:bg-brand-surface/45">
                <View
                  className="h-full rounded-full bg-brand-primary"
                  style={{ width: `${item.progressPercent}%` }}
                />
              </View>
            ) : null}
          </>
        )}
        <Text className="text-[10px] uppercase tracking-[1.1px] text-brand-ink-soft dark:text-[#d8c8ab]">
          Active {formatActivity(item.lastActivityAt)}
        </Text>
      </View>
    </View>
  );

  if (!routeId) {
    return (
      <View style={containerStyle} className="mb-4">
        {content}
      </View>
    );
  }

  return (
    <Link
      href={{ pathname: "/show/[id]", params: { id: routeId } }}
      asChild
    >
      <Pressable style={containerStyle} className="mb-4">
        {content}
      </Pressable>
    </Link>
  );
}

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<HomeTab>("shows");
  const [visibleCount, setVisibleCount] = useState(8);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const contentWidth = getTabContentWidth(width, isWeb);
  const dashboard = useQuery(api.shows.getHomeDashboard, {});
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sourceItems = useMemo(() => {
    if (!dashboard) {
      return [] as HomeDashboardItem[];
    }
    return (activeTab === "shows" ? dashboard.shows : dashboard.movies) as HomeDashboardItem[];
  }, [activeTab, dashboard]);

  const activeItems = useMemo(() => {
    if (!dashboard) {
      return [] as HomeDashboardItem[];
    }

    if (sourceItems.length >= 8) {
      return sourceItems;
    }

    const demos = activeTab === "shows" ? DEMO_SHOW_ITEMS : DEMO_MOVIE_ITEMS;
    const merged = [...sourceItems];
    const seen = new Set(sourceItems.map((item) => getItemKey(item)));

    for (const demo of demos) {
      if (merged.length >= 12) {
        break;
      }
      const key = getItemKey(demo);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(demo);
    }

    return merged;
  }, [activeTab, dashboard, sourceItems]);

  const isLoading = dashboard === undefined;
  const usingDemoItems = !isLoading && activeItems.some((item) => item.isDemo);
  const columns = getHomeColumnCount(contentWidth, isWeb);
  const cardWidth = getHomeCardWidth(columns);
  const showOverview = isWeb && contentWidth >= 1460;
  const pageSize = Math.max(columns * (isWeb ? 3 : 3), 6);
  const hasMore = visibleCount < activeItems.length;

  useEffect(() => {
    setVisibleCount(Math.min(pageSize, activeItems.length));
    setIsLoadingMore(false);
  }, [activeItems.length, activeTab, pageSize]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  const visibleItems = useMemo(
    () => activeItems.slice(0, visibleCount),
    [activeItems, visibleCount]
  );
  const desktopFillerCount = useMemo(() => {
    if (!isWeb || !visibleItems.length) {
      return 0;
    }
    return (columns - (visibleItems.length % columns)) % columns;
  }, [columns, isWeb, visibleItems.length]);
  const visibleRows = useMemo(() => {
    if (!visibleItems.length) {
      return [] as HomeDashboardItem[][];
    }

    const rows: HomeDashboardItem[][] = [];
    for (let index = 0; index < visibleItems.length; index += columns) {
      rows.push(visibleItems.slice(index, index + columns));
    }
    return rows;
  }, [columns, visibleItems]);

  const loadMoreItems = () => {
    if (!hasMore || isLoadingMore || isLoading) {
      return;
    }
    setIsLoadingMore(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + pageSize, activeItems.length));
      setIsLoadingMore(false);
    }, 140);
  };

  return (
    <ScreenWrapper>
      <FlashList
        data={visibleRows}
        key={`home-grid-${activeTab}-${columns}`}
        keyExtractor={(row, rowIndex) =>
          row.length
            ? row.map((entry) => getItemKey(entry)).join("|")
            : `home-row-${rowIndex}`
        }
        estimatedItemSize={isWeb ? (showOverview ? 440 : 400) : 360}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMoreItems}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View className="pb-0">
            <View className="mb-3 flex-row items-center justify-between px-1">
              <Text className="pt-[4px] text-[10px] font-bold uppercase tracking-[1.5px] text-brand-ink-soft dark:text-[#d8c8ab]">
                Watch board
              </Text>
              <Text className="pt-[4px] text-[10px] font-semibold uppercase tracking-[1.4px] text-brand-ink-soft dark:text-[#d8c8ab]">
                {activeTab === "shows" ? "TV + anime" : "movies"}
              </Text>
            </View>

            <SegmentTabs value={activeTab} onChange={setActiveTab} />

            {isLoading ? (
              <View className="items-center gap-2 rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface/80 py-8 dark:border-brand-surface/65 dark:bg-brand-surface/70">
                <ActivityIndicator size="small" color="#cf5d3f" />
                <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-brand-ink-soft dark:text-[#d8c8ab]">
                  Loading your dashboard
                </Text>
              </View>
            ) : null}

            {!isLoading && usingDemoItems ? (
              <View className="mb-3 rounded-xl border border-brand-frame/40 bg-brand-light-surface/70 px-3 py-2.5 dark:border-brand-surface/60 dark:bg-brand-surface/60">
                <Text className="text-[11px] leading-5 text-brand-ink-soft dark:text-[#d8c8ab]">
                  Showing sample titles to preview layout density. Add your real titles from
                  Discover and this list automatically shifts to your actual library.
                </Text>
              </View>
            ) : null}

            {!isLoading && !activeItems.length ? (
              <View className="rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface px-4 py-5 dark:border-brand-surface/65 dark:bg-brand-surface/70">
                <Text className="font-serif text-lg font-semibold text-brand-ink dark:text-brand-text">
                  {activeTab === "shows"
                    ? "No active shows yet"
                    : "No queued movies yet"}
                </Text>
                <Text className="mt-1 text-sm leading-6 text-brand-ink-soft dark:text-[#e2d7c1]">
                  {activeTab === "shows"
                    ? "Start tracking episodes from any show detail page and they will appear here."
                    : "Add movies to your watchlist and they will appear here as your queue."}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item: row, index }) => (
          <View className="flex-row flex-wrap justify-between">
            {row.map((item) => (
              <DashboardCard
                key={getItemKey(item)}
                item={item}
                isWeb={isWeb}
                showOverview={showOverview}
                containerStyle={{ width: cardWidth }}
              />
            ))}
            {index === visibleRows.length - 1
              ? Array.from({ length: desktopFillerCount }).map((_, fillerIndex) => (
                  <View
                    key={`home-fill-${fillerIndex}`}
                    className="mb-4 opacity-0"
                    style={{ width: cardWidth, pointerEvents: "none" }}
                  />
                ))
              : null}
          </View>
        )}
        ListFooterComponent={
          <View>
            {!isLoading && hasMore ? (
              <View className="items-center pb-4 pt-1">
                <ActivityIndicator
                  size="small"
                  color={isLoadingMore ? "#cf5d3f" : "#8e7455"}
                />
                <Text className="mt-1 text-[11px] uppercase tracking-[1.1px] text-brand-ink-soft dark:text-[#d8c8ab]">
                  {isLoadingMore ? "Loading more titles..." : "Scroll for more"}
                </Text>
              </View>
            ) : null}
            <View className="h-1" />
          </View>
        }
      />
    </ScreenWrapper>
  );
}

export default HomeScreen;
