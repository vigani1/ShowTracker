import type { PropsWithChildren } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View } from "react-native";

const baseClasses = "flex-1 bg-brand-background";
const contentClasses = "flex-1 px-4 py-3";

type ScreenWrapperProps = PropsWithChildren<{
  className?: string;
  contentClassName?: string;
}>;

export function ScreenWrapper({
  children,
  className,
  contentClassName,
}: ScreenWrapperProps) {
  return (
    <SafeAreaView className={`${baseClasses} ${className ?? ""}`.trim()}>
      <View className={`${contentClasses} ${contentClassName ?? ""}`.trim()}>
        {children}
      </View>
    </SafeAreaView>
  );
}
