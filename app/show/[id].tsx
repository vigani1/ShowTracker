import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-text">Show detail</Text>
        <Text className="text-base text-slate-400">Show ID: {id}</Text>
        <View className="rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-sm text-brand-text">
            Hero media, seasons, and episode tracking will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
