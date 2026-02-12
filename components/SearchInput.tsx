import { Feather } from "@expo/vector-icons";
import { Pressable, TextInput, View } from "react-native";

interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search shows, anime, movies...",
  className,
}: SearchInputProps) {
  const hasValue = value.trim().length > 0;

  return (
    <View
      className={`flex-row items-center gap-2 rounded-lg border-2 px-3 py-2.5 ${
        hasValue
          ? "border-border-bright bg-bg-elevated/70"
          : "border-border-default bg-bg-surface"
      } ${className ?? ""}`.trim()}
    >
      <View className="h-8 w-8 items-center justify-center rounded-xl bg-bg-base/60">
        <Feather name="search" size={16} color={hasValue ? "#ef4444" : "#a1a1aa"} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#52525b"
        className="flex-1 text-base text-text-primary"
        returnKeyType="search"
      />
      {hasValue ? (
        <Pressable
          onPress={() => onChangeText("")}
          className="h-7 w-7 items-center justify-center rounded-full bg-bg-base/70"
        >
          <Feather name="x" size={14} color="#a1a1aa" />
        </Pressable>
      ) : null}
    </View>
  );
}
