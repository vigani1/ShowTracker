import { Feather } from "@expo/vector-icons";
import { TextInput, View } from "react-native";

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
  return (
    <View
      className={`flex-row items-center gap-2 rounded-2xl border border-border-default bg-bg-surface px-4 py-3 ${className ?? ""}`.trim()}
    >
      <Feather name="search" size={20} color="#a1a1aa" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#52525b"
        className="flex-1 text-base text-text-primary"
        returnKeyType="search"
      />
    </View>
  );
}
