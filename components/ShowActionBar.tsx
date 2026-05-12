import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Badge } from "@/components/Badge";

type ShowActionBarProps = {
  statusLabel: string;
  isTracked: boolean;
  isFavorite: boolean;
  canAddToList: boolean;
  isBusy: boolean;
  isCompact?: boolean;
  isTogglingFavorite?: boolean;
  isRepairingTracking?: boolean;
  onToggleWatchlist: () => void;
  onToggleFavorite: () => void;
  onEditStatus: () => void;
  onAddToList: () => void;
  onRepairTracking?: () => void;
};

type ActionButtonProps = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  loading?: boolean;
};

function MenuAction({
  label,
  icon,
  onPress,
  disabled = false,
  active = false,
  destructive = false,
  loading = false,
}: ActionButtonProps) {
  const iconColor = destructive ? "#ef4444" : active ? "#34d399" : "#a1a1aa";
  const textClass = destructive
    ? "text-primary"
    : active
      ? "text-success"
      : "text-text-primary";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3 px-4 py-3"
      style={({ pressed }) => ({
        opacity: disabled || loading ? 0.45 : pressed ? 0.84 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name={icon} size={18} color={iconColor} />
      )}
      <Text className={`text-sm font-semibold ${textClass}`}>{label}</Text>
    </Pressable>
  );
}

export function ShowActionBar({
  statusLabel,
  isTracked,
  isFavorite,
  canAddToList,
  isBusy,
  isCompact = false,
  isTogglingFavorite = false,
  isRepairingTracking = false,
  onToggleWatchlist,
  onToggleFavorite,
  onEditStatus,
  onAddToList,
  onRepairTracking,
}: ShowActionBarProps) {
  const [isMoreVisible, setIsMoreVisible] = useState(false);
  const [moreButtonFrame, setMoreButtonFrame] = useState({ x: 0, y: 0, width: 42, height: 42 });
  const moreButtonRef = useRef<View>(null);

  const closeMore = () => setIsMoreVisible(false);
  const openMore = () => {
    moreButtonRef.current?.measureInWindow((x, y, width, height) => {
      setMoreButtonFrame({ x, y, width, height });
      setIsMoreVisible(true);
    });
  };

  return (
    <View className="relative z-30">
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={onEditStatus}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={`Tracking status: ${statusLabel}`}
          className="min-h-[42px] flex-row items-center gap-2 rounded-lg border border-white/30 bg-bg-base/95 px-3 py-2 shadow-lg"
          style={({ pressed }) => ({
            opacity: isBusy ? 0.45 : pressed ? 0.86 : 1,
          })}
        >
          <Badge
            label={statusLabel}
            variant={isTracked ? "accent" : "default"}
            className={isCompact ? "max-w-[104px]" : "max-w-[150px]"}
          />
          <Ionicons name="chevron-down" size={14} color="#a1a1aa" />
        </Pressable>

        <Pressable
          ref={moreButtonRef}
          onPress={() => {
            if (isMoreVisible) {
              closeMore();
              return;
            }

            openMore();
          }}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="More show actions"
          className={`h-[42px] w-[42px] items-center justify-center rounded-lg border shadow-lg ${
            isMoreVisible
              ? "border-primary/55 bg-bg-base"
              : "border-white/30 bg-bg-base/95"
          }`}
          style={({ pressed }) => ({
            opacity: isBusy ? 0.45 : pressed ? 0.84 : 1,
            transform: [{ scale: pressed && !isBusy ? 0.97 : 1 }],
          })}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#f4f4f5" />
        </Pressable>
      </View>

      <Modal
        visible={isMoreVisible}
        transparent
        animationType="fade"
        onRequestClose={closeMore}
      >
        <View className="flex-1">
          <Pressable className="absolute inset-0" focusable={false} onPress={closeMore} />
          <View
            className="absolute w-52 overflow-hidden rounded-lg border border-border-bright bg-bg-base shadow-2xl"
            style={{
              left: Math.max(16, moreButtonFrame.x + moreButtonFrame.width - 208),
              top: moreButtonFrame.y + moreButtonFrame.height + 4,
            }}
          >
            <View className="border-b border-border-default">
              <MenuAction
                label={isTracked ? "Remove from Library" : "Save to Library"}
                icon={isTracked ? "remove-circle-outline" : "add-circle-outline"}
                onPress={() => {
                  closeMore();
                  onToggleWatchlist();
                }}
                disabled={isBusy}
                destructive={isTracked}
              />
            </View>

            <View className="border-b border-border-default">
              <MenuAction
                label={isFavorite ? "Favorited" : "Add Favorite"}
                icon={isFavorite ? "heart" : "heart-outline"}
                onPress={() => {
                  closeMore();
                  onToggleFavorite();
                }}
                disabled={isBusy || isTogglingFavorite}
                active={isFavorite}
                loading={isTogglingFavorite}
              />
            </View>

            {isTracked && onRepairTracking ? (
              <View className="border-b border-border-default">
                <MenuAction
                  label="Refresh Tracking"
                  icon="refresh-outline"
                  onPress={() => {
                    closeMore();
                    onRepairTracking();
                  }}
                  disabled={isBusy || isRepairingTracking}
                  loading={isRepairingTracking}
                />
              </View>
            ) : null}

            {canAddToList ? (
              <MenuAction
                label="Add to List"
                icon="bookmark-outline"
                onPress={() => {
                  closeMore();
                  onAddToList();
                }}
                disabled={isBusy}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}
