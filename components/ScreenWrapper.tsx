import { usePathname } from "expo-router";
import type { PropsWithChildren } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DESKTOP_TAB_RAIL_BREAKPOINT } from "@/constants/navigation";
import { TvSideRemotePanel } from "@/components/TvSideRemotePanel";

const baseClasses =
  "flex-1 bg-brand-light-background dark:bg-brand-background";

interface ScreenWrapperProps extends PropsWithChildren {
  className?: string;
  contentClassName?: string;
}

export function ScreenWrapper({
  children,
  className,
  contentClassName,
}: ScreenWrapperProps) {
  const isWeb = Platform.OS === "web";
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktopWeb = isWeb && width >= DESKTOP_TAB_RAIL_BREAKPOINT;
  const isAuthRoute = pathname === "/login" || pathname === "/register";
  const showLeftControls = isDesktopWeb && !isAuthRoute;
  const shellPaddingClass = isDesktopWeb ? "" : "px-0 pb-0 pt-0";
  const webContentClasses =
    "flex-1 rounded-[18px] border border-[#8d8277] bg-[#e8e1d4]/95 px-4 pb-0 pt-0 dark:border-[#5b4638] dark:bg-[#130f0c]/95";
  const mobileContentClasses =
    "flex-1 rounded-[17px] border border-brand-frame/45 bg-brand-light-surface/95 px-2.5 pb-0 pt-0 dark:border-brand-surface dark:bg-brand-background/90";

  return (
    <SafeAreaView className={`${baseClasses} ${className ?? ""}`.trim()}>
      <View className="absolute inset-0">
        <View className="absolute inset-0 bg-[#eadfcf] dark:bg-[#120d0a]" />
        <View className="absolute -right-20 -top-16 h-72 w-72 rounded-full bg-brand-primary/12" />
        <View className="absolute -left-16 top-28 h-48 w-48 rounded-full bg-brand-accent/12" />
      </View>

      <View
        className={`flex-1 self-center ${shellPaddingClass}`}
        style={
          isDesktopWeb
            ? {
                width: "100%",
                maxWidth: 1600,
                paddingHorizontal: 2,
                paddingTop: 2,
                paddingBottom: 2,
              }
            : { width: "100%", paddingHorizontal: 1, paddingTop: 1, paddingBottom: 1 }
        }
      >
        {isDesktopWeb ? (
          <>
            <View
              className="z-10 flex-1 overflow-hidden rounded-[44px] border-[4px] border-[#7d2e22] bg-[#7a6a65] p-2.5 dark:border-[#4c3528] dark:bg-[#2f2119]"
            >
              <View className="flex-1 rounded-[34px] border-[3px] border-[#c4b49f] bg-[#d9d1c2] p-2.5 dark:border-[#5b473a] dark:bg-[#221913]">
                <View
                  style={{ pointerEvents: "none" }}
                  className="flex-row items-center justify-between px-3"
                >
                  <Text className="text-[9px] font-bold uppercase tracking-[1.9px] text-[#635550] dark:text-[#d3bda9]">
                    ShowTracker TV
                  </Text>
                  <Text className="text-[9px] font-bold uppercase tracking-[1.9px] text-[#635550] dark:text-[#d3bda9]">
                    Channel 3
                  </Text>
                </View>
                <View className="mb-2 mt-1 h-px bg-[#8a7b70]/35 dark:bg-[#694f3f]/65" />

                <View className="flex-1 flex-row gap-2">
                  {showLeftControls ? <TvSideRemotePanel /> : null}

                  <View className="flex-1 rounded-[28px] border-[3px] border-[#3c3e45] bg-[#1f2127] p-1.5">
                    <View className="flex-1 overflow-hidden rounded-[22px] border-2 border-[#8f8477] bg-[#ece5d8] dark:border-[#564233] dark:bg-[#0f0b08]">
                      <View
                        style={{ pointerEvents: "none" }}
                        className="absolute inset-0 z-20"
                      >
                        <View className="absolute inset-0 border border-[#ffffff26]" />
                        <View className="absolute left-8 right-12 top-3 h-8 rounded-full bg-white/12 dark:bg-[#f6e8d0]/6" />
                        <View className="absolute left-0 right-0 top-0 h-12 bg-white/8 dark:bg-[#f2e5d2]/4" />
                      </View>

                      <View className={`${webContentClasses} ${contentClassName ?? ""}`.trim()}>
                        {children}
                      </View>
                    </View>
                  </View>
                </View>

                <View style={{ pointerEvents: "none" }} className="pt-2">
                  <View className="px-4">
                    <Text className="text-[9px] font-bold uppercase tracking-[2px] text-[#5f514a] dark:text-[#d3bda9]">
                      Insert DVD
                    </Text>
                    <View className="mt-1 h-2 w-[42%] rounded-full border border-[#5f564e] bg-[#070605] dark:border-[#3f3228] dark:bg-[#020101]" />
                  </View>
                </View>
              </View>
            </View>
          </>
        ) : (
          <View className="flex-1 overflow-hidden rounded-[24px] border-[3px] border-brand-frame/75 bg-brand-frame/80 p-1.5 dark:border-brand-frame-light/30 dark:bg-[#17202d]">
            <View className="flex-1 overflow-hidden rounded-[20px] border-2 border-brand-frame-light/70 bg-brand-light-background/95 p-1 dark:border-brand-surface/85 dark:bg-[#121b27]">
              <View className={`${mobileContentClasses} ${contentClassName ?? ""}`.trim()}>
                {children}
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
