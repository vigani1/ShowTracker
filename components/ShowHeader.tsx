import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Image, View, Text } from "react-native";
import type { Href } from "expo-router";
import { Badge } from "./Badge";
import { toHttpsImageUrl } from "@/lib/image-url";
import { AppBackButton } from "@/components/AppBackButton";

interface ShowHeaderProps {
  backdropUrl?: string | null;
  posterUrl?: string | null;
  title: string;
  mediaType: "tv" | "movie" | "anime";
  firstAired?: string | null;
  rating?: number | null;
  isDesktop: boolean;
  showBackButton?: boolean;
  backFallbackHref?: Href;
  actionSlot?: ReactNode;
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
  showBackButton = false,
  backFallbackHref = "/home",
  actionSlot,
}: ShowHeaderProps) {
  const heroHeight = isDesktop ? 420 : 300;

  return (
    <View
      style={{ height: heroHeight }}
      className="relative overflow-hidden rounded-xl border-2 border-border-default"
    >
      {/* Backdrop Image */}
      {backdropUrl ? (
        <Image
          source={{ uri: toHttpsImageUrl(backdropUrl) }}
          className="absolute inset-0 h-full w-full"
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={["#27272a", "#18181b", "#09090b"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
      )}

      {/* Global darkening for readability */}
      <LinearGradient
        colors={["rgba(9,9,11,0.18)", "rgba(9,9,11,0.45)", "rgba(9,9,11,0.92)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      {/* Subtle side vignette */}
      <LinearGradient
        colors={["rgba(9,9,11,0.55)", "transparent", "rgba(9,9,11,0.35)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      {/* Accent glows */}
      <View className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-primary/15" />
      <View className="absolute -left-10 bottom-0 h-36 w-36 rounded-full bg-accent/10" />



      {showBackButton ? (
        <View className={`absolute left-4 ${isDesktop ? "top-5" : "top-4"} z-10`}>
          <AppBackButton fallbackHref={backFallbackHref} />
        </View>
      ) : null}

      {actionSlot ? (
        <View className={`absolute right-4 ${isDesktop ? "top-5" : "top-4"} z-20`}>
          {actionSlot}
        </View>
      ) : null}

      {/* Content */}
      <View
        className={`absolute bottom-0 left-0 right-0 ${isDesktop ? "px-8 pb-8" : "px-5 pb-6"}`}
      >
        <View className={`${isDesktop ? "flex-row items-end gap-6" : ""}`}>
          {/* Poster - Only visible on desktop, floating over the hero */}
          {isDesktop && posterUrl && (
            <View
              className="overflow-hidden rounded-lg border-2 border-border-default shadow-2xl"
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
                  source={{ uri: toHttpsImageUrl(posterUrl) }}
                className="h-full w-full"
                resizeMode="cover"
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
                <View className="flex-row items-center gap-1 rounded-md border border-warning/40 bg-warning/20 px-2.5 py-1">
                  <Text className="text-sm text-warning">★</Text>
                  <Text className="text-[11px] font-black text-warning">
                    {rating.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>

            {/* Title */}
            <Text
              className={`text-text-primary ${isDesktop ? "text-5xl" : "text-3xl"}`}
              style={{
                fontFamily: "Courier New",
                fontWeight: "900",
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
