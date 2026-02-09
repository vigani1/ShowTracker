import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { getTabContentWidth } from "@/constants/navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchAniList } from "@/lib/api/anilist";
import { searchJikan } from "@/lib/api/jikan";
import { normalizeAniListMedia, normalizeTmdbMedia } from "@/lib/api/normalize";
import { searchTmdb } from "@/lib/api/tmdb";
import type { NormalizedShow } from "@/lib/api/types";
import { createShowRouteId } from "@/lib/show-route";

type SearchFilter = "all" | "tv" | "anime" | "movie";

const filterOptions: { key: SearchFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "tv", label: "TV" },
  { key: "anime", label: "Anime" },
  { key: "movie", label: "Movies" },
];

function mergeUniqueShows(shows: NormalizedShow[]) {
  const seen = new Set<string>();
  const result: NormalizedShow[] = [];

  shows.forEach((show) => {
    const key = `${show.id}:${show.mediaType}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(show);
  });

  return result;
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
    return "23.5%";
  }
  if (columns === 3) {
    return "31.8%";
  }
  return "48%";
}

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const contentWidth = getTabContentWidth(width, isWeb);
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
        const tmdbType: "multi" | "tv" | "movie" =
          filter === "all" ? "multi" : filter;
        requests.push(
          searchTmdb(normalizedQuery, tmdbType, 1).then((response) =>
            response.results
              .filter((item) => item.media_type !== "person")
              .map(normalizeTmdbMedia)
          )
        );
      }

      if (filter === "all" || filter === "anime") {
        requests.push(
          searchAniList(normalizedQuery, 1, 20)
            .then((response) =>
              response.data.Page.media.map(normalizeAniListMedia)
            )
            .catch(() => searchJikan(normalizedQuery, 1))
        );
      }

      const settled = await Promise.allSettled(requests);

      if (requestIdRef.current !== currentRequestId) {
        return;
      }

      const fulfilledResults = settled.filter(
        (entry): entry is PromiseFulfilledResult<NormalizedShow[]> =>
          entry.status === "fulfilled"
      );

      const fulfilled = fulfilledResults.flatMap((entry) => entry.value);
      const failedCount = settled.length - fulfilledResults.length;

      if (!fulfilled.length && failedCount > 0) {
        setResults([]);
        setError("Search is temporarily unavailable. Please try again.");
      } else {
        const merged = mergeUniqueShows(fulfilled);
        setResults(merged);
        setError(
          failedCount > 0
            ? "Some sources are unavailable. Showing partial results."
            : null
        );
      }
      setIsLoading(false);
    };

    runSearch().catch((searchError) => {
      if (requestIdRef.current !== currentRequestId) {
        return;
      }
      console.error("Search failed", searchError);
      setError("Search failed. Please try again.");
      setResults([]);
      setIsLoading(false);
    });
  }, [debouncedQuery, filter]);

  const resultLabel = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return "Start typing a title or keyword.";
    }
    if (isLoading) {
      return "Searching the catalog...";
    }
    if (!results.length) {
      return "No results found.";
    }
    return `${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [debouncedQuery, isLoading, results.length]);
  const columns = getGridColumnCount(contentWidth, isWeb);
  const gridItemWidth = getGridItemWidth(columns);
  const showOverview = isWeb && contentWidth >= 1660;

  return (
    <ScreenWrapper>
      <FlashList
        data={results}
        key={`search-grid-${isWeb ? columns : 2}`}
        numColumns={isWeb ? columns : 2}
        keyExtractor={(item) => `${item.id}-${item.mediaType}`}
        estimatedItemSize={isWeb ? 360 : 330}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <MediaPosterCard
            show={item}
            href={{
              pathname: "/show/[id]",
              params: { id: createShowRouteId(item) },
            }}
            className={isWeb ? "w-full" : "w-full"}
            containerStyle={isWeb ? { width: gridItemWidth } : undefined}
            posterClassName={isWeb ? "h-56" : "h-64"}
            showOverview={showOverview}
          />
        )}
        ListHeaderComponent={
          <View className="pb-0">
            <View className="mb-3 flex-row items-center justify-between px-1">
              <Text className="pt-[4px] text-[10px] font-bold uppercase tracking-[1.5px] text-brand-ink-soft dark:text-[#d8c8ab]">
                Search desk
              </Text>
              <Text className="pt-[4px] text-[10px] font-semibold uppercase tracking-[1.4px] text-brand-ink-soft dark:text-[#d8c8ab]">
                Cross-source
              </Text>
            </View>

            <View className="mb-4 rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface p-4 dark:border-brand-surface/75 dark:bg-brand-surface/75">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search shows, anime, movies..."
                placeholderTextColor="#7a6650"
                autoCapitalize="none"
                className="rounded-xl border-2 border-brand-frame/45 bg-[#fffaf0] px-4 py-3 text-base text-brand-ink dark:border-brand-surface/70 dark:bg-brand-background/70 dark:text-brand-text"
              />
              <View className="mt-3 flex-row flex-wrap gap-2">
                {filterOptions.map((option) => {
                  const active = option.key === filter;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setFilter(option.key)}
                      className={`rounded-full border-2 px-4 py-2 ${
                        active
                          ? "border-brand-primary bg-brand-primary"
                          : "border-brand-frame/45 bg-brand-light-background dark:border-brand-surface/65 dark:bg-brand-background/65"
                      }`}
                    >
                      <Text
                        className={`text-[11px] font-bold uppercase tracking-[1.2px] ${
                          active
                            ? "text-white"
                            : "text-brand-ink dark:text-brand-text"
                        }`}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-[11px] font-semibold uppercase tracking-[1.2px] text-brand-ink-soft dark:text-[#d8c8ab]">
                {resultLabel}
              </Text>
              {isLoading ? <ActivityIndicator size="small" color="#cf5d3f" /> : null}
            </View>

            {error ? (
              <View className="mb-4 rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-3">
                <Text className="text-sm text-amber-700 dark:text-amber-300">
                  {error}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
            !debouncedQuery.trim() ? (
              <View className="mt-2 rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface px-4 py-5 dark:border-brand-surface/65 dark:bg-brand-surface/70">
                <Text className="text-sm text-brand-ink-soft dark:text-[#e2d7c1]">
                  Suggestions: “The Last of Us”, “Frieren”, “Oppenheimer”
                </Text>
              </View>
            ) : (
              <View className="mt-2 rounded-2xl border-2 border-brand-frame/50 bg-brand-light-surface px-4 py-5 dark:border-brand-surface/65 dark:bg-brand-surface/70">
                <Text className="text-sm text-brand-ink-soft dark:text-[#e2d7c1]">
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
