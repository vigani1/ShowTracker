import { Text, View } from "react-native";

export type BadgeVariant = "default" | "primary" | "accent" | "success" | "warning";

type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
  className?: string;
  textClassName?: string;
};

const variantBg: Record<BadgeVariant, string> = {
  default: "bg-bg-elevated/90",
  primary: "bg-primary/20",
  accent: "bg-accent/20",
  success: "bg-success/20",
  warning: "bg-warning/20",
};

const variantText: Record<BadgeVariant, string> = {
  default: "text-text-secondary",
  primary: "text-primary",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
};

export function Badge({
  label,
  variant = "default",
  className,
  textClassName,
}: BadgeProps) {
  return (
    <View className={`rounded-full px-2.5 py-1 ${variantBg[variant]} ${className ?? ""}`.trim()}>
      <Text
        className={`text-xs font-medium ${variantText[variant]} ${textClassName ?? ""}`.trim()}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
