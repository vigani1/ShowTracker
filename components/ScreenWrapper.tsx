import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface ScreenWrapperProps extends PropsWithChildren {
  className?: string;
  contentClassName?: string;
}

export function ScreenWrapper({
  children,
  className,
  contentClassName,
}: ScreenWrapperProps) {
  return (
    <SafeAreaView
      className={`flex-1 bg-bg-base ${className ?? ""}`.trim()}
      edges={["top"]}
    >
      <View className={`flex-1 px-5 pt-4 pb-2 ${contentClassName ?? ""}`.trim()}>
        {children}
      </View>
    </SafeAreaView>
  );
}
