import type { PropsWithChildren } from "react";
import { View } from "react-native";

const baseClasses =
  "rounded-2xl border-2 border-brand-surface/65 bg-brand-light-surface p-4 dark:bg-brand-surface/80";

interface CardProps extends PropsWithChildren {
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <View className={`${baseClasses} ${className ?? ""}`.trim()}>{children}</View>
  );
}
