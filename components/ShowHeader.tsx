import { Image } from "expo-image";
import { View, Text, Platform } from "react-native";
import { Badge } from "./Badge";

interface ShowHeaderProps {
  backdropUrl?: string | null;
  posterUrl?: string | null;
  title: string;
  mediaType: "tv" | "movie" | "anime";
  firstAired?: string | null;
  rating?: number | null;
  isDesktop: boolean;
}

function mediaTypeLabel(type: "tv" | "movie" | "anime"): string {
  switch (type) {
    case "movie":
      return "Movie";
    case "anime":
      return "Anime";
    default:
      return "TV Series";
  }
}

export function ShowHeader({
  backdropUrl,
  posterUrl,
  title,
  mediaType,
  firstAired,
  rating,
  isDesktop,
}: ShowHeaderProps) {
  const heroHeight = isDesktop ? 420 : 280;

  return (
    <View style={{ height: heroHeight }} className="relative overflow-hidden">
      {/* Backdrop Image */}
      {backdropUrl ? (
        <Image
          source={{ uri: backdropUrl }}
          className="absolute inset-0 h-full w-full"
          contentFit="cover"
          transition={500}
        />
      ) : (
        <View className="absolute inset-0 bg-bg-elevated">
          <View
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                Platform.OS === "web"
                  ? "radial-gradient(circle at 50% 0%, rgba(239,68,68,0.15) 0%, transparent 50%)"
                  : undefined,
            }}
          />
        </View>
      )}



      {/* Content */}
      <View
        className={`absolute bottom-0 left-0 right-0 ${isDesktop ? "px-8 pb-8" : "px-5 pb-6"}`}
      >
        <View className={`${isDesktop ? "flex-row items-end gap-6" : ""}`}>
          {/* Poster - Only visible on desktop, floating over the hero */}
          {isDesktop && posterUrl && (
            <View
              className="overflow-hidden rounded-2xl border border-border-default shadow-2xl"
              style={{
                width: 160,
                height: 240,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 20 },
                shadowOpacity: 0.5,
                shadowRadius: 40,
                elevation: 20,
              }}
            >
              <Image
                source={{ uri: posterUrl }}
                className="h-full w-full"
                contentFit="cover"
                transition={300}
              />
            </View>
          )}

          {/* Title Section */}
          <View className="flex-1">
            {/* Badges */}
            <View className="mb-3 flex-row flex-wrap items-center gap-2">
              <Badge
                label={mediaTypeLabel(mediaType)}
                variant="primary"
                className="shadow-lg"
              />
              {firstAired && <Badge label={firstAired} variant="default" />}
              {rating && rating > 0 && (
                <View className="flex-row items-center gap-1 rounded-full bg-warning/20 px-2.5 py-1">
                  <Text className="text-sm">★</Text>
                  <Text className="text-xs font-semibold text-warning">
                    {rating.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>

            {/* Title */}
            <Text
              className={`font-black text-text-primary ${isDesktop ? "text-5xl" : "text-3xl"}`}
              style={{
                letterSpacing: -0.02,
                textShadowColor: "rgba(0,0,0,0.5)",
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 20,
              }}
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
