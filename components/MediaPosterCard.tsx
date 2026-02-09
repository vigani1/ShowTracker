import type { Href } from "expo-router";
import { Link } from "expo-router";
import { Image } from "expo-image";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { NormalizedShow } from "@/lib/api/types";
import { Badge } from "@/components/Badge";

interface MediaPosterCardProps {
  show: NormalizedShow;
  href: Href;
  rank?: number;
  className?: string;
  posterClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
  showOverview?: boolean;
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
}: MediaPosterCardProps) {
  return (
    <Link href={href} asChild>
      <Pressable
        className={`w-36 ${className ?? ""}`.trim()}
        style={containerStyle}
      >
        <View
          className={`relative overflow-hidden rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface dark:border-brand-surface/70 dark:bg-brand-surface/70 ${posterClassName ?? "h-56"}`.trim()}
        >
          {show.posterUrl ? (
            <Image
              source={{ uri: show.posterUrl }}
              className="h-full w-full"
              contentFit="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-brand-surface/20 px-3">
              <Text className="text-center text-sm font-semibold text-brand-light-text dark:text-brand-text">
                {show.title}
              </Text>
            </View>
          )}

          <View className="absolute inset-x-0 bottom-0 border-t-2 border-brand-frame/50 bg-[#fff5df]/92 px-2 py-1.5 dark:border-brand-surface/70 dark:bg-[#1e2734]/90">
            <Text
              className="text-[10px] font-bold uppercase tracking-[1.3px] text-brand-ink dark:text-brand-text"
              numberOfLines={1}
            >
              {mediaTypeLabel[show.mediaType]}
            </Text>
          </View>

          {typeof rank === "number" ? (
            <Badge
              label={`Top ${rank}`}
              className="absolute left-2 top-2 border-brand-surface bg-[#fff3d8]"
              textClassName="text-[10px] text-brand-light-text"
            />
          ) : null}
        </View>

        <View className="mt-2 gap-1 px-1">
          <Text
            className="font-serif text-sm font-semibold text-brand-ink dark:text-brand-text"
            numberOfLines={1}
          >
            {show.title}
          </Text>
          <Text className="text-[11px] uppercase tracking-[1.2px] text-brand-ink-soft dark:text-[#d8c8ab]">
            {show.firstAired?.slice(0, 4) ?? "TBA"}
          </Text>
          {showOverview && show.overview ? (
            <Text
              className="text-[12px] leading-5 text-brand-ink-soft dark:text-[#e2d7c1]"
              numberOfLines={3}
            >
              {show.overview}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
