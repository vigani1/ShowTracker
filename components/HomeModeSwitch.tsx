import { Pressable, Text, View, useWindowDimensions } from "react-native";

export type HomeModeOption<T extends string = string> = {
  value: T;
  label: string;
};

type HomeModeSwitchProps<T extends string> = {
  options: HomeModeOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  compact?: boolean;
};

export function HomeModeSwitch<T extends string>({
  options,
  value,
  onValueChange,
  className,
  compact = false,
}: HomeModeSwitchProps<T>) {
  const { width } = useWindowDimensions();
  const isSmallPhone = width < 390;
  const isFabricEnabled =
    "NativeFabricUIManager" in globalThis || "__turboModuleProxy" in globalThis;
  const labelFitProps = isFabricEnabled
    ? {}
    : {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.82,
      };

  return (
    <View
      accessibilityRole="tablist"
      className={`flex-row rounded-lg border border-border-default bg-bg-base p-1 ${className ?? ""}`.trim()}
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onValueChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className={`flex-1 items-center justify-center rounded-md border ${
              compact ? "py-2.5" : "py-3"
            } ${
              isActive
                ? "border-primary/50 bg-bg-surface"
                : "border-transparent bg-transparent"
            }`}
            style={({ pressed }) =>
              pressed && !isActive ? { opacity: 0.78 } : undefined
            }
          >
            <Text
              className={`${compact && isSmallPhone ? "text-[11px]" : "text-xs"} font-black uppercase tracking-wide ${
                isActive ? "text-text-primary" : "text-text-secondary"
              }`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={
                isFabricEnabled
                  ? {
                      fontSize: compact && isSmallPhone ? 11 : 12,
                      lineHeight: 16,
                    }
                  : undefined
              }
              {...labelFitProps}
            >
              {option.label}
            </Text>
            <View
              className={`mt-2 h-0.5 w-8 rounded-full ${
                isActive ? "bg-primary" : "bg-transparent"
              }`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
