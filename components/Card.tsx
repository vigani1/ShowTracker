import type { PropsWithChildren } from "react";
import { View } from "react-native";

const baseClasses = "rounded-2xl border border-brand-surface bg-brand-surface/70 p-4";

interface CardProps extends PropsWithChildren<{}> {
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <View className={`${baseClasses} ${className ?? ""}`.trim()}>{children}</View>
  );
}
