import { Pressable, Text, View } from "react-native";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <View
      className={`flex-row rounded-xl border border-border-default bg-bg-surface p-1 ${className ?? ""}`.trim()}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onValueChange(opt.value)}
            className={`flex-1 items-center justify-center rounded-lg py-2 ${
              isActive ? "bg-bg-elevated" : ""
            }`}
            style={({ pressed }) =>
              pressed && !isActive ? { opacity: 0.8 } : undefined
            }
          >
            <Text
              className={`text-sm font-medium ${
                isActive
                  ? "text-text-primary"
                  : "text-text-secondary"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
