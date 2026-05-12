import { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { EpisodeCard } from "@/components/EpisodeCard";

type EpisodeAvailability = {
  isReleased: boolean;
  dateLabel: string;
  stateLabel: string;
  stateClassName: string;
};

type SwipeableEpisodeCardProps = {
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
  onSwipeAction?: (action: "watch" | "unwatch" | "rewatch") => void;
  watchCount?: number;
};

const ACTION_WIDTH = 96;
const WEB_SWIPE_OPEN_THRESHOLD = ACTION_WIDTH * 0.45;

function clampWebSwipeOffset(value: number, canOpenLeft: boolean) {
  const min = -ACTION_WIDTH;
  const max = canOpenLeft ? ACTION_WIDTH : 0;
  return Math.max(min, Math.min(max, value));
}

function hasWebTouchInput() {
  if (Platform.OS !== "web") {
    return false;
  }

  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    return true;
  }

  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
}

function SwipeAction({
  label,
  icon,
  tone,
  onPress,
  activateOnPressIn = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "success" | "warning";
  onPress: () => void;
  activateOnPressIn?: boolean;
}) {
  const color = tone === "success" ? "#34d399" : "#fbbf24";
  const backgroundClassName =
    tone === "success"
      ? "border-emerald-400/30 bg-emerald-500/15"
      : "border-amber-300/30 bg-amber-400/15";

  return (
    <Pressable
      onPress={activateOnPressIn ? undefined : onPress}
      onPressIn={activateOnPressIn ? onPress : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`mx-1 h-full items-center justify-center rounded-xl border active:scale-95 ${backgroundClassName}`}
      style={{ width: ACTION_WIDTH - 8 }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text className="mt-1 text-[11px] font-black uppercase tracking-wide" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SwipeableEpisodeCard({
  watched,
  isUpdating,
  availability,
  onToggle,
  onSwipeAction,
  watchCount,
  ...episodeProps
}: SwipeableEpisodeCardProps) {
  const { width } = useWindowDimensions();
  const webOpenOffsetRef = useRef(0);
  const webDragStartOffsetRef = useRef(0);
  const [webOffset, setWebOffsetState] = useState(0);
  const canToggle = availability.isReleased || watched;
  const isMobileWebTouch = Platform.OS === "web" && width < 1024 && hasWebTouchInput();
  const canSwipe = (Platform.OS !== "web" || isMobileWebTouch) && canToggle && !isUpdating;

  const setWebOffset = (nextOffset: number) => {
    webOpenOffsetRef.current = nextOffset;
    setWebOffsetState(nextOffset);
  };

  const webPanHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (!isMobileWebTouch) {
            return false;
          }

          const absDx = Math.abs(gestureState.dx);
          const absDy = Math.abs(gestureState.dy);
          return absDx > 12 && absDx > absDy * 1.25;
        },
        onPanResponderGrant: () => {
          webDragStartOffsetRef.current = webOpenOffsetRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextOffset = clampWebSwipeOffset(
            webDragStartOffsetRef.current + gestureState.dx,
            watched
          );
          setWebOffset(nextOffset);
        },
        onPanResponderRelease: () => {
          if (webOpenOffsetRef.current > WEB_SWIPE_OPEN_THRESHOLD && watched) {
            setWebOffset(ACTION_WIDTH);
            return;
          }

          if (webOpenOffsetRef.current < -WEB_SWIPE_OPEN_THRESHOLD) {
            setWebOffset(-ACTION_WIDTH);
            return;
          }

          setWebOffset(0);
        },
        onPanResponderTerminate: () => {
          setWebOffset(0);
        },
      }).panHandlers,
    [isMobileWebTouch, watched]
  );

  const card = (
    <EpisodeCard
      {...episodeProps}
      watched={watched}
      isUpdating={isUpdating}
      availability={availability}
      onToggle={onToggle}
      watchCount={watchCount}
    />
  );

  if (!canSwipe) {
    return card;
  }

  const rightAction = watched ? "rewatch" : "watch";
  const rightActionLabel = watched ? "Rewatch" : "Watch";

  const handleActionPress = (
    swipeable: SwipeableMethods,
    action: "watch" | "unwatch" | "rewatch"
  ) => {
    swipeable.close();
    if (onSwipeAction) {
      onSwipeAction(action);
      return;
    }
    onToggle();
  };

  const handleWebActionPress = (action: "watch" | "unwatch" | "rewatch") => {
    setWebOffset(0);
    if (onSwipeAction) {
      onSwipeAction(action);
      return;
    }
    onToggle();
  };

  if (isMobileWebTouch) {
    return (
      <View className="relative overflow-hidden rounded-xl">
        {watched ? (
          <View className="absolute inset-y-0 left-0 flex-row items-stretch justify-start">
            <SwipeAction
              label="Unwatch"
              icon="remove-circle"
              tone="warning"
              onPress={() => handleWebActionPress("unwatch")}
            />
          </View>
        ) : null}

        <View className="absolute inset-y-0 right-0 flex-row items-stretch justify-end">
          <SwipeAction
            label={rightActionLabel}
            icon={watched ? "refresh-circle" : "checkmark-circle"}
            tone="success"
            onPress={() => handleWebActionPress(rightAction)}
          />
        </View>

        <View
          {...webPanHandlers}
          style={{ transform: [{ translateX: webOffset }] }}
        >
          {card}
        </View>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-xl">
      <ReanimatedSwipeable
        friction={2}
        leftThreshold={ACTION_WIDTH}
        rightThreshold={ACTION_WIDTH}
        dragOffsetFromLeftEdge={16}
        dragOffsetFromRightEdge={16}
        overshootLeft={false}
        overshootRight={false}
        renderLeftActions={
          watched
            ? (_progress, _translation, swipeable) => (
                <View className="h-full flex-row items-stretch justify-start">
                  <SwipeAction
                    label="Unwatch"
                    icon="remove-circle"
                    tone="warning"
                    onPress={() => handleActionPress(swipeable, "unwatch")}
                    activateOnPressIn={isMobileWebTouch}
                  />
                </View>
              )
            : undefined
        }
        renderRightActions={(_progress, _translation, swipeable) => (
          <View className="h-full flex-row items-stretch justify-end">
            <SwipeAction
              label={rightActionLabel}
              icon={watched ? "refresh-circle" : "checkmark-circle"}
              tone="success"
              onPress={() => handleActionPress(swipeable, rightAction)}
              activateOnPressIn={isMobileWebTouch}
            />
          </View>
        )}
      >
        {card}
      </ReanimatedSwipeable>
    </View>
  );
}
