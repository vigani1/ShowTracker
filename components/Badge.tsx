import { Text, View } from "react-native";

export type BadgeVariant = "default" | "primary" | "accent" | "success" | "warning";

type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
  className?: string;
  textClassName?: string;
};

const variantBg: Record<BadgeVariant, string> = {
  default: "bg-bg-elevated/90 border border-border-bright",
  primary: "bg-primary/20 border border-primary/40",
  accent: "bg-accent/20 border border-accent/40",
  success: "bg-success/20 border border-success/40",
  warning: "bg-warning/20 border border-warning/40",
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
    <View className={`rounded-md px-2.5 py-1 ${variantBg[variant]} ${className ?? ""}`.trim()}>
      <Text
        className={`text-[11px] font-black uppercase tracking-wide ${variantText[variant]} ${textClassName ?? ""}`.trim()}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
