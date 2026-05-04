import { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import type { NormalizedEpisode } from "@/lib/api/types";
import { toHttpsImageUrl } from "@/lib/image-url";

export type EpisodeAvailability = {
  isReleased: boolean;
  dateLabel: string;
  stateLabel: string;
  stateClassName: string;
};

export type ContinueTrackingRailItem =
  | {
      kind: "episode";
      episode: NormalizedEpisode;
      watched: boolean;
      isUpdating: boolean;
      watchCount?: number;
      availability: EpisodeAvailability;
    }
  | {
      kind: "caught-up";
      text: string;
      credit: string;
      progressLabel: string;
    };

type ContinueTrackingRailProps = {
  items: ContinueTrackingRailItem[];
  isLoadingMore: boolean;
  canLoadPrevious: boolean;
  canLoadNext: boolean;
  onLoadPrevious: () => void;
  onLoadNext: () => void;
  onToggleEpisode: (episode: NormalizedEpisode) => void;
  fallbackImageUrl?: string | null;
  initialScrollIndex?: number;
  resetScrollKey: string;
};

const LOAD_MORE_THRESHOLD_PX = 180;
const RAIL_CARD_WIDTH = 192;
const RAIL_CARD_GAP = 12;
const RAIL_SIDE_PADDING = 16;
const DRAG_CLICK_SUPPRESSION_MS = 120;

function getRailItemKey(item: ContinueTrackingRailItem) {
  if (item.kind === "caught-up") {
    return "caught-up";
  }

  return `${item.episode.seasonNumber}:${item.episode.episodeNumber}`;
}

export function ContinueTrackingRail({
  items,
  isLoadingMore,
  canLoadPrevious,
  canLoadNext,
  onLoadPrevious,
  onLoadNext,
  onToggleEpisode,
  fallbackImageUrl,
  initialScrollIndex = 0,
  resetScrollKey,
}: ContinueTrackingRailProps) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollOffsetXRef = useRef(0);
  const dragStartScrollXRef = useRef(0);
  const previousItemKeysRef = useRef<string[]>([]);
  const hasAutoPositionedRef = useRef(false);
  const isDragClickSuppressedRef = useRef(false);
  const dragClickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hasAutoPositionedRef.current = false;
    previousItemKeysRef.current = [];
    isDragClickSuppressedRef.current = false;
  }, [resetScrollKey]);

  useEffect(() => {
    const nextItemKeys = items.map(getRailItemKey);
    const previousItemKeys = previousItemKeysRef.current;
    const previousFirstItemKey = previousItemKeys[0];

    previousItemKeysRef.current = nextItemKeys;

    if (!hasAutoPositionedRef.current || !previousFirstItemKey) {
      return;
    }

    const previousFirstItemIndex = nextItemKeys.indexOf(previousFirstItemKey);
    if (previousFirstItemIndex <= 0) {
      return;
    }

    const offsetDelta = previousFirstItemIndex * (RAIL_CARD_WIDTH + RAIL_CARD_GAP);
    const nextOffset = scrollOffsetXRef.current + offsetDelta;
    scrollViewRef.current?.scrollTo({ x: nextOffset, animated: false });
    scrollOffsetXRef.current = nextOffset;
  }, [items]);

  useEffect(() => {
    return () => {
      if (dragClickSuppressionTimerRef.current) {
        clearTimeout(dragClickSuppressionTimerRef.current);
      }
    };
  }, []);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetXRef.current = contentOffset.x;

    if (isLoadingMore) {
      return;
    }

    if (contentOffset.x <= LOAD_MORE_THRESHOLD_PX && canLoadPrevious) {
      onLoadPrevious();
      return;
    }

    const distanceFromEnd = contentSize.width - (contentOffset.x + layoutMeasurement.width);
    if (distanceFromEnd <= LOAD_MORE_THRESHOLD_PX && canLoadNext) {
      onLoadNext();
    }
  };

  const panResponder = useMemo(
    () =>
      isDesktopWeb
        ? PanResponder.create({
            onMoveShouldSetPanResponderCapture: (_, gestureState) =>
              Math.abs(gestureState.dx) > 6 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
            onPanResponderGrant: () => {
              dragStartScrollXRef.current = scrollOffsetXRef.current;
              isDragClickSuppressedRef.current = true;
              if (dragClickSuppressionTimerRef.current) {
                clearTimeout(dragClickSuppressionTimerRef.current);
                dragClickSuppressionTimerRef.current = null;
              }
            },
            onPanResponderMove: (_, gestureState) => {
              scrollViewRef.current?.scrollTo({
                x: Math.max(0, dragStartScrollXRef.current - gestureState.dx),
                animated: false,
              });
            },
            onPanResponderRelease: () => {
              if (isDragClickSuppressedRef.current) {
                dragClickSuppressionTimerRef.current = setTimeout(() => {
                  isDragClickSuppressedRef.current = false;
                  dragClickSuppressionTimerRef.current = null;
                }, DRAG_CLICK_SUPPRESSION_MS);
              }
            },
            onPanResponderTerminate: () => {
              if (isDragClickSuppressedRef.current) {
                dragClickSuppressionTimerRef.current = setTimeout(() => {
                  isDragClickSuppressedRef.current = false;
                  dragClickSuppressionTimerRef.current = null;
                }, DRAG_CLICK_SUPPRESSION_MS);
              }
            },
          })
        : null,
    [isDesktopWeb]
  );

  if (items.length === 0) {
    return null;
  }

  const autoPositionToAnchor = () => {
    if (hasAutoPositionedRef.current) {
      return;
    }

    const targetX = Math.max(
      0,
      initialScrollIndex * (RAIL_CARD_WIDTH + RAIL_CARD_GAP) - RAIL_SIDE_PADDING
    );
    scrollViewRef.current?.scrollTo({ x: targetX, animated: false });
    scrollOffsetXRef.current = targetX;
    hasAutoPositionedRef.current = true;
  };

  return (
    <View
      className="mb-6 overflow-hidden rounded-2xl border-2 border-border-default bg-bg-surface py-4 web:select-none"
      {...(panResponder?.panHandlers ?? {})}
      style={isDesktopWeb ? { cursor: "pointer" } : undefined}
    >
      <View className="mb-3 flex-row items-start justify-between gap-4 px-4">
        <View className="flex-1">
          <Text
            className="text-lg text-text-primary"
            style={{ fontFamily: "Courier New", fontWeight: "900" }}
          >
            Continue Tracking
          </Text>
          <Text className="mt-1 text-xs text-text-secondary">
            Your last stop, next watch, and what follows.
          </Text>
        </View>
        <View className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1">
          <Text className="text-[10px] font-black uppercase tracking-wide text-primary">
            Quick Rail
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onContentSizeChange={autoPositionToAnchor}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 4 }}
      >
        {items.map((item, index) => {
          if (item.kind === "caught-up") {
            return (
              <View
                key="caught-up"
                className="w-64 justify-between overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4"
              >
                <View className="flex-row items-center gap-2">
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20">
                    <Ionicons name="checkmark-done" size={18} color="#34d399" />
                  </View>
                  <Text className="text-xs font-black uppercase tracking-wide text-emerald-500">
                    Caught Up
                  </Text>
                </View>
                <View className="mt-6">
                  <Text className="text-base font-semibold leading-5 text-text-primary">
                    "{item.text}"
                  </Text>
                  <Text className="mt-2 text-xs text-text-secondary">- {item.credit}</Text>
                  <Text className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-emerald-500">
                    {item.progressLabel}
                  </Text>
                </View>
              </View>
            );
          }

          const { episode, watched, isUpdating, watchCount, availability } = item;
          const imageUrl = toHttpsImageUrl(episode.stillUrl ?? fallbackImageUrl ?? undefined);
          const canToggle = availability.isReleased || watched;
          const statusText = isUpdating
            ? "Saving..."
            : watched
              ? watchCount && watchCount > 1
                ? `Watched ${watchCount}x`
                : "Watched"
              : availability.isReleased
                ? index === 0
                  ? "Start"
                  : "Watch"
                : availability.dateLabel;

          return (
            <Pressable
              key={`${episode.seasonNumber}:${episode.episodeNumber}`}
              onPress={() => {
                if (isDesktopWeb && isDragClickSuppressedRef.current) {
                  return;
                }

                onToggleEpisode(episode);
              }}
              disabled={isUpdating || !canToggle}
              accessibilityRole="button"
              className="w-48 overflow-hidden rounded-2xl border-2 border-border-default bg-bg-base active:bg-bg-elevated/70 disabled:opacity-45"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <View className="relative h-28 justify-between overflow-hidden bg-bg-elevated p-3">
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    className="absolute inset-0 h-full w-full"
                    resizeMode="cover"
                  />
                ) : null}
                <View className="absolute inset-0 bg-black/45" />
                <View className="flex-row items-center justify-between gap-2">
                  <View className="rounded-md border border-white/10 bg-black/40 px-2 py-1">
                    <Text className="text-[10px] font-black uppercase tracking-wide text-white">
                      S{String(episode.seasonNumber).padStart(2, "0")}E
                      {String(episode.episodeNumber).padStart(2, "0")}
                    </Text>
                  </View>
                  <View
                    className={`h-7 w-7 items-center justify-center rounded-full border-2 ${
                      watched
                        ? "border-success bg-success"
                        : availability.isReleased
                          ? "border-border-bright"
                          : "border-warning/70"
                    }`}
                  >
                    {isUpdating ? (
                      <ActivityIndicator size="small" color="#a1a1aa" />
                    ) : watched ? (
                      <Ionicons name="checkmark" size={14} color="#ffffff" />
                    ) : !availability.isReleased ? (
                      <Ionicons name="time-outline" size={13} color="#fbbf24" />
                    ) : null}
                  </View>
                </View>
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
                  {watched ? "Previous" : availability.isReleased ? "Next up" : "Upcoming"}
                </Text>
              </View>

              <View className="min-h-32 p-3">
                <Text className="text-sm font-semibold leading-5 text-text-primary" numberOfLines={2}>
                  {episode.name || `Episode ${episode.episodeNumber}`}
                </Text>
                {episode.overview ? (
                  <Text className="mt-2 text-xs leading-4 text-text-secondary" numberOfLines={3}>
                    {episode.overview}
                  </Text>
                ) : (
                  <Text className="mt-2 text-xs leading-4 text-text-muted" numberOfLines={3}>
                    No episode summary available yet.
                  </Text>
                )}
                <View className="mt-3 flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-[11px] text-text-muted" numberOfLines={1}>
                    {availability.dateLabel}
                  </Text>
                  <Text
                    className={`text-[11px] font-bold ${
                      watched
                        ? "text-success"
                        : availability.isReleased
                          ? "text-primary"
                          : "text-warning"
                    }`}
                    numberOfLines={1}
                  >
                    {statusText}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}

        {isLoadingMore ? (
          <View className="w-24 items-center justify-center rounded-2xl border border-border-default bg-bg-base">
            <ActivityIndicator size="small" color="#ef4444" />
            <Text className="mt-2 text-[11px] text-text-secondary">Loading</Text>
          </View>
        ) : null}
      </ScrollView>

      {isDesktopWeb ? (
        <Text className="px-4 pt-3 text-[11px] text-text-muted">
          Click and drag to scrub through episodes.
        </Text>
      ) : null}
    </View>
  );
}
