import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useLocalSearchParams } from "expo-router";
import { useQuery } from "convex/react";
import { FlashList } from "@shopify/flash-list";
import { api } from "@/convex/_generated/api";
import {
  ClearFilterChip,
  DropdownFilterChip,
  FilterBar,
} from "@/components/FilterBar";
import { PageIntro } from "@/components/PageIntro";
import { SearchInput } from "@/components/SearchInput";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useStableCount,
  useStableDisplayValue,
} from "@/hooks/use-stable-display-value";
import {
  applyTrackingFilters,
  matchesStatusFilter,
  type TrackingStatusFilter,
} from "@/lib/filters/tracking-filters";
import { toHttpsImageUrl } from "@/lib/image-url";

type LibraryMediaTab = "all" | "tv" | "anime" | "movie";
type LibraryStatusFilter = TrackingStatusFilter;

type LibraryItem = {
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
  malId: number | null;
  tvmazeId: number | null;
  imdbId: string | null;
  watchedEpisodes: number;
  totalEpisodes: number | null;
  remainingEpisodes: number | null;
  progressPercent: number | null;
  lastActivityAt: number;
  genres: string[];
  rating?: number | null;
};

type LibraryDashboardItem = LibraryItem;

const GRID_GAP = 12;

const tabOptions = [
  { value: "all" as const, label: "All" },
  { value: "tv" as const, label: "TV Shows" },
  { value: "anime" as const, label: "Anime" },
  { value: "movie" as const, label: "Movies" },
];

const seriesStatusOptions: { value: LibraryStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "watching", label: "Watching" },
  { value: "plan_to_watch", label: "Planned" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
];

const movieStatusOptions: { value: LibraryStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "plan_to_watch", label: "Planned" },
  { value: "watched", label: "Watched" },
  { value: "dropped", label: "Dropped" },
];

function getRouteId(item: LibraryItem) {
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

function getItemKey(item: LibraryItem) {
  return (
    getRouteId(item) ??
    item.id ??
    `${item.mediaType}:${item.title}:${item.firstAired ?? "unknown"}`
  );
}

function formatStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "watching") return "Watching";
  if (normalized === "plan_to_watch") return "Plan to Watch";
  const spaced = normalized.replaceAll("_", " ");
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

function formatLibraryCardStatus(item: Pick<LibraryItem, "mediaType" | "status">) {
  const normalized = item.status.trim().toLowerCase();
  if (item.mediaType === "movie" && normalized === "completed") {
    return "Watched";
  }
  return formatStatus(item.status);
}

function parseMediaTab(value: string | string[] | undefined): LibraryMediaTab | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "all" || normalized === "tv" || normalized === "anime" || normalized === "movie") {
    return normalized;
  }
  return null;
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

function LibraryCard({
  item,
  isCompact,
  isSmallPhone,
}: {
  item: LibraryDashboardItem;
  isCompact: boolean;
  isSmallPhone: boolean;
}) {
  const isFabricEnabled =
    "NativeFabricUIManager" in globalThis || "__turboModuleProxy" in globalThis;
  const missingPosterTitleFitProps = isFabricEnabled
    ? {}
    : {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.72,
      };
  const titleFitProps = isFabricEnabled
    ? {}
    : {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.62,
      };
  const routeId = getRouteId(item);
  const isMovie = item.mediaType === "movie";
  const rawPercent =
    typeof item.progressPercent === "number" ? item.progressPercent : 0;
  const progress = Math.max(0, Math.min(100, rawPercent)) / 100;

  const posterHeight = isCompact ? 206 : 280;

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
            <Text
              className="text-center text-sm font-semibold text-zinc-400"
              numberOfLines={3}
              ellipsizeMode="tail"
              style={isFabricEnabled ? { fontSize: 14, lineHeight: 18 } : undefined}
              {...missingPosterTitleFitProps}
            >
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
        {!isMovie && typeof item.remainingEpisodes === "number" && item.remainingEpisodes > 0 ? (
          <View className="absolute right-2 top-2 rounded-md border-2 border-white/20 bg-black/80 px-2.5 py-1.5">
            <Text className="text-[11px] font-black uppercase tracking-wide text-white">
              {item.remainingEpisodes} left
            </Text>
          </View>
        ) : null}
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <Text
            className={`${isSmallPhone ? "text-[11px]" : "text-sm"} mb-0.5 font-bold leading-4 text-white`}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={isFabricEnabled ? { fontSize: isSmallPhone ? 11 : 14, lineHeight: 16 } : undefined}
            {...titleFitProps}
          >
            {item.title}
          </Text>
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {item.firstAired?.slice(0, 4) ?? "TBA"} · {formatLibraryCardStatus(item)}
          </Text>
          {!isMovie && progress > 0 ? (
            <View className="mt-1.5 h-1 overflow-hidden bg-white/15">
              <View
                className="h-full bg-red-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
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

export default function LibraryScreen() {
  const params = useLocalSearchParams<{ media?: string | string[] }>();
  const [activeTab, setActiveTab] = useState<LibraryMediaTab>("all");
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedRating, setSelectedRating] = useState<string>("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const [gridWidth, setGridWidth] = useState(0);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150);
  const libraryQueryArgs = useMemo(
    () =>
      activeTab === "all"
        ? {}
        : { mediaType: activeTab as "tv" | "anime" | "movie" },
    [activeTab]
  );
  const libraryItems = useQuery(api.shows.getLibrary, libraryQueryArgs);
  const libraryCounts = useQuery(api.shows.getLibraryCounts, {});
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canLoadMoreFromEdgeRef = useRef(true);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    const nextTab = parseMediaTab(params.media);
    if (nextTab) {
      setActiveTab(nextTab);
    }
  }, [params.media]);

  const sourceItems = useMemo(() => {
    if (!libraryItems) return [] as LibraryDashboardItem[];
    return libraryItems as LibraryDashboardItem[];
  }, [libraryItems]);

  // When mediaType is passed server-side, sourceItems is already filtered.
  // Keep a client-side guard for safety during transition.
  const mediaItems = useMemo(
    () =>
      activeTab === "all"
        ? sourceItems
        : sourceItems.filter((item) => item.mediaType === activeTab),
    [activeTab, sourceItems]
  );

  const statusOptions = useMemo(
    () => (activeTab === "movie" ? movieStatusOptions : seriesStatusOptions),
    [activeTab]
  );

  const availableGenres = useMemo(() => {
    const genres = new Set<string>();
    mediaItems.forEach((item) => {
      item.genres?.forEach((genre) => genres.add(genre));
    });
    return Array.from(genres).sort();
  }, [mediaItems]);

  const activeItems = useMemo(() => {
    let items = applyTrackingFilters(mediaItems, {
      media: "all",
      status: statusFilter,
    });

    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    if (normalizedSearch) {
      items = items.filter((item) => {
        const titleMatch = item.title.toLowerCase().includes(normalizedSearch);
        const yearMatch = item.firstAired?.slice(0, 4)?.includes(normalizedSearch);
        return Boolean(titleMatch || yearMatch);
      });
    }

    if (selectedGenres.length > 0) {
      items = items.filter((item) =>
        selectedGenres.some((genre) => item.genres?.includes(genre))
      );
    }

    if (selectedYear) {
      items = items.filter((item) => item.firstAired?.slice(0, 4) === selectedYear);
    }

    if (selectedRating) {
      const minRating = Number(selectedRating);
      items = items.filter((item) => (item.rating ?? 0) >= minRating);
    }

    return items;
  }, [
    debouncedSearchQuery,
    mediaItems,
    selectedGenres,
    selectedRating,
    selectedYear,
    statusFilter,
  ]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((entry) => entry !== genre) : [...prev, genre]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedGenres([]);
    setSelectedYear("");
    setSelectedRating("");
    setOpenDropdown(null);
  };

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedGenres.length > 0 ||
    selectedYear !== "" ||
    selectedRating !== "";
  const isLoading = libraryItems === undefined;

  const rawStatusOptionsWithCounts = useMemo(() => {
    // Use backend counts when available to avoid iterating all items client-side.
    if (libraryCounts) {
      const relevantTypes: string[] =
        activeTab === "all" ? ["tv", "anime", "movie"] : [activeTab];

      const getCountForFilter = (filter: LibraryStatusFilter): number => {
        if (filter === "all") {
          return relevantTypes.reduce(
            (sum, mt) =>
              sum +
              Object.values(libraryCounts[mt] ?? {}).reduce(
                (s, c) => s + (c as number),
                0
              ),
            0
          );
        }
        // Map compound filter names to underlying statuses
        const statusKeys: string[] =
          filter === "active"
            ? ["watching", "plan_to_watch"]
            : filter === "watched"
              ? ["completed"]
              : filter === "not_watched"
                ? ["watching", "paused", "dropped", "plan_to_watch"]
                : [filter];

        return relevantTypes.reduce(
          (sum, mt) =>
            sum +
            statusKeys.reduce(
              (s, sk) => s + ((libraryCounts[mt]?.[sk] as number) ?? 0),
              0
            ),
          0
        );
      };

      return statusOptions.map((option) => ({
        ...option,
        count: getCountForFilter(option.value),
      }));
    }

    // Fallback: compute from loaded items (pre-migration path)
    return statusOptions.map((option) => ({
      ...option,
      count: mediaItems.filter((item) => matchesStatusFilter(item, option.value)).length,
    }));
  }, [activeTab, libraryCounts, mediaItems, statusOptions]);
  const statusOptionsContextKey = `library-status:${activeTab}`;
  const stableStatusOptionsWithCounts = useStableDisplayValue(
    rawStatusOptionsWithCounts,
    {
      contextKey: statusOptionsContextKey,
      isLoading: isLoading || libraryCounts === undefined,
      shouldHold: (options) => options.some((option) => option.count === 0),
    }
  );
  const statusOptionsWithCounts =
    stableStatusOptionsWithCounts ??
    (isLoading || libraryCounts === undefined ? statusOptions : rawStatusOptionsWithCounts);

  useEffect(() => {
    if (!statusOptionsWithCounts.some((option) => option.value === statusFilter)) {
      setStatusFilter("all");
    }
  }, [statusFilter, statusOptionsWithCounts]);

  const activeItemsCountContextKey = [
    "library-active",
    activeTab,
    statusFilter,
    debouncedSearchQuery.trim().toLowerCase(),
    selectedGenres.join(","),
    selectedYear,
    selectedRating,
  ].join(":");
  const stableActiveItemsCount =
    useStableCount(activeItems.length, activeItemsCountContextKey, isLoading) ??
    activeItems.length;
  const effectiveWidth = gridWidth || width;
  const columns = getHomeColumnCount(effectiveWidth, isWeb);
  const isCompactLayout = effectiveWidth < 640;
  const isSmallPhone = width < 390;
  const pageSize = Math.max(columns * 3, 6);
  const hasMore = visibleCount < activeItems.length;

  useEffect(() => {
    setVisibleCount(Math.min(pageSize, activeItems.length));
    setIsLoadingMore(false);
    canLoadMoreFromEdgeRef.current = true;
  }, [
    activeItems.length,
    activeTab,
    pageSize,
    debouncedSearchQuery,
    selectedGenres,
    selectedRating,
    selectedYear,
    statusFilter,
  ]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
    };
  }, []);

  const visibleItems = useMemo(
    () => activeItems.slice(0, visibleCount),
    [activeItems, visibleCount]
  );

  const loadMoreItems = useCallback(() => {
    if (!hasMore || isLoadingMore || isLoading) {
      return;
    }
    setIsLoadingMore(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + pageSize, activeItems.length));
      setIsLoadingMore(false);
    }, 140);
  }, [activeItems.length, hasMore, isLoading, isLoadingMore, pageSize]);

  const onLibraryScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight = event.nativeEvent.contentSize.height;
      const distanceFromBottom = contentHeight - (y + viewportHeight);

      if (distanceFromBottom > 320) {
        canLoadMoreFromEdgeRef.current = true;
      }

      if (
        distanceFromBottom <= 180 &&
        canLoadMoreFromEdgeRef.current &&
        !isLoadingMore &&
        !isLoading
      ) {
        canLoadMoreFromEdgeRef.current = false;
        loadMoreItems();
      }
    },
    [isLoading, isLoadingMore, loadMoreItems]
  );

  const renderLibraryItem = useCallback(
    ({ item, index }: { item: LibraryDashboardItem; index: number }) => {
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
          <LibraryCard
            item={item}
            isCompact={isCompactLayout}
            isSmallPhone={isSmallPhone}
          />
        </View>
      );
    },
    [columns, isCompactLayout, isSmallPhone]
  );

  const headerText =
    activeTab === "all"
      ? { title: "Library", subtitle: "All tracked TV, anime, and movies" }
      : activeTab === "tv"
      ? { title: "TV Library", subtitle: "Your tracked TV shows" }
      : activeTab === "anime"
        ? { title: "Anime Library", subtitle: "Your tracked anime" }
        : { title: "Movie Library", subtitle: "Movies in your queue" };

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={onGridLayout}>
        {gridWidth > 0 ? (
          <FlashList
            key={`${activeTab}-${statusFilter}-${selectedGenres.join(",")}`}
            data={visibleItems}
            keyExtractor={getItemKey}
            renderItem={renderLibraryItem}
            numColumns={columns}
            ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
            onEndReached={() => {
              if (!canLoadMoreFromEdgeRef.current) {
                return;
              }
              canLoadMoreFromEdgeRef.current = false;
              loadMoreItems();
            }}
            onEndReachedThreshold={0.5}
            onScroll={onLibraryScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
            ListHeaderComponent={
              <View className="pb-2">
                <PageIntro
                  title={headerText.title}
                  subtitle={headerText.subtitle}
                  eyebrow="Your library"
                  icon={
                    activeTab === "movie"
                      ? "film-outline"
                      : activeTab === "anime"
                        ? "planet-outline"
                        : "tv-outline"
                  }
                  rightLabel={`${stableActiveItemsCount} matched`}
                  className="mb-4"
                  compact={isCompactLayout}
                />

                <FilterBar
                  options={tabOptions}
                  value={activeTab}
                  onValueChange={setActiveTab}
                  className="mb-3"
                  align="center"
                  compact={isCompactLayout}
                />

                <SearchInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search your library by title or year..."
                  className="mb-3"
                />

                <FilterBar
                  className="mb-3"
                  options={statusOptionsWithCounts}
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value)}
                  align="center"
                />

                {/* Filter Buttons */}
                <View className="mb-3">
                  <View className="flex-row flex-wrap justify-center gap-2">
                    {/* Genre Button */}
                    {availableGenres.length > 0 && (
                      <DropdownFilterChip
                        onPress={() => setOpenDropdown(openDropdown === "genres" ? null : "genres")}
                        active={selectedGenres.length > 0}
                        open={openDropdown === "genres"}
                        label={selectedGenres.length > 0 ? `${selectedGenres.length} Genre${selectedGenres.length > 1 ? "s" : ""}` : "Genre"}
                      />
                    )}

                    {/* Year Button */}
                    <DropdownFilterChip
                      onPress={() => setOpenDropdown(openDropdown === "year" ? null : "year")}
                      active={Boolean(selectedYear)}
                      open={openDropdown === "year"}
                      label={selectedYear || "Year"}
                    />

                    {/* Rating Button */}
                    <DropdownFilterChip
                      onPress={() => setOpenDropdown(openDropdown === "rating" ? null : "rating")}
                      active={Boolean(selectedRating)}
                      open={openDropdown === "rating"}
                      label={selectedRating ? `${selectedRating}+` : "Rating"}
                    />

                    {/* Clear Button */}
                    {hasActiveFilters && (
                      <ClearFilterChip onPress={clearFilters} />
                    )}
                  </View>

                  {/* Genre Dropdown */}
                  {openDropdown === "genres" && availableGenres.length > 0 && (
                    <View className="mt-2 rounded-xl border border-border-default bg-bg-surface p-3">
                      <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Select Genres</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {availableGenres.map((genre) => (
                          <Pressable
                            key={genre}
                            onPress={() => toggleGenre(genre)}
                            className={`rounded-full border px-3 py-1.5 ${
                              selectedGenres.includes(genre)
                                ? "border-primary bg-primary"
                                : "border-border-default bg-bg-primary"
                            }`}
                          >
                            <Text className={`text-xs ${selectedGenres.includes(genre) ? "text-white" : "text-text-secondary"}`}>
                              {genre}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Year Dropdown */}
                  {openDropdown === "year" && (
                    <View className="mt-2 rounded-xl border border-border-default bg-bg-surface p-3">
                      <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Select Year</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2">
                          <Pressable
                            onPress={() => { setSelectedYear(""); setOpenDropdown(null); }}
                            className={`rounded-full border px-4 py-2 ${!selectedYear ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                          >
                            <Text className={`text-sm ${!selectedYear ? "text-white" : "text-text-secondary"}`}>Any</Text>
                          </Pressable>
                          {Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - i).toString()).map((year) => (
                            <Pressable
                              key={year}
                              onPress={() => { setSelectedYear(year); setOpenDropdown(null); }}
                              className={`rounded-full border px-4 py-2 ${selectedYear === year ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                            >
                              <Text className={`text-sm ${selectedYear === year ? "text-white" : "text-text-secondary"}`}>
                                {year}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  )}

                  {/* Rating Dropdown */}
                  {openDropdown === "rating" && (
                    <View className="mt-2 rounded-xl border border-border-default bg-bg-surface p-3">
                      <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Min Rating</Text>
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => { setSelectedRating(""); setOpenDropdown(null); }}
                          className={`flex-1 rounded-lg border py-2 ${!selectedRating ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                        >
                          <Text className={`text-center text-sm ${!selectedRating ? "text-white" : "text-text-secondary"}`}>Any</Text>
                        </Pressable>
                        {["8", "7", "6", "5"].map((rating) => (
                          <Pressable
                            key={rating}
                            onPress={() => { setSelectedRating(rating); setOpenDropdown(null); }}
                            className={`flex-1 rounded-lg border py-2 ${selectedRating === rating ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                          >
                            <Text className={`text-center text-sm ${selectedRating === rating ? "text-white" : "text-text-secondary"}`}>
                              {rating}+
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Selected Genre Tags */}
                  {selectedGenres.length > 0 && (
                    <View className="mt-2 flex-row flex-wrap gap-2">
                      {selectedGenres.map((genre) => (
                        <Pressable
                          key={genre}
                          onPress={() => toggleGenre(genre)}
                          className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1"
                        >
                          <Text className="text-xs font-medium text-white">{genre}</Text>
                          <Text className="text-xs text-white">×</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Selected Year & Rating Tags */}
                  {(selectedYear || selectedRating) && (
                    <View className="mt-2 flex-row flex-wrap gap-2">
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
                </View>

                {isLoading ? (
                  <View className="items-center gap-2 rounded-xl border-2 border-border-default bg-bg-surface py-8">
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="text-sm text-text-secondary">
                      Loading your library
                    </Text>
                  </View>
                ) : null}

                {!isLoading && !activeItems.length ? (
                  <View className="rounded-xl border-2 border-border-default bg-bg-surface px-4 py-6">
                    <Text className="text-lg font-bold text-text-primary">
                      No titles for these filters
                    </Text>
                    <Text className="mt-1 text-sm leading-relaxed text-text-secondary">
                      Try adjusting your search, status, or filter selections.
                    </Text>
                  </View>
                ) : null}
              </View>
            }
            ListFooterComponent={
              !isLoading && hasMore ? (
                <View className="items-center py-4">
                  <ActivityIndicator
                    size="small"
                    color={isLoadingMore ? "#ef4444" : "#52525b"}
                  />
                  <Text className="mt-1 text-xs text-text-secondary">
                    {isLoadingMore ? "Loading more..." : "Scroll for more"}
                  </Text>
                </View>
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
