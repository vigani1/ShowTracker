import { Pressable, Text, View, useWindowDimensions } from "react-native";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  compact?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  className,
  compact = false,
}: SegmentedControlProps<T>) {
  const { width } = useWindowDimensions();
  const isSmallPhone = width < 390;
  const isFabricEnabled =
    "NativeFabricUIManager" in globalThis || "__turboModuleProxy" in globalThis;
  const labelFitProps = isFabricEnabled
    ? {}
    : {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.8,
      };

  return (
    <View
      className={`flex-row rounded-lg border border-border-default bg-bg-surface/85 ${compact ? "p-1" : "p-1.5"} ${className ?? ""}`.trim()}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onValueChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            className={`flex-1 items-center justify-center rounded-md ${compact ? "py-2" : "py-2.5"} ${
              isActive ? "border border-primary/40 bg-primary/15" : ""
            }`}
            style={({ pressed }) =>
              pressed && !isActive ? { opacity: 0.8 } : undefined
            }
          >
            <Text
              className={`${compact && isSmallPhone ? "text-[10px]" : "text-xs"} uppercase tracking-wide ${
                isActive
                  ? "font-black text-text-primary"
                  : "font-bold text-text-secondary"
              }`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={
                isFabricEnabled
                  ? { fontSize: compact && isSmallPhone ? 10 : 12, lineHeight: 16 }
                  : undefined
              }
              {...labelFitProps}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
