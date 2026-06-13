import { useEffect, useMemo, useState } from "react";
import { Pressable, View, Text, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NormalizedEpisode } from "@/lib/api/types";
import { SwipeableEpisodeCard } from "@/components/SwipeableEpisodeCard";

interface EpisodeAvailability {
  isReleased: boolean;
  dateLabel: string;
  stateLabel: string;
  stateClassName: string;
}

interface SeasonAccordionProps {
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  episodes?: NormalizedEpisode[];
  isExpanded: boolean;
  isLoading: boolean;
  error?: string | null;
  watchedCount: number;
  releasedCount: number;
  isMarking: boolean;
  pendingEpisodeKeys: Record<string, boolean>;
  watchedEpisodeKeys: Set<string>;
  getEpisodeAvailability: (airDate?: string | null) => EpisodeAvailability;
  onToggle: () => void;
  onMarkSeason: () => void;
  onToggleEpisode: (episode: NormalizedEpisode) => void;
  onEpisodeSwipeAction?: (
    episode: NormalizedEpisode,
    action: "watch" | "unwatch" | "rewatch"
  ) => void;
  episodeWatchCounts?: Record<string, number>;
  initialEpisodeWindowIndex?: number | null;
}

const LARGE_SEASON_PAGE_SIZE = 100;
const LARGE_SEASON_OVERFLOW_BUFFER = 25;
const LARGE_SEASON_WINDOW_THRESHOLD =
  LARGE_SEASON_PAGE_SIZE + LARGE_SEASON_OVERFLOW_BUFFER;

function getEpisodePageCount(episodeCount: number) {
  return Math.max(1, Math.ceil(episodeCount / LARGE_SEASON_PAGE_SIZE));
}

function getClampedEpisodePageIndex(episodeCount: number, pageIndex: number) {
  const maxPageIndex = getEpisodePageCount(episodeCount) - 1;
  return Math.max(0, Math.min(pageIndex, maxPageIndex));
}

function getInitialEpisodePageIndex(
  episodeCount: number,
  initialIndex?: number | null
) {
  if (episodeCount <= 0) {
    return 0;
  }

  if (episodeCount <= LARGE_SEASON_WINDOW_THRESHOLD) {
    return 0;
  }

  const safeInitialIndex =
    typeof initialIndex === "number" && Number.isFinite(initialIndex)
      ? Math.max(0, Math.min(initialIndex, episodeCount - 1))
      : 0;
  return getClampedEpisodePageIndex(
    episodeCount,
    Math.floor(safeInitialIndex / LARGE_SEASON_PAGE_SIZE)
  );
}

function getEpisodePageRange(episodeCount: number, pageIndex: number) {
  if (episodeCount <= 0) {
    return { pageIndex: 0, start: 0, end: -1 };
  }

  const safePageIndex = getClampedEpisodePageIndex(episodeCount, pageIndex);
  const start = safePageIndex * LARGE_SEASON_PAGE_SIZE;

  return {
    pageIndex: safePageIndex,
    start,
    end: Math.min(episodeCount - 1, start + LARGE_SEASON_PAGE_SIZE - 1),
  };
}

function formatEpisodeRange(start: number, end: number) {
  return `${start + 1}-${end + 1}`;
}

interface EpisodePageIconButtonProps {
  accessibilityLabel: string;
  disabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

function EpisodePageIconButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
}: EpisodePageIconButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      className="h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-bg-surface"
      style={({ pressed }) => ({
        opacity: disabled ? 0.35 : pressed ? 0.78 : 1,
      })}
    >
      <Ionicons name={icon} size={15} color={disabled ? "#52525b" : "#d4d4d8"} />
    </Pressable>
  );
}

export function SeasonAccordion({
  seasonNumber,
  name,
  episodeCount,
  episodes = [],
  isExpanded,
  isLoading,
  error,
  watchedCount,
  releasedCount,
  isMarking,
  pendingEpisodeKeys,
  watchedEpisodeKeys,
  getEpisodeAvailability,
  onToggle,
  onMarkSeason,
  onToggleEpisode,
  onEpisodeSwipeAction,
  episodeWatchCounts,
  initialEpisodeWindowIndex,
}: SeasonAccordionProps) {
  // Check if all episodes are watched
  // When episodes are loaded, compare against released count
  // When episodes aren't loaded yet, compare against total episode count
  const isFullyWatched = releasedCount > 0
    ? watchedCount >= releasedCount
    : (episodeCount != null && episodeCount > 0 && watchedCount >= episodeCount);
  const hasUnreleased = episodes.length > 0 && releasedCount < episodes.length;
  const displayName = name || `Season ${seasonNumber}`;
  const [episodeWindowPage, setEpisodeWindowPage] = useState(() =>
    getInitialEpisodePageIndex(episodes.length, initialEpisodeWindowIndex)
  );
  const [isEpisodePagePickerOpen, setIsEpisodePagePickerOpen] = useState(false);
  const shouldWindowEpisodes = episodes.length > LARGE_SEASON_WINDOW_THRESHOLD;
  const episodePageCount = shouldWindowEpisodes
    ? getEpisodePageCount(episodes.length)
    : 1;
  const safeEpisodeWindowPage = shouldWindowEpisodes
    ? getClampedEpisodePageIndex(episodes.length, episodeWindowPage)
    : 0;
  const episodeWindowRange = useMemo(
    () => getEpisodePageRange(episodes.length, safeEpisodeWindowPage),
    [episodes.length, safeEpisodeWindowPage]
  );
  const episodePageOptions = useMemo(() => {
    if (!shouldWindowEpisodes) {
      return [];
    }

    return Array.from({ length: episodePageCount }, (_, pageIndex) =>
      getEpisodePageRange(episodes.length, pageIndex)
    );
  }, [episodePageCount, episodes.length, shouldWindowEpisodes]);
  const canGoToPreviousEpisodePage = safeEpisodeWindowPage > 0;
  const canGoToNextEpisodePage = safeEpisodeWindowPage < episodePageCount - 1;

  useEffect(() => {
    setEpisodeWindowPage(
      getInitialEpisodePageIndex(episodes.length, initialEpisodeWindowIndex)
    );
    setIsEpisodePagePickerOpen(false);
  }, [episodes.length, initialEpisodeWindowIndex, isExpanded, seasonNumber]);

  const visibleEpisodes = useMemo(() => {
    if (!shouldWindowEpisodes) {
      return episodes;
    }

    return episodes.slice(episodeWindowRange.start, episodeWindowRange.end + 1);
  }, [episodeWindowRange.end, episodeWindowRange.start, episodes, shouldWindowEpisodes]);

  const selectEpisodePage = (pageIndex: number) => {
    setEpisodeWindowPage(getClampedEpisodePageIndex(episodes.length, pageIndex));
    setIsEpisodePagePickerOpen(false);
  };

  const shiftEpisodeWindow = (direction: "previous" | "next") => {
    setEpisodeWindowPage((currentPage) => {
      const delta = direction === "previous" ? -1 : 1;
      return getClampedEpisodePageIndex(episodes.length, currentPage + delta);
    });
    setIsEpisodePagePickerOpen(false);
  };

  // Button is enabled if episodes haven't been loaded yet, or if there are released episodes
  const canMarkSeason = episodes.length === 0 || releasedCount > 0;

  return (
    <View className="overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface">
      {/* Header */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? "Collapse season" : "Expand season"}
        accessibilityState={{ expanded: isExpanded }}
        className="p-4 active:bg-bg-elevated/50"
        style={({ pressed }) => ({
          backgroundColor: pressed ? "rgba(39,39,42,0.3)" : undefined,
        })}
      >
        <View className="flex-row items-center gap-4">
          {/* Season Number Circle */}
          <View className="h-12 w-12 items-center justify-center rounded-md border-2 border-primary/40 bg-primary/15">
            <Text className="text-lg font-black text-primary">
              {seasonNumber}
            </Text>
          </View>

          {/* Info */}
          <View className="flex-1">
            <Text className="text-base font-semibold text-text-primary">
              {displayName}
            </Text>
            <Text className="text-xs text-text-secondary">
              {episodeCount ? `${episodeCount} episodes` : "Episode count unavailable"}
              {watchedCount > 0 && ` · ${watchedCount} watched`}
              {hasUnreleased && ` · ${episodes.length - releasedCount} upcoming`}
            </Text>
          </View>

          {/* Right side actions */}
          <View className="flex-row items-center gap-3">
            {/* Mark All Radio Button */}
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onMarkSeason();
              }}
              disabled={isMarking || isLoading || !canMarkSeason}
              accessibilityRole="button"
              accessibilityLabel={isFullyWatched ? "Mark season unwatched" : "Mark season watched"}
              accessibilityState={{ disabled: isMarking || isLoading || !canMarkSeason }}
              className="relative h-7 w-7 items-center justify-center"
              style={({ pressed }) => ({
                opacity: isMarking || isLoading || !canMarkSeason ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              })}
            >
              {/* Outer ring */}
              <View 
                className={`absolute h-7 w-7 rounded-full border-2 ${
                  isFullyWatched 
                    ? "border-success" 
                    : !canMarkSeason
                      ? "border-border-default" 
                      : "border-border-bright"
                }`}
              />
              
              {/* Loading - shows during update, replaces watched state */}
              {isMarking ? (
                <ActivityIndicator size="small" color="#a1a1aa" />
              ) : (
                <>
                  {/* Fill circle - shown when fully watched */}
                  {isFullyWatched && (
                    <View className="h-4 w-4 rounded-full bg-success" />
                  )}

                  {/* Checkmark */}
                  {isFullyWatched && (
                    <View className="absolute inset-0 items-center justify-center">
                      <Text className="text-xs font-bold text-white">✓</Text>
                    </View>
                  )}
                </>
              )}
            </Pressable>

            <View className="h-7 w-px bg-border-default" />

            {/* Chevron */}
            <View
              className={`h-8 w-8 items-center justify-center rounded-lg border ${
                isExpanded
                  ? "border-primary/45 bg-primary/15"
                  : "border-border-default bg-bg-elevated"
              }`}
            >
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={isExpanded ? "#ef4444" : "#d4d4d8"}
              />
            </View>
          </View>
        </View>
      </Pressable>

      {/* Expanded Content */}
      {isExpanded && (
        <View className="border-t border-border-default">
          <View className="p-4">
            {isLoading ? (
              <View className="flex-row items-center justify-center gap-3 py-8">
                <ActivityIndicator size="small" color="#ef4444" />
                <Text className="text-sm text-text-secondary">Loading episodes...</Text>
              </View>
            ) : error ? (
              <View className="rounded-xl bg-primary/10 p-4">
                <Text className="text-sm text-primary">{error}</Text>
              </View>
            ) : episodes.length === 0 ? (
              <View className="items-center py-8">
                <Text className="text-sm text-text-secondary">
                  Episode list not available yet.
                </Text>
              </View>
            ) : (
              <View className="gap-3">
                {shouldWindowEpisodes ? (
                  <View className="gap-2 rounded-xl border border-border-default bg-bg-base p-3">
                    <View className="flex-row flex-wrap items-center justify-between gap-3">
                      <View className="gap-0.5">
                        <Text className="text-xs font-semibold text-text-secondary">
                          Episodes{" "}
                          {formatEpisodeRange(
                            episodeWindowRange.start,
                            episodeWindowRange.end
                          )}{" "}
                          of {episodes.length}
                        </Text>
                        <Text className="text-[11px] text-text-muted">
                          Page {safeEpisodeWindowPage + 1} of {episodePageCount}
                        </Text>
                      </View>

                      <View className="flex-row flex-wrap items-center gap-1.5">
                        <EpisodePageIconButton
                          disabled={!canGoToPreviousEpisodePage}
                          icon="play-skip-back"
                          accessibilityLabel="Go to first episode page"
                          onPress={() => selectEpisodePage(0)}
                        />
                        <EpisodePageIconButton
                          disabled={!canGoToPreviousEpisodePage}
                          icon="chevron-back"
                          accessibilityLabel="Go to previous episode page"
                          onPress={() => shiftEpisodeWindow("previous")}
                        />

                        <Pressable
                          onPress={() => setIsEpisodePagePickerOpen((open) => !open)}
                          accessibilityRole="button"
                          accessibilityLabel="Select episode page"
                          accessibilityState={{ expanded: isEpisodePagePickerOpen }}
                          className="min-w-[150px] flex-row items-center justify-between gap-2 rounded-lg border border-border-default bg-bg-surface px-3 py-2"
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.82 : 1,
                          })}
                        >
                          <Text
                            numberOfLines={1}
                            className="flex-1 text-[11px] font-bold uppercase text-text-secondary"
                          >
                            {formatEpisodeRange(
                              episodeWindowRange.start,
                              episodeWindowRange.end
                            )}
                          </Text>
                          <Ionicons
                            name={isEpisodePagePickerOpen ? "chevron-up" : "chevron-down"}
                            size={14}
                            color="#a1a1aa"
                          />
                        </Pressable>

                        <EpisodePageIconButton
                          disabled={!canGoToNextEpisodePage}
                          icon="chevron-forward"
                          accessibilityLabel="Go to next episode page"
                          onPress={() => shiftEpisodeWindow("next")}
                        />
                        <EpisodePageIconButton
                          disabled={!canGoToNextEpisodePage}
                          icon="play-skip-forward"
                          accessibilityLabel="Go to last episode page"
                          onPress={() => selectEpisodePage(episodePageCount - 1)}
                        />
                      </View>
                    </View>

                    {isEpisodePagePickerOpen ? (
                      <View className="overflow-hidden rounded-lg border border-border-default bg-bg-surface">
                        <ScrollView
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                          style={{ maxHeight: 260 }}
                        >
                          <View className="gap-1 p-1">
                            {episodePageOptions.map((option) => {
                              const isSelected =
                                option.pageIndex === safeEpisodeWindowPage;
                              const pageEpisodeCount = option.end - option.start + 1;

                              return (
                                <Pressable
                                  key={option.pageIndex}
                                  onPress={() => selectEpisodePage(option.pageIndex)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Show episodes ${formatEpisodeRange(
                                    option.start,
                                    option.end
                                  )}`}
                                  className={`flex-row items-center gap-3 rounded-md px-3 py-2.5 ${
                                    isSelected ? "bg-primary/15" : "bg-transparent"
                                  }`}
                                  style={({ pressed }) => ({
                                    opacity: pressed ? 0.82 : 1,
                                  })}
                                >
                                  <View className="flex-1">
                                    <Text
                                      className={`text-sm font-semibold ${
                                        isSelected ? "text-primary" : "text-text-primary"
                                      }`}
                                    >
                                      Episodes {formatEpisodeRange(option.start, option.end)}
                                    </Text>
                                    <Text className="text-[11px] text-text-muted">
                                      {pageEpisodeCount} episode
                                      {pageEpisodeCount === 1 ? "" : "s"}
                                    </Text>
                                  </View>
                                  {isSelected ? (
                                    <Ionicons name="checkmark" size={16} color="#ef4444" />
                                  ) : null}
                                </Pressable>
                              );
                            })}
                          </View>
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {visibleEpisodes.map((episode) => {
                  const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
                  const watched = watchedEpisodeKeys.has(key);
                  const isUpdating = pendingEpisodeKeys[key] || false;
                  const availability = getEpisodeAvailability(episode.airDate);
                  const watchCount = episodeWatchCounts?.[key];

                  return (
                    <SwipeableEpisodeCard
                      key={episode.id}
                      id={episode.id}
                      episodeNumber={episode.episodeNumber}
                      seasonNumber={episode.seasonNumber}
                      name={episode.name}
                      overview={episode.overview}
                      stillUrl={episode.stillUrl}
                      runtime={episode.runtime}
                      watched={watched}
                      isUpdating={isUpdating}
                      availability={availability}
                      onToggle={() => onToggleEpisode(episode)}
                      onSwipeAction={(action) => onEpisodeSwipeAction?.(episode, action)}
                      watchCount={watchCount}
                    />
                  );
                })}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
