import { Feather } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

interface PageBackButtonProps {
  fallbackHref?: Href;
  className?: string;
}

export function PageBackButton({ fallbackHref, className }: PageBackButtonProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const iconColor = "#fafafa";
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const placementClass = isDesktop ? "left-5 top-5" : "left-4 top-4";

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref);
    }
  };

  return (
    <View className={`absolute z-20 ${placementClass} ${className ?? ""}`.trim()}>
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full border border-border-default bg-bg-surface/90"
        style={({ pressed }) => (pressed ? { opacity: 0.85, transform: [{ scale: 0.95 }] } : undefined)}
      >
        <Feather name="chevron-left" size={20} color={iconColor} />
      </Pressable>
    </View>
  );
}
