import type { ComponentProps } from "react";
import { Pressable, type PressableStateCallbackType } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type HeaderIconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  className?: string;
  iconColor?: string;
  iconSize?: number;
} & Pick<ComponentProps<typeof Pressable>, "disabled">;

type WebPressableState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};

function getInteractiveStyle({ pressed, hovered, focused }: WebPressableState) {
  return {
    opacity: pressed ? 0.82 : 1,
    transform: [{ scale: pressed ? 0.97 : 1 }],
    borderColor: hovered || focused ? "rgba(239,68,68,0.72)" : "rgba(255,255,255,0.16)",
  };
}

export function HeaderIconButton({
  icon,
  accessibilityLabel,
  onPress,
  className,
  iconColor = "#f4f4f5",
  iconSize = 21,
  disabled,
}: HeaderIconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={`h-11 w-11 items-center justify-center rounded-xl border bg-bg-base/80 shadow-lg ${className ?? ""}`.trim()}
      style={getInteractiveStyle}
    >
      <Ionicons name={icon} size={iconSize} color={iconColor} />
    </Pressable>
  );
}
