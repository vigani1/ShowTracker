import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function ScheduleScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-text">Schedule</Text>
        <Text className="text-base text-slate-400">
          Upcoming episodes for your tracked shows will be grouped by date.
        </Text>
        <View className="rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-sm text-brand-text">
            TVMaze + AniList schedule data will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
