import { Feather } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { DESKTOP_TAB_RAIL_BREAKPOINT } from "@/constants/navigation";

interface PageBackButtonProps {
  label?: string;
  fallbackHref?: Href;
  className?: string;
}

export function PageBackButton({
  label = "Back",
  fallbackHref,
  className,
}: PageBackButtonProps) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isDark = colorScheme === "dark";
  const isDesktopWeb =
    Platform.OS === "web" && width >= DESKTOP_TAB_RAIL_BREAKPOINT;

  const placementClass = isDesktopWeb ? "left-5 top-5" : "left-4 top-4";

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (fallbackHref) {
      router.replace(fallbackHref);
    }
  };

  const webVisualStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: isDark
            ? pressed
              ? "#221811"
              : hovered
                ? "#39291e"
                : "#2d2018"
            : pressed
              ? "#d9ccb8"
              : hovered
                ? "#f7eee0"
                : "#eee4d5",
          borderColor: isDark
            ? pressed
              ? "#7a5f4c"
              : hovered
                ? "#967760"
                : "#876d59"
            : pressed
              ? "#907a67"
              : hovered
                ? "#aa947f"
                : "#9d8b78",
          boxShadow: isDark
            ? pressed
              ? "inset 0px 2px 0 rgba(9,4,3,0.9), inset 0px 1px 0 rgba(255,235,217,0.08)"
              : hovered
                ? "inset 0px 1px 0 rgba(255,238,223,0.2), 0px 4px 0 rgba(10,4,3,0.72), 0px 0px 0px 1px rgba(240,189,145,0.22)"
                : "inset 0px 1px 0 rgba(255,238,223,0.14), 0px 3px 0 rgba(10,4,3,0.7)"
            : pressed
              ? "inset 0px 2px 0 rgba(103,76,58,0.28), inset 0px 1px 0 rgba(255,255,255,0.18)"
              : hovered
                ? "inset 0px 1px 0 rgba(255,255,255,0.45), 0px 4px 0 rgba(74,56,43,0.24), 0px 0px 0px 1px rgba(162,141,123,0.26)"
                : "inset 0px 1px 0 rgba(255,255,255,0.34), 0px 3px 0 rgba(74,56,43,0.22)",
          filter: pressed
            ? "brightness(0.96) saturate(0.95)"
            : hovered
              ? "brightness(1.04) saturate(1.02)"
              : "none",
          transform: [
            { translateY: pressed ? 1.2 : hovered ? -0.8 : 0 },
            { scale: pressed ? 0.987 : hovered ? 1.012 : 1 },
          ],
        } as never)
      : undefined;

  return (
    <View className={`absolute z-20 flex-row ${placementClass} ${className ?? ""}`.trim()}>
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        hitSlop={6}
        onHoverIn={Platform.OS === "web" ? () => setHovered(true) : undefined}
        onHoverOut={
          Platform.OS === "web"
            ? () => {
                setHovered(false);
                setPressed(false);
              }
            : undefined
        }
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        className={`rounded-full border p-[2px] ${
          isDark
            ? "border-[#5a4538] bg-[#1a130f]/75"
            : "border-[#b8aa99] bg-[#f4ebde]/72"
        } web:cursor-pointer web:select-none`}
      >
        <View
          className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 ${
            isDark
              ? "border-[#876d59] bg-[#2d2018]"
              : "border-[#9d8b78] bg-[#eee4d5]"
          }`}
          style={webVisualStyle}
        >
          <Feather
            name="chevron-left"
            size={14}
            color={isDark ? (pressed ? "#d56d4f" : "#df7b5f") : pressed ? "#bd5b3f" : "#d16042"}
          />
          <Text className={`text-[11px] font-black uppercase tracking-[1.25px] ${isDark ? "text-[#f1e1cc]" : "text-[#2f2722]"}`}>
            {label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
