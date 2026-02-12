import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SearchInput } from "@/components/SearchInput";
import { SegmentedControl } from "@/components/SegmentedControl";
import { PageIntro } from "@/components/PageIntro";
import { getMainContentWidth } from "@/constants/navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchAniList } from "@/lib/api/anilist";
import { searchJikan } from "@/lib/api/jikan";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { searchTmdb } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";

type SearchFilter = "all" | "tv" | "anime" | "movie";

const filterOptions = [
  { value: "all" as const, label: "All" },
  { value: "tv" as const, label: "TV" },
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

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const contentWidth = getMainContentWidth(width, isWeb, false);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const debouncedQuery = useDebouncedValue(query, 350);
  const [results, setResults] = useState<NormalizedShow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const normalizedQuery = debouncedQuery.trim();
    if (!normalizedQuery) {
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
      if (filter === "all" || filter === "tv" || filter === "movie") {
        const tmdbType: "multi" | "tv" | "movie" = filter === "all" ? "multi" : filter;
        requests.push(
          searchTmdb(normalizedQuery, tmdbType, 1).then((r) =>
            r.results.filter((item) => item.media_type !== "person").map(normalizeTmdbMedia)
          )
        );
      }
      if (filter === "all" || filter === "anime") {
        requests.push(
          searchAniList(normalizedQuery, 1, 20)
            .then((r) => r.data.Page.media.map(normalizeAniListMedia))
            .catch(() => searchJikan(normalizedQuery, 1))
        );
      }

      const settled = await Promise.allSettled(requests);
      if (requestIdRef.current !== currentRequestId) return;

      const fulfilled = settled.filter(
        (e): e is PromiseFulfilledResult<NormalizedShow[]> => e.status === "fulfilled"
      );
      const flat = fulfilled.flatMap((e) => e.value);
      const failedCount = settled.length - fulfilled.length;

      if (!flat.length && failedCount > 0) {
        setResults([]);
        setError("Search is temporarily unavailable. Please try again.");
      } else {
        setResults(mergeUniqueShows(flat));
        setError(failedCount > 0 ? "Some sources unavailable. Showing partial results." : null);
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
  }, [debouncedQuery, filter]);

  const resultLabel = useMemo(() => {
    if (!debouncedQuery.trim()) return "";
    if (isLoading) return "Searching...";
    if (!results.length) return "No results found";
    return `${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [debouncedQuery, isLoading, results.length]);

  const columns = getGridColumnCount(contentWidth, isWeb);

  return (
    <ScreenWrapper>
      <FlashList
        data={results}
        key={`search-grid-${isWeb ? columns : 2}`}
        numColumns={isWeb ? columns : 2}
        keyExtractor={(item) => `${item.id}-${item.mediaType}`}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
        renderItem={({ item }) => (
          <View style={{ flex: 1, paddingHorizontal: GRID_GAP / 2 }}>
            <MediaPosterCard
              show={item}
              href={{ pathname: "/show/[id]", params: { id: createShowRouteId(item) } }}
              className="w-full"
              posterClassName={isWeb ? "h-56" : "h-64"}
            />
          </View>
        )}
        ListHeaderComponent={
          <View className="pb-2">
            <PageIntro
              title="Search"
              subtitle="Find shows, anime, and movies across all sources"
              eyebrow="Universal search"
              icon="search-outline"
              rightLabel={debouncedQuery.trim() && !isLoading ? `${results.length} found` : undefined}
              className="mb-4"
            />

            <SearchInput
              value={query}
              onChangeText={setQuery}
              className="mb-3"
            />

            <SegmentedControl
              options={filterOptions}
              value={filter}
              onValueChange={setFilter}
              className="mb-4"
            />

            {resultLabel ? (
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-medium text-text-secondary">{resultLabel}</Text>
                {isLoading ? <ActivityIndicator size="small" color="#ef4444" /> : null}
              </View>
            ) : null}

            {error ? (
              <View className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 p-3">
                <Text className="text-sm text-warning">{error}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
              !debouncedQuery.trim() ? (
              <View className="mt-2 items-center rounded-2xl border border-border-default bg-bg-surface px-4 py-8">
                <Text className="text-base font-semibold text-text-primary">Search for anything</Text>
                <Text className="mt-1 text-sm text-text-secondary text-center">
                  Try "The Last of Us", "Frieren", "Oppenheimer"
                </Text>
              </View>
            ) : (
              <View className="mt-2 rounded-2xl border border-border-default bg-bg-surface px-4 py-5">
                <Text className="text-sm text-text-secondary">
                  Try a broader keyword or switch the filter.
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
