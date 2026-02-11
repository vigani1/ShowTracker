import { Text, View } from "react-native";
import { PageBackButton } from "@/components/PageBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function CreateListScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3 pt-12">
        <PageBackButton fallbackHref="/" />
        <Text className="text-2xl font-bold text-text-primary">
          Create list
        </Text>
        <Text className="text-sm text-text-secondary">
          Name your list and add a description.
        </Text>
        <View className="rounded-2xl border border-border-default bg-bg-surface p-4">
          <Text className="text-sm text-text-secondary">
            Form controls will be added in Phase 6.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
