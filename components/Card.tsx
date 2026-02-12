import type { PropsWithChildren } from "react";
import { Pressable, View } from "react-native";

interface CardProps extends PropsWithChildren {
  className?: string;
  onPress?: () => void;
}

export function Card({ children, className, onPress }: CardProps) {
  const base = "rounded-xl border-2 border-border-default bg-bg-elevated overflow-hidden";

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`${base} ${className ?? ""}`.trim()}
        style={({ pressed }) => (pressed ? { opacity: 0.95 } : undefined)}
      >
        {children}
      </Pressable>
    );
  }

  return <View className={`${base} ${className ?? ""}`.trim()}>{children}</View>;
}
