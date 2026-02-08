import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function SearchScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-text">Search</Text>
        <Text className="text-base text-slate-400">
          Unified search across TV, anime, and movies will appear here.
        </Text>
        <View className="rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-sm text-brand-text">
            Add query input, type filters, and results grid.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
