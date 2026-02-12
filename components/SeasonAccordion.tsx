import { Pressable, View, Text, ActivityIndicator, Animated } from "react-native";
import { useRef, useEffect } from "react";
import type { NormalizedEpisode } from "@/lib/api/types";
import { EpisodeCard } from "./EpisodeCard";

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
}: SeasonAccordionProps) {
  const rotationAnim = useRef(new Animated.Value(0)).current;

  // Check if all episodes are watched
  // When episodes are loaded, compare against released count
  // When episodes aren't loaded yet, compare against total episode count
  const isFullyWatched = releasedCount > 0
    ? watchedCount >= releasedCount
    : (episodeCount != null && episodeCount > 0 && watchedCount >= episodeCount);
  const hasUnreleased = episodes.length > 0 && releasedCount < episodes.length;
  const displayName = name || `Season ${seasonNumber}`;

  // Button is enabled if episodes haven't been loaded yet, or if there are released episodes
  const canMarkSeason = episodes.length === 0 || releasedCount > 0;

  useEffect(() => {
    Animated.spring(rotationAnim, {
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
  }, [isExpanded, rotationAnim]);

  const spin = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
      {/* Header */}
      <Pressable
        onPress={onToggle}
        className="p-4 active:bg-bg-elevated/50"
        style={({ pressed }) => ({
          backgroundColor: pressed ? "rgba(39,39,42,0.3)" : undefined,
        })}
      >
        <View className="flex-row items-center gap-4">
          {/* Season Number Circle */}
          <View className="h-12 w-12 items-center justify-center rounded-full bg-bg-elevated">
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
              onPress={onMarkSeason}
              disabled={isMarking || isLoading || !canMarkSeason}
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

            {/* Chevron */}
            <Animated.Text
              style={{ transform: [{ rotate: spin }] }}
              className="text-xl text-text-secondary"
            >
              ▼
            </Animated.Text>
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
                {episodes.map((episode) => {
                  const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
                  const watched = watchedEpisodeKeys.has(key);
                  const isUpdating = pendingEpisodeKeys[key] || false;
                  const availability = getEpisodeAvailability(episode.airDate);

                  return (
                    <EpisodeCard
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
