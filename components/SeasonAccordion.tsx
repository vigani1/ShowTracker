import { useEffect, useMemo, useState } from "react";
import { Pressable, View, Text, ActivityIndicator } from "react-native";
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

const LARGE_SEASON_WINDOW_THRESHOLD = 80;
const LARGE_SEASON_WINDOW_SIZE = 40;
const LARGE_SEASON_WINDOW_STEP = 40;

function getInitialEpisodeWindowRange(
  episodeCount: number,
  initialIndex?: number | null
) {
  if (episodeCount <= 0) {
    return { start: 0, end: -1 };
  }

  if (episodeCount <= LARGE_SEASON_WINDOW_THRESHOLD) {
    return { start: 0, end: episodeCount - 1 };
  }

  const safeInitialIndex =
    typeof initialIndex === "number" && Number.isFinite(initialIndex)
      ? Math.max(0, Math.min(initialIndex, episodeCount - 1))
      : 0;
  const start = Math.max(
    0,
    Math.min(safeInitialIndex - 8, episodeCount - LARGE_SEASON_WINDOW_SIZE)
  );

  return {
    start,
    end: Math.min(episodeCount - 1, start + LARGE_SEASON_WINDOW_SIZE - 1),
  };
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
  const [episodeWindowRange, setEpisodeWindowRange] = useState(() =>
    getInitialEpisodeWindowRange(episodes.length, initialEpisodeWindowIndex)
  );
  const shouldWindowEpisodes = episodes.length > LARGE_SEASON_WINDOW_THRESHOLD;

  useEffect(() => {
    setEpisodeWindowRange(
      getInitialEpisodeWindowRange(episodes.length, initialEpisodeWindowIndex)
    );
  }, [episodes.length, initialEpisodeWindowIndex, isExpanded, seasonNumber]);

  const visibleEpisodes = useMemo(() => {
    if (!shouldWindowEpisodes) {
      return episodes;
    }

    return episodes.slice(episodeWindowRange.start, episodeWindowRange.end + 1);
  }, [episodeWindowRange.end, episodeWindowRange.start, episodes, shouldWindowEpisodes]);

  const shiftEpisodeWindow = (direction: "previous" | "next") => {
    setEpisodeWindowRange((currentRange) => {
      const currentSize = Math.max(
        0,
        currentRange.end - currentRange.start
      );

      if (direction === "previous") {
        const start = Math.max(0, currentRange.start - LARGE_SEASON_WINDOW_STEP);
        return {
          start,
          end: Math.min(episodes.length - 1, start + currentSize),
        };
      }

      const end = Math.min(
        episodes.length - 1,
        currentRange.end + LARGE_SEASON_WINDOW_STEP
      );
      return {
        start: Math.max(0, end - currentSize),
        end,
      };
    });
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
                    <View className="flex-row flex-wrap items-center justify-between gap-2">
                      <Text className="text-xs font-semibold text-text-secondary">
                        Episodes {episodeWindowRange.start + 1}-{episodeWindowRange.end + 1} of{" "}
                        {episodes.length}
                      </Text>
                      <View className="flex-row items-center gap-2">
                        <Pressable
                          disabled={episodeWindowRange.start <= 0}
                          onPress={() => shiftEpisodeWindow("previous")}
                          accessibilityRole="button"
                          className="rounded-lg border border-border-default bg-bg-surface px-3 py-2 disabled:opacity-40"
                        >
                          <Text className="text-[11px] font-bold uppercase text-text-secondary">
                            Earlier
                          </Text>
                        </Pressable>
                        <Pressable
                          disabled={episodeWindowRange.end >= episodes.length - 1}
                          onPress={() => shiftEpisodeWindow("next")}
                          accessibilityRole="button"
                          className="rounded-lg border border-border-default bg-bg-surface px-3 py-2 disabled:opacity-40"
                        >
                          <Text className="text-[11px] font-bold uppercase text-text-secondary">
                            Later
                          </Text>
                        </Pressable>
                      </View>
                    </View>
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
