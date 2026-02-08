import { Text, View } from "react-native";

const baseClasses =
  "rounded-full border border-brand-primary/40 bg-brand-primary/20 px-3 py-1";
const textClasses = "text-xs font-medium text-brand-primary";

interface BadgeProps {
  label: string;
  className?: string;
  textClassName?: string;
}

export function Badge({ label, className, textClassName }: BadgeProps) {
  return (
    <View className={`${baseClasses} ${className ?? ""}`.trim()}>
      <Text className={`${textClasses} ${textClassName ?? ""}`.trim()}>
        {label}
      </Text>
    </View>
  );
}
