import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type FilterBarOption<T extends string = string> = {
  value: T;
  label: string;
  count?: number;
};

type FilterBarProps<T extends string> = {
  options: FilterBarOption<T>[];
  value?: T;
  onValueChange?: (value: T) => void;
  className?: string;
  contentClassName?: string;
  leadingLabel?: string;
  align?: "start" | "center";
  compact?: boolean;
};

type DropdownFilterChipProps = {
  label: string;
  active?: boolean;
  open?: boolean;
  onPress: () => void;
  className?: string;
};

type ClearFilterChipProps = {
  label?: string;
  onPress: () => void;
};

export function FilterBar<T extends string>({
  options,
  value,
  onValueChange,
  className,
  contentClassName,
  leadingLabel,
  align = "start",
  compact = false,
}: FilterBarProps<T>) {
  return (
    <View className={className}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 8,
          flexGrow: 1,
          justifyContent: align === "center" ? "center" : "flex-start",
          paddingRight: align === "center" ? 0 : 6,
        }}
      >
        <View className={`flex-row items-center gap-2 ${contentClassName ?? ""}`.trim()}>
          {leadingLabel ? (
            <Text className="mr-1 text-[10px] font-black uppercase tracking-wide text-text-muted">
              {leadingLabel}
            </Text>
          ) : null}
          {options.map((option) => {
            const isActive = option.value === value;

            return (
              <Pressable
                key={option.value}
                onPress={() => onValueChange?.(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                className={`${compact ? "min-h-8 px-2.5 py-1.5" : "min-h-9 px-3 py-2"} flex-row items-center gap-1.5 rounded-full border ${
                  isActive
                    ? "border-primary/70 bg-primary/15"
                    : "border-border-default bg-bg-surface"
                }`}
                style={({ pressed }) =>
                  pressed && !isActive ? { opacity: 0.82 } : undefined
                }
              >
                <Text
                  className={`${compact ? "text-[10px]" : "text-[11px]"} font-black uppercase tracking-wide ${
                    isActive ? "text-text-primary" : "text-text-secondary"
                  }`}
                >
                  {option.label}
                </Text>
                {typeof option.count === "number" ? (
                  <View
                    className={`min-w-5 items-center rounded-full border px-1.5 py-0.5 ${
                      isActive
                        ? "border-primary/20 bg-primary/25"
                        : "border-border-bright bg-bg-elevated"
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-black ${
                        isActive ? "text-primary" : "text-text-secondary"
                      }`}
                    >
                      {option.count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export function DropdownFilterChip({
  label,
  active = false,
  open = false,
  onPress,
  className,
}: DropdownFilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open, selected: active }}
      className={`min-h-9 flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
        active
          ? "border-primary/70 bg-primary/15"
          : "border-border-default bg-bg-surface"
      } ${className ?? ""}`.trim()}
      style={({ pressed }) => (pressed ? { opacity: 0.84 } : undefined)}
    >
      <Text
        className={`text-[11px] font-black uppercase tracking-wide ${
          active ? "text-text-primary" : "text-text-secondary"
        }`}
      >
        {label}
      </Text>
      <Ionicons
        name={open ? "chevron-up" : "chevron-down"}
        size={14}
        color={active ? "#ef4444" : "#a1a1aa"}
      />
    </Pressable>
  );
}

export function ClearFilterChip({ label = "Clear", onPress }: ClearFilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-9 flex-row items-center gap-1.5 rounded-full border border-border-default bg-bg-surface px-3 py-2"
      style={({ pressed }) => (pressed ? { opacity: 0.84 } : undefined)}
    >
      <Ionicons name="close" size={13} color="#a1a1aa" />
      <Text className="text-[11px] font-black uppercase tracking-wide text-text-secondary">
        {label}
      </Text>
    </Pressable>
  );
}
