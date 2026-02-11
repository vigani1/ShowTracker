import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function ScheduleScreen() {
  return (
    <ScreenWrapper>
      <View className="pb-4">
        <Text className="mb-1 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
          Schedule
        </Text>
        <Text className="mb-6 text-sm text-text-secondary">
          Upcoming episodes from your tracked shows
        </Text>
        <View className="items-center rounded-2xl border border-border-default bg-bg-surface px-4 py-10">
          <Ionicons name="calendar-outline" size={40} color="#3f3f46" />
          <Text className="mt-3 text-base font-semibold text-text-primary">Coming soon</Text>
          <Text className="mt-1 text-center text-sm text-text-secondary">
            Episode timeline grouped by date will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
