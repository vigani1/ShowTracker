import type { PropsWithChildren } from "react";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { HeaderIconButton } from "@/components/HeaderIconButton";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

type OverlayDetailFrameProps = PropsWithChildren<{
  onClose: () => void;
  closeAccessibilityLabel?: string;
}>;

export function OverlayDetailFrame({
  children,
  onClose,
  closeAccessibilityLabel = "Close show details",
}: OverlayDetailFrameProps) {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;

  return (
    <View className="flex-1 bg-black/65">
      {isDesktop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeAccessibilityLabel}
          className="absolute inset-0"
          onPress={onClose}
        />
      ) : null}

      <View
        className={
          isDesktop
            ? "ml-auto h-full w-full max-w-5xl overflow-hidden border-l-2 border-border-bright bg-bg-base shadow-2xl"
            : "flex-1 overflow-hidden rounded-t-[22px] border-t-2 border-border-bright bg-bg-base shadow-2xl"
        }
        style={
          isDesktop
            ? { shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 36 }
            : { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 28 }
        }
      >
        {isDesktop ? (
          children
        ) : (
          <>
            <View className="z-30 h-14 justify-center border-b border-border-default bg-bg-base/95 px-3">
              <HeaderIconButton
                icon="close"
                accessibilityLabel={closeAccessibilityLabel}
                onPress={onClose}
              />
            </View>
            <View className="flex-1 overflow-hidden">{children}</View>
          </>
        )}
      </View>
    </View>
  );
}
