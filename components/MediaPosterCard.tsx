import type { Href } from "expo-router";
import { Link } from "expo-router";
import {
  Image,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { NormalizedShow } from "@/lib/api/types";
import { Badge } from "@/components/Badge";
import { toHttpsImageUrl } from "@/lib/image-url";

interface MediaPosterCardProps {
  show: NormalizedShow;
  href: Href;
  rank?: number;
  className?: string;
  posterClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
  showOverview?: boolean;
  progress?: number;
  unwatchedCount?: number;
  stateLabel?: string | null;
}

const mediaTypeLabel: Record<NormalizedShow["mediaType"], string> = {
  tv: "TV",
  anime: "Anime",
  movie: "Movie",
};

export function MediaPosterCard({
  show,
  href,
  rank,
  className,
  posterClassName,
  containerStyle,
  showOverview,
  progress,
  unwatchedCount,
  stateLabel,
}: MediaPosterCardProps) {
  const { width } = useWindowDimensions();
  const isCompact = Platform.OS !== "web" || width < 640;
  const isSmallPhone = width < 390;
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
        minimumFontScale: 0.64,
      };

  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        className={`w-36 ${className ?? ""}`.trim()}
        style={({ pressed }) => [
          containerStyle,
          pressed && { opacity: 0.95, transform: [{ scale: 0.98 }] },
        ]}
      >
        <View
          className={`relative overflow-hidden rounded-xl border-2 border-border-default bg-bg-elevated ${
            posterClassName ?? "h-56"
          }`.trim()}
        >
          {show.posterUrl ? (
            <Image
              source={{ uri: toHttpsImageUrl(show.posterUrl) }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-bg-surface px-3">
              <Text
                className="text-center text-sm font-semibold text-text-primary"
                numberOfLines={3}
                ellipsizeMode="tail"
                style={isFabricEnabled ? { fontSize: 14, lineHeight: 18 } : undefined}
                {...missingPosterTitleFitProps}
              >
                {show.title}
              </Text>
            </View>
          )}

          {/* Dark gradient overlay at bottom - reduced */}
          <View
            pointerEvents="none"
            className="absolute inset-x-0 bottom-0 h-12"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          />

          {/* Bottom type + badge */}
          <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between gap-2 px-2.5 pb-2 pt-4">
            <Badge label={mediaTypeLabel[show.mediaType]} />
            {typeof unwatchedCount === "number" && unwatchedCount > 0 ? (
              <Badge label={String(unwatchedCount)} variant="accent" />
            ) : null}
          </View>

          {/* Progress bar */}
          {typeof progress === "number" && progress > 0 && progress < 1 ? (
            <View className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
              <View className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
            </View>
          ) : null}

          {typeof rank === "number" ? (
            <View className="absolute left-2 top-2 rounded-md border-2 border-primary bg-bg-base/95 px-2 py-1">
              <Text className="text-[11px] font-black text-primary">#{rank}</Text>
            </View>
          ) : null}

          {stateLabel ? (
            <View pointerEvents="none" className="absolute inset-0 items-center justify-center bg-black/45 px-3">
              <View className="rounded-full border border-white/60 bg-bg-base/95 px-3 py-1.5">
                <Text className="text-[11px] font-black uppercase tracking-wide text-text-primary">
                  {stateLabel}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View
          className={`${showOverview ? "h-[86px]" : isCompact ? "h-[40px]" : "h-[42px]"} mt-2 gap-0.5 px-0.5`}
        >
          <Text
            className={`${isSmallPhone ? "text-[12px]" : "text-sm"} font-semibold leading-4 text-text-primary`}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={isFabricEnabled ? { fontSize: isSmallPhone ? 12 : 14, lineHeight: 16 } : undefined}
            {...titleFitProps}
          >
            {show.title}
          </Text>
          <Text className="text-xs leading-4 text-text-secondary" numberOfLines={1}>
            {show.firstAired?.slice(0, 4) ?? "TBA"}
          </Text>
          {showOverview && show.overview ? (
            <Text className="text-xs leading-relaxed text-text-secondary" numberOfLines={2}>
              {show.overview}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
