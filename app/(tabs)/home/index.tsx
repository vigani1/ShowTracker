import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useAction, useQuery } from "convex/react";
import { FlashList } from "@shopify/flash-list";
import { api } from "@/convex/_generated/api";
import { FilterChipGroup } from "@/components/FilterChipGroup";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import type { MediaType } from "@/lib/api/types";
import {
  applyTrackingFilters,
  matchesStatusFilter,
  type TrackingStatusFilter,
} from "@/lib/filters/tracking-filters";
import { toHttpsImageUrl } from "@/lib/image-url";

type HomeTab = "watchlist" | "upcoming";
type HomeMediaFilter = "all" | "tv" | "anime";
type HomeStatusFilter = TrackingStatusFilter;

type WatchlistItem = {
  id: string;
  title: string;
  mediaType: MediaType;
  posterUrl: string | null;
  tmdbId: number | null;
  anilistId: number | null;
  malId: number | null;
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
  isAutoTracked: boolean;
  trackingState: "not_started" | "in_progress" | "upcoming" | "tba";
  remainingEpisodes: number | null;
  watchedEpisodes: number;
  totalEpisodes: number | null;
};

type UpcomingEpisode = {
  routeId: string | null;
  showTitle: string;
  mediaType: "tv" | "anime";
  posterUrl?: string;
  daysUntil: number;
  episode: {
    seasonNumber: number;
    episodeNumber: number;
    name?: string;
  };
};

type UpcomingGroup = {
  date: string;
  episodes: UpcomingEpisode[];
};

type UpcomingListItem =
  | {
      type: "header";
      id: string;
      date: string;
      isToday: boolean;
    }
  | {
      type: "episode";
      id: string;
      date: string;
      episodes: UpcomingEpisode[];
    };

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const GRID_GAP = 12;
const INITIAL_PAST_DAYS = 8;
const INITIAL_FUTURE_DAYS = 8;
const RANGE_EXTENSION_DAYS = 8;
const SCROLL_EDGE_THRESHOLD = 180;
const INITIAL_UPCOMING_HYDRATION_TIMEOUT_MS = 8000;
const EDGE_LOAD_COOLDOWN_MS = 320;

const watchlistStatusOptions: { value: HomeStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "watching", label: "Watching" },
  { value: "plan_to_watch", label: "Planned" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
  { value: "watched", label: "Watched" },
  { value: "not_watched", label: "Not Watched" },
];

function parseLocalDate(dateString: string) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getUtcDayIndex(date: Date) {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS
  );
}

function formatDateForApi(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayLabel(dateString: string) {
  const date = parseLocalDate(dateString);
  if (!date) return "";

  const dayDiff = getUtcDayIndex(date) - getUtcDayIndex(new Date());

  if (dayDiff === 0) return "TODAY";
  if (dayDiff === 1) return "TOMORROW";
  if (dayDiff === 2) return "IN 2 DAYS";

  return date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
}

function getDateLabel(dateString: string) {
  const date = parseLocalDate(dateString);
  if (!date) return "";

  return date
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function getColumnCount(width: number, isWeb: boolean) {
  if (isWeb) {
    if (width >= 1600) return 6;
    if (width >= 1300) return 5;
    if (width >= 1050) return 4;
    if (width >= 800) return 3;
    return 2;
  }
  return width >= 500 ? 3 : 2;
}

function addDaysToDateString(dateString: string, days: number): string {
  const date = parseLocalDate(dateString);
  if (!date) return dateString;

  date.setDate(date.getDate() + days);
  return formatDateForApi(date);
}

function getInclusiveDayCount(startDate: string, endDate: string): number {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return 1;

  const inclusiveDays = getUtcDayIndex(end) - getUtcDayIndex(start) + 1;
  return Math.max(1, inclusiveDays);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getWatchlistRouteId(item: WatchlistItem) {
  if (
    typeof item.tmdbId === "number" &&
    (item.mediaType === "tv" || item.mediaType === "movie")
  ) {
    return `tmdb:${item.mediaType}:${item.tmdbId}`;
  }
  if (typeof item.anilistId === "number" && item.mediaType === "anime") {
    return `anilist:anime:${item.anilistId}`;
  }
  if (typeof item.malId === "number" && item.mediaType === "anime") {
    return `jikan:anime:${item.malId}`;
  }
  return null;
}

function WatchlistCard({ item, isWeb }: { item: WatchlistItem; isWeb: boolean }) {
  const routeId = getWatchlistRouteId(item);
  const posterHeight = isWeb ? 280 : 240;
  const watchedPercent =
    item.totalEpisodes && item.totalEpisodes > 0
      ? Math.round((item.watchedEpisodes / item.totalEpisodes) * 100)
      : null;
  const cornerLabel =
    item.remainingEpisodes === null
      ? item.trackingState === "tba"
        ? "TBA"
        : "Upcoming"
      : `${item.remainingEpisodes} left`;
  const progressLabel =
    item.totalEpisodes === null
      ? item.watchedEpisodes > 0
        ? `${item.watchedEpisodes} watched`
        : "Not started"
      : `${item.watchedEpisodes}/${item.totalEpisodes} episodes`;
  const statusLabel = item.status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const card = (
    <View className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900">
      <View className="relative overflow-hidden" style={{ height: posterHeight }}>
        {item.posterUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(item.posterUrl) }}
            className="absolute inset-0"
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-zinc-800 px-3">
            <Text className="text-center text-sm font-semibold text-zinc-400">
              {item.title}
            </Text>
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.62)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96 }}
        />
        <View className="absolute right-2 top-2 rounded-md border-2 border-white/20 bg-black/80 px-2.5 py-1.5">
          <Text className="text-[11px] font-black uppercase tracking-wide text-white">
            {cornerLabel}
          </Text>
        </View>
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <Text className="mb-0.5 text-sm font-bold text-white" numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {progressLabel}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="text-[10px] uppercase tracking-wide text-zinc-300">
              {statusLabel}
            </Text>
            {item.isAutoTracked ? (
              <Text className="rounded-sm border border-red-400/40 bg-red-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-red-100">
                Auto
              </Text>
            ) : null}
          </View>
          {watchedPercent !== null ? (
            <View className="mt-1.5 h-1 overflow-hidden bg-white/15">
              <View className="h-full bg-red-500" style={{ width: `${watchedPercent}%` }} />
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
      <Pressable
        style={({ pressed }) =>
          pressed ? { opacity: 0.95, transform: [{ scale: 0.98 }] } : undefined
        }
      >
        {card}
      </Pressable>
    </Link>
  );
}

function UpcomingCard({ episode, isWeb }: { episode: UpcomingEpisode; isWeb: boolean }) {
  const posterHeight = isWeb ? 280 : 240;
  const hasEpisodeName =
    episode.episode.name && episode.episode.name !== episode.showTitle;

  const card = (
    <View className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900">
      <View className="relative overflow-hidden" style={{ height: posterHeight }}>
        {episode.posterUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(episode.posterUrl) }}
            className="absolute inset-0"
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-zinc-800 px-3">
            <Text className="text-center text-sm font-semibold text-zinc-400">
              {episode.showTitle}
            </Text>
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.62)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 110 }}
        />
        <View className="absolute left-2 top-2 rounded-md border-2 border-white/20 bg-black/70 px-2 py-1 flex-row items-center">
          <Text className="text-sm font-bold text-white">{episode.daysUntil}</Text>
          <Text className="text-[10px] font-semibold text-zinc-200 ml-1">
            {episode.daysUntil === 1 ? "DAY" : "DAYS"}
          </Text>
        </View>
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <Text className="mb-0.5 text-sm font-bold text-white" numberOfLines={1}>
            {episode.showTitle}
          </Text>
          {hasEpisodeName ? (
            <Text className="text-xs text-primary-glow" numberOfLines={1}>
              {episode.episode.name}
            </Text>
          ) : null}
          <Text className="text-xs text-zinc-400 mt-0.5" numberOfLines={1}>
            S{episode.episode.seasonNumber}E{episode.episode.episodeNumber}
          </Text>
        </View>
      </View>
    </View>
  );

  if (!episode.routeId) {
    return <View className="opacity-70">{card}</View>;
  }

  return (
    <Link href={{ pathname: "/show/[id]", params: { id: episode.routeId } }} asChild>
      <Pressable
        style={({ pressed }) =>
          pressed ? { opacity: 0.95, transform: [{ scale: 0.98 }] } : undefined
        }
      >
        {card}
      </Pressable>
    </Link>
  );
}

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<HomeTab>("watchlist");
  const [mediaFilter, setMediaFilter] = useState<HomeMediaFilter>("all");
  const [statusFilter, setStatusFilter] = useState<HomeStatusFilter>("all");
  const [watchlistVisibleCount, setWatchlistVisibleCount] = useState(0);
  const [isLoadingMoreWatchlist, setIsLoadingMoreWatchlist] = useState(false);
  const [isHydratingInitialUpcoming, setIsHydratingInitialUpcoming] = useState(false);
  const [isLoadingPast, setIsLoadingPast] = useState(false);
  const [isLoadingFuture, setIsLoadingFuture] = useState(false);
  const [isTodayVisible, setIsTodayVisible] = useState(true);
  const [gridWidth, setGridWidth] = useState(0);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";

  const todayDate = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateForApi(todayDate), [todayDate]);
  const [rangeStartDate, setRangeStartDate] = useState(() =>
    addDaysToDateString(todayKey, -INITIAL_PAST_DAYS)
  );
  const [rangeEndDate, setRangeEndDate] = useState(() =>
    addDaysToDateString(todayKey, INITIAL_FUTURE_DAYS)
  );

  const upcomingScrollRef = useRef<any>(null);
  const didStartInitialUpcomingHydrationRef = useRef(false);
  const hydratedRangesRef = useRef(new Set<string>());
  const shouldAnchorTodayRef = useRef(false);
  const previousTabRef = useRef<HomeTab>("watchlist");
  const canLoadPastFromEdgeRef = useRef(true);
  const canLoadFutureFromEdgeRef = useRef(true);
  const allowUpcomingEdgeLoadRef = useRef(false);
  const watchlistLoadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relationSyncTriggeredRef = useRef(false);
  const [upcomingSnapshot, setUpcomingSnapshot] = useState<UpcomingGroup[]>([]);

  const watchlist = useQuery(api.shows.getWatchlist, {});
  const upcoming = useQuery(
    api.schedule.getUpcomingSchedule,
    activeTab === "upcoming"
      ? {
          startDate: rangeStartDate,
          endDate: rangeEndDate,
          mediaFilter: mediaFilter === "all" ? undefined : mediaFilter,
        }
      : "skip"
  );
  const hydrateScheduleRange = useAction(api.schedule.hydrateScheduleRange);
  const syncTrackedAnimeRelations = useAction(api.shows.syncTrackedAnimeRelations);

  const hydrateRange = useCallback(
    async (startDate: string, days: number) => {
      const safeDays = Math.max(1, Math.min(days, 21));
      const cacheKey = `${startDate}:${safeDays}`;
      if (hydratedRangesRef.current.has(cacheKey)) {
        return;
      }

      hydratedRangesRef.current.add(cacheKey);
      try {
        await hydrateScheduleRange({
          startDate,
          days: safeDays,
        });
      } catch (error) {
        hydratedRangesRef.current.delete(cacheKey);
        throw error;
      }
    },
    [hydrateScheduleRange]
  );

  useEffect(() => {
    if (activeTab === "upcoming" && previousTabRef.current !== "upcoming") {
      shouldAnchorTodayRef.current = true;
      canLoadPastFromEdgeRef.current = true;
      canLoadFutureFromEdgeRef.current = true;
      allowUpcomingEdgeLoadRef.current = false;
      setIsTodayVisible(true);
    }
    previousTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (
      activeTab !== "upcoming" ||
      didStartInitialUpcomingHydrationRef.current ||
      isHydratingInitialUpcoming
    ) {
      return;
    }

    didStartInitialUpcomingHydrationRef.current = true;
    let cancelled = false;
    setIsHydratingInitialUpcoming(true);

    const hydrationPromise = hydrateRange(
      rangeStartDate,
      getInclusiveDayCount(rangeStartDate, rangeEndDate)
    ).catch((error) => {
      console.warn("Initial upcoming range hydration failed", error);
    });

    void Promise.race([
      hydrationPromise,
      delay(INITIAL_UPCOMING_HYDRATION_TIMEOUT_MS),
    ])
      .finally(() => {
        if (!cancelled) {
          setIsHydratingInitialUpcoming(false);
          shouldAnchorTodayRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    hydrateRange,
    isHydratingInitialUpcoming,
    rangeEndDate,
    rangeStartDate,
  ]);

  useEffect(() => {
    if (relationSyncTriggeredRef.current) {
      return;
    }

    relationSyncTriggeredRef.current = true;
    void syncTrackedAnimeRelations({ force: false }).catch((error) => {
      console.warn("Background anime relation sync failed", error);
      // Reset the trigger so subsequent attempts can retry
      relationSyncTriggeredRef.current = false;
    });
  }, [syncTrackedAnimeRelations]);

  const loadPastWeek = useCallback(async () => {
    if (activeTab !== "upcoming" || isLoadingPast) {
      return;
    }

    const newStartDate = addDaysToDateString(rangeStartDate, -RANGE_EXTENSION_DAYS);

    setIsLoadingPast(true);
    try {
      await hydrateRange(newStartDate, RANGE_EXTENSION_DAYS);
      setRangeStartDate(newStartDate);
    } finally {
      setIsLoadingPast(false);
    }
  }, [activeTab, hydrateRange, isLoadingPast, rangeStartDate]);

  const loadFutureWeek = useCallback(async () => {
    if (activeTab !== "upcoming" || isLoadingFuture) {
      return;
    }

    const nextStartDate = addDaysToDateString(rangeEndDate, 1);
    const newEndDate = addDaysToDateString(rangeEndDate, RANGE_EXTENSION_DAYS);

    setIsLoadingFuture(true);
    try {
      await hydrateRange(nextStartDate, RANGE_EXTENSION_DAYS);
      setRangeEndDate(newEndDate);
    } finally {
      setIsLoadingFuture(false);
    }
  }, [activeTab, hydrateRange, isLoadingFuture, rangeEndDate]);

  const triggerLoadPast = useCallback(() => {
    if (
      !canLoadPastFromEdgeRef.current ||
      isLoadingPast
    ) {
      return;
    }

    canLoadPastFromEdgeRef.current = false;
    void loadPastWeek()
      .catch((error) => {
        console.warn("Failed to load earlier upcoming range", error);
      })
      .finally(() => {
        setTimeout(() => {
          canLoadPastFromEdgeRef.current = true;
        }, EDGE_LOAD_COOLDOWN_MS);
      });
  }, [isLoadingPast, loadPastWeek]);

  const triggerLoadFuture = useCallback(() => {
    if (
      !canLoadFutureFromEdgeRef.current ||
      isLoadingFuture
    ) {
      return;
    }

    canLoadFutureFromEdgeRef.current = false;
    void loadFutureWeek()
      .catch((error) => {
        console.warn("Failed to load later upcoming range", error);
      })
      .finally(() => {
        setTimeout(() => {
          canLoadFutureFromEdgeRef.current = true;
        }, EDGE_LOAD_COOLDOWN_MS);
      });
  }, [isLoadingFuture, loadFutureWeek]);

  useEffect(() => {
    if (activeTab === "upcoming" && upcoming !== undefined) {
      setUpcomingSnapshot(upcoming as UpcomingGroup[]);
    }
  }, [activeTab, upcoming]);

  const watchlistItems = useMemo(() => (watchlist ?? []) as WatchlistItem[], [watchlist]);

  const mediaScopedWatchlist = useMemo(
    () =>
      applyTrackingFilters(watchlistItems, {
        media: mediaFilter,
        status: "all",
      }),
    [mediaFilter, watchlistItems]
  );

  const filteredWatchlist = useMemo(
    () =>
      applyTrackingFilters(mediaScopedWatchlist, {
        media: "all",
        status: statusFilter,
      }),
    [mediaScopedWatchlist, statusFilter]
  );

  const watchlistStatusOptionsWithCount = useMemo(
    () =>
      watchlistStatusOptions.map((option) => ({
        ...option,
        count: mediaScopedWatchlist.filter((item) =>
          matchesStatusFilter(item, option.value)
        ).length,
      })),
    [mediaScopedWatchlist]
  );

  const upcomingGroups = useMemo(
    () => ((upcoming ?? upcomingSnapshot) as UpcomingGroup[]),
    [upcoming, upcomingSnapshot]
  );

  const effectiveWidth = gridWidth || Math.max(width - 40, 0);
  const columns = getColumnCount(effectiveWidth, isWeb);
  const cardWidth = (effectiveWidth - (columns - 1) * GRID_GAP) / columns;
  const watchlistPageSize = Math.max(columns * 3, 6);

  const upcomingListItems = useMemo<UpcomingListItem[]>(() => {
    const items: UpcomingListItem[] = [];

    for (const group of upcomingGroups) {
      items.push({
        type: "header",
        id: `header:${group.date}`,
        date: group.date,
        isToday: group.date === todayKey,
      });

      for (let index = 0; index < group.episodes.length; index += columns) {
        items.push({
          type: "episode",
          id: `row:${group.date}:${index}`,
          date: group.date,
          episodes: group.episodes.slice(index, index + columns),
        });
      }
    }

    return items;
  }, [columns, todayKey, upcomingGroups]);

  const todayAnchorIndex = useMemo(
    () =>
      upcomingListItems.findIndex(
        (item) => item.type === "header" && item.date >= todayKey
      ),
    [todayKey, upcomingListItems]
  );

  const upcomingRangeLabel = useMemo(
    () => `${getDateLabel(rangeStartDate)} - ${getDateLabel(rangeEndDate)}`,
    [rangeEndDate, rangeStartDate]
  );

  const onUpcomingViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: UpcomingListItem }[] }) => {
      const hasTodayHeaderVisible = viewableItems.some(
        (entry) => entry.item.type === "header" && entry.item.date === todayKey
      );
      setIsTodayVisible(hasTodayHeaderVisible);
    },
    [todayKey]
  );

  const jumpToToday = useCallback(() => {
    if (todayAnchorIndex < 0) {
      return;
    }

    upcomingScrollRef.current?.scrollToIndex({
      index: todayAnchorIndex,
      animated: true,
    });
  }, [todayAnchorIndex]);

  const isWatchlistLoading = watchlist === undefined;
  const isUpcomingLoading =
    activeTab === "upcoming" &&
    upcomingGroups.length === 0 &&
    (upcoming === undefined || isHydratingInitialUpcoming);

  const headerText =
    activeTab === "watchlist"
      ? { title: "Watchlist", subtitle: "Filtered by media and watch state" }
      : { title: "Upcoming", subtitle: "Episodes from 8 days before and after today" };

  const watchlistCount = filteredWatchlist.length;
  const upcomingCount = upcomingGroups.reduce(
    (sum, group) => sum + group.episodes.length,
    0
  );
  const visibleWatchlistItems = useMemo(
    () => filteredWatchlist.slice(0, watchlistVisibleCount),
    [filteredWatchlist, watchlistVisibleCount]
  );
  const hasMoreWatchlist = watchlistVisibleCount < filteredWatchlist.length;

  useEffect(() => {
    setWatchlistVisibleCount((current) => {
      const next = Math.min(
        filteredWatchlist.length,
        Math.max(current, watchlistPageSize)
      );
      return next;
    });
    setIsLoadingMoreWatchlist(false);
  }, [filteredWatchlist.length, watchlistPageSize]);

  useEffect(() => {
    return () => {
      if (watchlistLoadMoreTimerRef.current) {
        clearTimeout(watchlistLoadMoreTimerRef.current);
      }
    };
  }, []);

  const loadMoreWatchlist = useCallback(() => {
    if (!hasMoreWatchlist || isLoadingMoreWatchlist || isWatchlistLoading) {
      return;
    }

    setIsLoadingMoreWatchlist(true);
    watchlistLoadMoreTimerRef.current = setTimeout(() => {
      setWatchlistVisibleCount((count) =>
        Math.min(count + watchlistPageSize, filteredWatchlist.length)
      );
      setIsLoadingMoreWatchlist(false);
    }, 120);
  }, [
    filteredWatchlist.length,
    hasMoreWatchlist,
    isLoadingMoreWatchlist,
    isWatchlistLoading,
    watchlistPageSize,
  ]);

  const upcomingListData = useMemo(
    () => (isUpcomingLoading || upcomingGroups.length === 0 ? [] : upcomingListItems),
    [isUpcomingLoading, upcomingGroups.length, upcomingListItems]
  );

  const stickyHeaderIndices = useMemo(() => {
    const headerIndices: number[] = [];
    for (let index = 0; index < upcomingListData.length; index += 1) {
      if (upcomingListData[index]?.type === "header") {
        headerIndices.push(index);
      }
    }
    return headerIndices;
  }, [upcomingListData]);

  useEffect(() => {
    if (
      shouldAnchorTodayRef.current &&
      activeTab === "upcoming" &&
      !isUpcomingLoading &&
      todayAnchorIndex >= 0
    ) {
      requestAnimationFrame(() => {
        upcomingScrollRef.current?.scrollToIndex({
          index: todayAnchorIndex,
          animated: false,
        });

        setTimeout(() => {
          allowUpcomingEdgeLoadRef.current = true;
        }, 180);
      });
      shouldAnchorTodayRef.current = false;
      setIsTodayVisible(true);
    }
  }, [activeTab, isUpcomingLoading, todayAnchorIndex]);

  useEffect(() => {
    if (
      activeTab === "upcoming" &&
      !isUpcomingLoading &&
      todayAnchorIndex < 0
    ) {
      allowUpcomingEdgeLoadRef.current = true;
    }
  }, [activeTab, isUpcomingLoading, todayAnchorIndex]);

  const renderUpcomingListItem = useCallback(
    ({ item }: { item: UpcomingListItem }) => {
      if (item.type === "header") {
        return (
          <View className={`mb-3 ${item.isToday ? "mt-1" : ""}`}>
            <View
              className={`self-start rounded-md border-2 ${
                item.isToday
                  ? "border-primary bg-primary px-4 py-1.5"
                  : "border-zinc-600 bg-zinc-700/70 px-3 py-1"
              }`}
            >
              <Text
                className={`text-[11px] font-black uppercase tracking-wide ${
                  item.isToday ? "text-white" : "text-zinc-100"
                }`}
              >
                {item.isToday
                  ? `TODAY - ${getDateLabel(item.date)}`
                  : `${getDayLabel(item.date)} · ${getDateLabel(item.date)}`}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <View className="mb-3 flex-row">
          {item.episodes.map((episode, index) => (
            <View
              key={`${item.date}:${episode.routeId ?? episode.showTitle}:${episode.episode.seasonNumber}:${episode.episode.episodeNumber}:${index}`}
              style={{
                width: cardWidth,
                marginRight: index === item.episodes.length - 1 ? 0 : GRID_GAP,
              }}
            >
              <UpcomingCard episode={episode} isWeb={isWeb} />
            </View>
          ))}
        </View>
      );
    },
    [cardWidth, isWeb]
  );

  const onUpcomingScroll = useCallback(
    (event: any) => {
      if (!allowUpcomingEdgeLoadRef.current) {
        return;
      }

      const y = event.nativeEvent.contentOffset.y;
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight = event.nativeEvent.contentSize.height;
      const distanceFromBottom = contentHeight - (y + viewportHeight);

      if (y <= SCROLL_EDGE_THRESHOLD) {
        triggerLoadPast();
        return;
      }

      if (distanceFromBottom <= SCROLL_EDGE_THRESHOLD) {
        triggerLoadFuture();
      }
    },
    [triggerLoadFuture, triggerLoadPast]
  );

  const renderWatchlistItem = useCallback(
    ({ item, index }: { item: WatchlistItem; index: number }) => {
      const columnIndex = index % columns;
      const halfGap = GRID_GAP / 2;

      return (
        <View
          style={{
            flex: 1,
            paddingLeft: columnIndex === 0 ? 0 : halfGap,
            paddingRight: columnIndex === columns - 1 ? 0 : halfGap,
          }}
        >
          <WatchlistCard item={item} isWeb={isWeb} />
        </View>
      );
    },
    [columns, isWeb]
  );

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
        {gridWidth > 0 ? (
          activeTab === "watchlist" ? (
            <FlashList
              data={visibleWatchlistItems}
              keyExtractor={(item: WatchlistItem) => `${item.mediaType}-${item.id}`}
              renderItem={renderWatchlistItem as any}
              numColumns={columns}
              ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
              onEndReached={loadMoreWatchlist}
              onEndReachedThreshold={0.4}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListHeaderComponent={
                <View className="pb-4">
                  <PageIntro
                    title={headerText.title}
                    subtitle={headerText.subtitle}
                    eyebrow="Today"
                    icon="sparkles-outline"
                    rightLabel={`${watchlistCount} matched`}
                    className="mb-4"
                  />

                  <SegmentedControl
                    className="mb-3"
                    options={[
                      { value: "watchlist", label: "Watchlist" },
                      { value: "upcoming", label: "Upcoming" },
                    ]}
                    value={activeTab}
                    onValueChange={(value: HomeTab) => setActiveTab(value)}
                  />

                  <SegmentedControl
                    className="mb-3"
                    options={[
                      { value: "all", label: "All" },
                      { value: "tv", label: "TV" },
                      { value: "anime", label: "Anime" },
                    ]}
                    value={mediaFilter}
                    onValueChange={(value: HomeMediaFilter) => setMediaFilter(value)}
                  />

                  <FilterChipGroup
                    className="mb-3"
                    options={watchlistStatusOptionsWithCount}
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value)}
                  />

                  {isWatchlistLoading ? (
                    <View className="mt-6 items-center py-10">
                      <ActivityIndicator size="small" color="#ef4444" />
                    </View>
                  ) : null}

                  {!isWatchlistLoading && filteredWatchlist.length === 0 ? (
                    <View className="mt-6 items-center rounded-xl border-2 border-border-default bg-bg-surface px-6 py-12">
                      <Text className="text-lg font-semibold text-text-primary">
                        No results for these filters
                      </Text>
                      <Text className="mt-1 text-center text-sm text-text-secondary">
                        Try changing media or status filters.
                      </Text>
                    </View>
                  ) : null}
                </View>
              }
              ListFooterComponent={
                !isWatchlistLoading && hasMoreWatchlist ? (
                  <View className="items-center py-4">
                    <ActivityIndicator
                      size="small"
                      color={isLoadingMoreWatchlist ? "#ef4444" : "#52525b"}
                    />
                  </View>
                ) : null
              }
            />
          ) : (
            <View className="flex-1">
              <View className="pb-3">
                <PageIntro
                  title={headerText.title}
                  subtitle={headerText.subtitle}
                  eyebrow="Calendar"
                  icon="calendar-outline"
                  rightLabel={`${upcomingCount} episodes`}
                  className="mb-4"
                />

                <SegmentedControl
                  className="mb-3"
                  options={[
                    { value: "watchlist", label: "Watchlist" },
                    { value: "upcoming", label: "Upcoming" },
                  ]}
                  value={activeTab}
                  onValueChange={(value: HomeTab) => setActiveTab(value)}
                />

                <SegmentedControl
                  options={[
                    { value: "all", label: "All" },
                    { value: "tv", label: "TV" },
                    { value: "anime", label: "Anime" },
                  ]}
                  value={mediaFilter}
                  onValueChange={(value: HomeMediaFilter) => setMediaFilter(value)}
                />

                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="text-[11px] font-black uppercase tracking-wide text-text-secondary">
                    Loaded: {upcomingRangeLabel}
                  </Text>
                  <View
                    className={`rounded-md border px-2.5 py-1 ${
                      isTodayVisible
                        ? "border-primary/70 bg-primary/20"
                        : "border-border-default bg-bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-[11px] font-black uppercase tracking-wide ${
                        isTodayVisible ? "text-primary" : "text-text-secondary"
                      }`}
                    >
                      TODAY {getDateLabel(todayKey)}
                    </Text>
                  </View>
                </View>

                <View className="mt-2 flex-row items-center gap-2">
                  <Pressable
                    onPress={triggerLoadPast}
                    disabled={isLoadingPast}
                    className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5"
                    style={({ pressed }) => ({
                      opacity: isLoadingPast ? 0.45 : pressed ? 0.85 : 1,
                    })}
                  >
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-text-primary">
                      {isLoadingPast ? "Loading Earlier..." : "Load Earlier"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={triggerLoadFuture}
                    disabled={isLoadingFuture}
                    className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5"
                    style={({ pressed }) => ({
                      opacity: isLoadingFuture ? 0.45 : pressed ? 0.85 : 1,
                    })}
                  >
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-text-primary">
                      {isLoadingFuture ? "Loading Later..." : "Load Later"}
                    </Text>
                  </Pressable>

                  {todayAnchorIndex >= 0 ? (
                    <Pressable
                      onPress={jumpToToday}
                      className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5"
                      style={({ pressed }) =>
                        pressed ? { opacity: 0.85 } : undefined
                      }
                    >
                      <Text className="text-[11px] font-bold uppercase tracking-wide text-text-primary">
                        {isTodayVisible ? "On Today" : "Jump to Today"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {!isUpcomingLoading && upcomingGroups.length > 0 && isLoadingPast ? (
                  <View className="mt-2 flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="text-xs text-text-secondary">
                      Loading earlier days...
                    </Text>
                  </View>
                ) : null}

              </View>

              <FlashList
                ref={upcomingScrollRef}
                data={upcomingListData}
                keyExtractor={(item) => item.id}
                renderItem={renderUpcomingListItem as any}
                getItemType={(item) => item.type}
                stickyHeaderIndices={stickyHeaderIndices}
                onScroll={onUpcomingScroll}
                onViewableItemsChanged={onUpcomingViewableItemsChanged as any}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator
                contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
                ListEmptyComponent={
                  isUpcomingLoading ? (
                    <View className="items-center py-10">
                      <ActivityIndicator size="small" color="#ef4444" />
                      <Text className="mt-2 text-xs text-text-secondary">
                        Loading schedule...
                      </Text>
                    </View>
                  ) : (
                    <View className="items-center rounded-xl border-2 border-border-default bg-bg-surface px-6 py-12">
                      <Text className="text-lg font-semibold text-text-primary">
                        No upcoming episodes
                      </Text>
                      <Text className="mt-1 text-center text-sm text-text-secondary">
                        Shows with future episodes will appear here.
                      </Text>
                    </View>
                  )
                }
                ListFooterComponent={
                  !isUpcomingLoading && upcomingGroups.length > 0 && isLoadingFuture ? (
                    <View className="items-center py-2">
                      <ActivityIndicator size="small" color="#ef4444" />
                      <Text className="mt-1 text-xs text-text-secondary">
                        Loading later days...
                      </Text>
                    </View>
                  ) : null
                }
              />
            </View>
          )
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="#ef4444" />
          </View>
        )}
      </View>
    </ScreenWrapper>
  );
}

export { HomeScreen as default };
