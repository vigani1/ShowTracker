import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function CreateListScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-text">Create list</Text>
        <Text className="text-base text-slate-400">
          Name your list and add a description.
        </Text>
        <View className="rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-sm text-brand-text">
            Form controls will be added in Phase 6.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
