import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
  useWindowDimensions,
  ScrollView,
  Pressable,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SearchInput } from "@/components/SearchInput";
import { SegmentedControl } from "@/components/SegmentedControl";
import { PageIntro } from "@/components/PageIntro";
import { getMainContentWidth } from "@/constants/navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchAniList, type AniListFilterParams } from "@/lib/api/anilist";
import { searchJikan } from "@/lib/api/jikan";
import { normalizeStatus } from "@/lib/metadata-utils";
import { searchTmdb, discoverTmdb, type TmdbFilterParams } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";
import { getFiltersForMediaType } from "@/lib/filters";

type SearchFilter = "all" | "tv" | "anime" | "movie";

const filterOptions = [
  { value: "all" as const, label: "All" },
  { value: "tv" as const, label: "TV Shows" },
  { value: "anime" as const, label: "Anime" },
  { value: "movie" as const, label: "Movies" },
];

function mergeUniqueShows(shows: NormalizedShow[]) {
  const seen = new Set<string>();
  const result: NormalizedShow[] = [];
  shows.forEach((show) => {
    const key = `${show.id}:${show.mediaType}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(show);
  });
  return result;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSearchTitleScore(show: NormalizedShow, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(show.title);

  if (!normalizedQuery || !normalizedTitle) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 1000;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 850;
  }

  const titleTokens = normalizedTitle.split(" ").filter(Boolean);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const exactTokenMatches = queryTokens.filter((queryToken) =>
    titleTokens.includes(queryToken)
  ).length;
  const prefixTokenMatches = queryTokens.filter((queryToken) =>
    titleTokens.some((titleToken) => titleToken.startsWith(queryToken))
  ).length;

  if (queryTokens.length > 0 && exactTokenMatches === queryTokens.length) {
    return 700;
  }

  if (queryTokens.length > 0 && prefixTokenMatches === queryTokens.length) {
    return 560;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 420;
  }

  if (exactTokenMatches > 0) {
    return 320 + exactTokenMatches * 20;
  }

  if (prefixTokenMatches > 0) {
    return 220 + prefixTokenMatches * 15;
  }

  return 0;
}

function rankSearchResults(shows: NormalizedShow[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return shows;
  }

  return shows
    .map((show, index) => ({
      show,
      index,
      score: getSearchTitleScore(show, normalizedQuery),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.show);
}

function getGridColumnCount(width: number, isWeb: boolean) {
  if (!isWeb) return 2;
  if (width < 640) return 2;
  if (width >= 1800) return 8;
  if (width >= 1500) return 7;
  if (width >= 1260) return 6;
  if (width >= 1040) return 5;
  if (width >= 920) return 4;
  return 3;
}

function matchesAnimeFilterSet(
  show: NormalizedShow,
  filters: AniListFilterParams
) {
  if (filters.genres?.length) {
    const showGenres = new Set((show.genres ?? []).map((genre) => genre.toLowerCase()));
    const hasAnyGenre = filters.genres.some((genre) =>
      showGenres.has(genre.toLowerCase())
    );
    if (!hasAnyGenre) {
      return false;
    }
  }

  if (typeof filters.seasonYear === "number") {
    const yearText = show.firstAired?.slice(0, 4);
    if (!yearText || Number(yearText) !== filters.seasonYear) {
      return false;
    }
  }

  if (typeof filters.minScore === "number") {
    const minimumRating = filters.minScore / 10;
    if ((show.rating ?? 0) < minimumRating) {
      return false;
    }
  }

  if (typeof filters.status === "string" && filters.status.trim()) {
    const expectedStatus = normalizeStatus(filters.status);
    if (!expectedStatus) {
      return false;
    }
    if ((show.status ?? "") !== expectedStatus) {
      return false;
    }
  }

  return true;
}

const GRID_GAP = 12;

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const contentWidth = getMainContentWidth(width, isWeb, false);
  const [filter, setFilter] = useState<SearchFilter>("all");

  // Individual filter states
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedRating, setSelectedRating] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const debouncedQuery = useDebouncedValue(query, 350);
  const [results, setResults] = useState<NormalizedShow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Get available filters
  const availableFilters = useMemo(
    () => getFiltersForMediaType(filter),
    [filter]
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
  const statusOptions = useMemo(
    () => availableFilters.find((f) => f.id === "status")?.options || [],
    [availableFilters]
  );

  const hasActiveFilters = useMemo(
    () =>
      selectedGenres.length > 0 ||
      selectedYear !== "" ||
      selectedRating !== "" ||
      selectedStatus !== "",
    [selectedGenres, selectedYear, selectedRating, selectedStatus]
  );

  const clearFilters = () => {
    setSelectedGenres([]);
    setSelectedYear("");
    setSelectedRating("");
    setSelectedStatus("");
    setOpenDropdown(null);
  };

  useEffect(() => {
    const normalizedQuery = debouncedQuery.trim();

    if (!normalizedQuery && !hasActiveFilters) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;
    setIsLoading(true);
    setError(null);

    const runSearch = async () => {
      const requests: Promise<NormalizedShow[]>[] = [];

      const tmdbFilters: TmdbFilterParams = {
        with_genres: selectedGenres.join(","),
        first_air_date_year:
          selectedYear && (filter === "tv" || filter === "all")
            ? Number(selectedYear)
            : undefined,
        primary_release_year:
          selectedYear && (filter === "movie" || filter === "all")
            ? Number(selectedYear)
            : undefined,
        vote_average_gte: selectedRating ? Number(selectedRating) : undefined,
        with_status: filter === "tv" ? selectedStatus : undefined,
      };

      const anilistFilters: AniListFilterParams = {
        genres: selectedGenres.length > 0 ? selectedGenres : undefined,
        seasonYear: selectedYear ? Number(selectedYear) : undefined,
        minScore: selectedRating ? Number(selectedRating) * 10 : undefined,
        status: selectedStatus || undefined,
      };

      if (filter === "all" || filter === "tv" || filter === "movie") {
        const tmdbType: "multi" | "tv" | "movie" =
          filter === "all" ? "multi" : filter;
        const isFilterOnlySearch = !normalizedQuery && hasActiveFilters;

        if (isFilterOnlySearch) {
          if (tmdbType === "multi") {
            requests.push(
              Promise.all([
                discoverTmdb("tv", 1, tmdbFilters),
                discoverTmdb("movie", 1, tmdbFilters),
              ]).then(([tvResults, movieResults]) =>
                [...tvResults.items, ...movieResults.items]
              )
            );
          } else {
            requests.push(
              discoverTmdb(tmdbType, 1, tmdbFilters).then((r) =>
                r.items
              )
            );
          }
        } else if (hasActiveFilters && filter !== "all") {
          requests.push(
            discoverTmdb(filter, 1, tmdbFilters).then((r) =>
              r.items
            )
          );
        } else {
          requests.push(
            searchTmdb(
              normalizedQuery,
              tmdbType,
              1,
              tmdbFilters
            ).then((r) =>
              r.items
            )
          );
        }
      }

      if (filter === "all" || filter === "anime") {
        requests.push(
          searchAniList(normalizedQuery || "", 1, 20, anilistFilters)
            .then((r) => r.items.filter((show) => matchesAnimeFilterSet(show, anilistFilters)))
            .catch(async () => {
              const fallback = await searchJikan(normalizedQuery || "", 1);
              return fallback.filter((show) => matchesAnimeFilterSet(show, anilistFilters));
            })
        );
      }

      const settled = await Promise.allSettled(requests);
      if (requestIdRef.current !== currentRequestId) return;

      const fulfilled = settled.filter(
        (e): e is PromiseFulfilledResult<NormalizedShow[]> =>
          e.status === "fulfilled"
      );
      const flat = fulfilled.flatMap((e) => e.value);
      const failedCount = settled.length - fulfilled.length;

      if (!flat.length && failedCount > 0) {
        setResults([]);
        setError("Search is temporarily unavailable. Please try again.");
      } else {
        const deduped = mergeUniqueShows(flat);
        setResults(rankSearchResults(deduped, normalizedQuery));
        setError(
          failedCount > 0
            ? "Some sources unavailable. Showing partial results."
            : null
        );
      }
      setIsLoading(false);
    };

    runSearch().catch((err) => {
      if (requestIdRef.current !== currentRequestId) return;
      console.error("Search failed", err);
      setError("Search failed. Please try again.");
      setResults([]);
      setIsLoading(false);
    });
  }, [
    debouncedQuery,
    filter,
    selectedGenres,
    selectedYear,
    selectedRating,
    selectedStatus,
    hasActiveFilters,
  ]);

  const resultLabel = useMemo(() => {
    if (!debouncedQuery.trim() && !hasActiveFilters) return "";
    if (isLoading) return "Searching...";
    if (!results.length) return "No results found";
    return `${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [debouncedQuery, isLoading, results.length, hasActiveFilters]);

  const columns = getGridColumnCount(contentWidth, isWeb);
  const isCompactLayout = contentWidth < 640;

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  return (
    <ScreenWrapper>
      {/* Header Content */}
      <View className="pb-2">
        <PageIntro
          title="Search"
          subtitle="Find shows, anime, and movies"
          eyebrow="Universal search"
          icon="search-outline"
          rightLabel={
            (debouncedQuery.trim() || hasActiveFilters) && !isLoading
              ? `${results.length} found`
              : undefined
          }
          className="mb-4"
          compact={isCompactLayout}
        />

        <SearchInput
          value={query}
          onChangeText={setQuery}
          className="mb-3"
        />

        <SegmentedControl
          options={filterOptions}
          value={filter}
          onValueChange={(newFilter) => {
            setFilter(newFilter);
            clearFilters();
          }}
          className="mb-3"
          compact={isCompactLayout}
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

          {statusOptions.length > 0 && (
            <Pressable
              onPress={() => setOpenDropdown(openDropdown === "status" ? null : "status")}
              className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${
                selectedStatus ? "border-primary bg-primary" : "border-border-default bg-bg-surface"
              }`}
            >
              <Text className={`text-sm font-semibold ${selectedStatus ? "text-white" : "text-text-secondary"}`}>
                {selectedStatus ? statusOptions.find((o) => o.value === selectedStatus)?.label || "Status" : "Status"}
              </Text>
              <Text className={selectedStatus ? "text-white" : "text-text-secondary"}>
                {openDropdown === "status" ? "▲" : "▼"}
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

        {/* Dropdown Content - Inline */}
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

        {openDropdown === "status" && statusOptions.length > 0 && (
          <View className="mb-4 rounded-xl border border-border-default bg-bg-surface p-3">
            <Text className="mb-2 text-xs font-bold uppercase text-text-secondary">Status</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => { setSelectedStatus(""); setOpenDropdown(null); }}
                className={`rounded-full border px-4 py-2 ${!selectedStatus ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
              >
                <Text className={`text-sm ${!selectedStatus ? "text-white" : "text-text-secondary"}`}>Any</Text>
              </Pressable>
              {statusOptions.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => { setSelectedStatus(option.value); setOpenDropdown(null); }}
                  className={`rounded-full border px-4 py-2 ${selectedStatus === option.value ? "border-primary bg-primary" : "border-border-default bg-bg-primary"}`}
                >
                  <Text className={`text-sm ${selectedStatus === option.value ? "text-white" : "text-text-secondary"}`}>
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
            {selectedStatus && (
              <Pressable
                onPress={() => setSelectedStatus("")}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1"
              >
                <Text className="text-xs font-medium text-white">
                  {statusOptions.find((s) => s.value === selectedStatus)?.label}
                </Text>
                <Text className="text-xs text-white">×</Text>
              </Pressable>
            )}
          </View>
        )}

        {resultLabel ? (
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm font-medium text-text-secondary">{resultLabel}</Text>
            {isLoading ? <ActivityIndicator size="small" color="#ef4444" /> : null}
          </View>
        ) : null}

        {error ? (
          <View className="mb-4 rounded-xl border-2 border-warning/30 bg-warning/10 p-3">
            <Text className="text-sm text-warning">{error}</Text>
          </View>
        ) : null}
      </View>

      {/* Results Grid */}
      <FlashList
        data={results}
        key={`search-grid-${isWeb ? columns : 2}`}
        numColumns={isWeb ? columns : 2}
        keyExtractor={(item) => `${item.id}-${item.mediaType}`}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
        contentContainerStyle={{ paddingBottom: 8 }}
        renderItem={({ item }) => (
          <View style={{ flex: 1, paddingHorizontal: GRID_GAP / 2 }}>
            <MediaPosterCard
              show={item}
              href={{
                pathname: "/show/[id]",
                params: { id: createShowRouteId(item) },
              }}
              className="w-full"
              posterClassName={isCompactLayout ? "h-48" : isWeb ? "h-56" : "h-64"}
            />
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            !debouncedQuery.trim() && !hasActiveFilters ? (
              <View className="mt-2 items-center rounded-xl border-2 border-border-default bg-bg-surface px-4 py-8">
                <Text className="text-base font-semibold text-text-primary">
                  Search for anything
                </Text>
                <Text className="mt-1 text-center text-sm text-text-secondary">
                  Try "The Last of Us", "Frieren", "Oppenheimer"
                </Text>
                <Text className="mt-3 text-center text-sm text-text-secondary">
                  Or use filters to discover new shows
                </Text>
              </View>
            ) : (
              <View className="mt-2 rounded-xl border-2 border-border-default bg-bg-surface px-4 py-5">
                <Text className="text-sm text-text-secondary">
                  Try a broader keyword or adjust your filters.
                </Text>
              </View>
            )
          ) : null
        }
        ListFooterComponent={<View className="h-4" />}
      />
    </ScreenWrapper>
  );
}

export default SearchScreen;
