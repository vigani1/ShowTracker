import { Pressable, ScrollView, Text, View } from "react-native";

export type FilterChipOption<T extends string = string> = {
  value: T;
  label: string;
  count?: number;
};

type FilterChipGroupProps<T extends string> = {
  options: FilterChipOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
};

export function FilterChipGroup<T extends string>({
  options,
  value,
  onValueChange,
  className,
}: FilterChipGroupProps<T>) {
  return (
    <View className={className}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 6 }}
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onValueChange(option.value)}
              className={`flex-row items-center gap-1 rounded-full border px-3 py-2 ${
                isActive
                  ? "border-primary/70 bg-primary/15"
                  : "border-border-default bg-bg-surface"
              }`}
              style={({ pressed }) =>
                pressed && !isActive ? { opacity: 0.8 } : undefined
              }
            >
              <Text
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  isActive ? "text-text-primary" : "text-text-secondary"
                }`}
              >
                {option.label}
              </Text>
              {typeof option.count === "number" ? (
                <Text
                  className={`text-[11px] font-black ${
                    isActive ? "text-primary" : "text-text-secondary"
                  }`}
                >
                  {option.count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
