import { Text, View } from "react-native";

const baseClasses =
  "rounded-lg border border-brand-surface/55 bg-brand-primary/15 px-2.5 py-1";
const textClasses = "text-[10px] font-bold uppercase tracking-[1px] text-brand-primary";

type BadgeProps = {
  label: string;
  className?: string;
  textClassName?: string;
};

export function Badge({ label, className, textClassName }: BadgeProps) {
  return (
    <View className={`${baseClasses} ${className ?? ""}`.trim()}>
      <Text className={`${textClasses} ${textClassName ?? ""}`.trim()}>
        {label}
      </Text>
    </View>
  );
}
