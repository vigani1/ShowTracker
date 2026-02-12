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
      className={`flex-row rounded-2xl border border-border-default bg-bg-surface/85 p-1.5 ${className ?? ""}`.trim()}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onValueChange(opt.value)}
            className={`flex-1 items-center justify-center rounded-xl py-2.5 ${
              isActive ? "border border-primary/40 bg-primary/15" : ""
            }`}
            style={({ pressed }) =>
              pressed && !isActive ? { opacity: 0.8 } : undefined
            }
          >
            <Text
              className={`text-sm ${
                isActive
                  ? "font-bold text-text-primary"
                  : "font-medium text-text-secondary"
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
