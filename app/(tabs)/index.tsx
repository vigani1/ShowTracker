import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function DiscoveryScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-text">Discovery</Text>
        <Text className="text-base text-slate-400">
          Trending TV, anime, and movies will live here.
        </Text>
        <View className="rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-sm text-brand-text">
            Hook up TMDB + AniList clients to populate rows.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
