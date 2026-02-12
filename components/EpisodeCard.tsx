import { Pressable, View, Text, ActivityIndicator, Image } from "react-native";
import { toHttpsImageUrl } from "@/lib/image-url";

interface EpisodeAvailability {
  isReleased: boolean;
  dateLabel: string;
  stateLabel: string;
  stateClassName: string;
}

interface EpisodeCardProps {
  id: string;
  episodeNumber: number;
  seasonNumber: number;
  name?: string;
  overview?: string;
  stillUrl?: string;
  airDate?: string;
  runtime?: number;
  watched: boolean;
  isUpdating: boolean;
  availability: EpisodeAvailability;
  onToggle: () => void;
}

export function EpisodeCard({
  episodeNumber,
  seasonNumber,
  name,
  overview,
  stillUrl,
  runtime,
  watched,
  isUpdating,
  availability,
  onToggle,
}: EpisodeCardProps) {
  const canToggle = availability.isReleased || watched;

  const statusText = isUpdating
    ? "Saving..."
    : watched
      ? "Watched"
      : !availability.isReleased
        ? "Upcoming"
        : "Watch";

  return (
    <Pressable
      onPress={onToggle}
      disabled={isUpdating || !canToggle}
      className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface active:bg-bg-elevated/80 active:scale-[0.98] disabled:opacity-40"
    >
      {/* Episode Image */}
      <View className="relative h-32 w-full overflow-hidden">
        {stillUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(stillUrl) }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View className="h-full w-full items-center justify-center bg-bg-elevated">
            <Text className="text-4xl font-black text-text-secondary/30">
              E{String(episodeNumber).padStart(2, "0")}
            </Text>
          </View>
        )}

        {/* Episode Number Badge */}
        <View className="absolute left-3 top-3 rounded-lg bg-black/60 px-2.5 py-1">
          <Text className="text-xs font-bold text-white">
            S{String(seasonNumber).padStart(2, "0")}E
            {String(episodeNumber).padStart(2, "0")}
          </Text>
        </View>

        {/* Runtime Badge */}
        {runtime && runtime > 0 && (
          <View className="absolute right-3 top-3 rounded-lg bg-black/60 px-2 py-1">
            <Text className="text-xs font-medium text-text-secondary">
              {runtime}m
            </Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View className="p-3">
        {/* Title Row with Watch Button */}
        <View className="mb-2 flex-row items-start justify-between gap-2">
          <Text
            className="flex-1 text-sm font-semibold text-text-primary"
            numberOfLines={2}
          >
            {name || `Episode ${episodeNumber}`}
          </Text>

          {/* Watch Radio Button */}
          <Pressable
            onPress={onToggle}
            disabled={isUpdating || !canToggle}
            className="relative h-6 w-6 shrink-0 items-center justify-center active:scale-90 disabled:opacity-40"
          >
            {/* Outer ring */}
            <View
              className={`absolute h-6 w-6 rounded-full border-2 ${
                watched
                    ? "border-success"
                    : !availability.isReleased
                      ? "border-border-default"
                      : "border-border-bright"
              }`}
            />

            {/* Loading indicator - shows during update, replaces watched state */}
            {isUpdating ? (
              <ActivityIndicator size="small" color="#a1a1aa" />
            ) : (
              <>
                {/* Fill circle - shown when watched */}
                {watched && (
                  <View className="h-3.5 w-3.5 rounded-full bg-success" />
                )}

                {/* Checkmark */}
                {watched && (
                  <View className="absolute inset-0 items-center justify-center">
                    <Text className="text-[10px] font-bold text-white">✓</Text>
                  </View>
                )}
              </>
            )}
          </Pressable>
        </View>

        {/* Overview */}
        {overview && (
          <Text
            className="mb-2 text-xs leading-relaxed text-text-secondary"
            numberOfLines={2}
          >
            {overview}
          </Text>
        )}

        {/* Meta Row */}
        <View className="flex-row items-center justify-between">
          <Text
            className={`text-xs ${availability.isReleased ? "text-text-secondary" : "text-warning"}`}
          >
            {availability.dateLabel}
          </Text>

          <Text
            className={`text-xs font-medium ${
              watched
                ? "text-success"
                : !availability.isReleased
                  ? "text-warning"
                  : "text-text-secondary"
            }`}
          >
            {statusText}
          </Text>
        </View>
      </View>

      {/* Status Indicator Bar */}
      <View
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{
          backgroundColor: watched
            ? "#34d399"
            : !availability.isReleased
              ? "#fbbf24"
              : "transparent",
        }}
      />
    </Pressable>
  );
}
