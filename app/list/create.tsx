import { Text, View } from "react-native";
import { PageBackButton } from "@/components/PageBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function CreateListScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3 pt-12">
        <PageBackButton fallbackHref="/" />

        <Text className="text-2xl font-semibold text-brand-light-text dark:text-brand-text">
          Create list
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          Name your list and add a description.
        </Text>
        <View className="rounded-2xl border border-brand-surface/40 bg-brand-light-surface p-4 dark:border-brand-surface dark:bg-brand-surface/60">
          <Text className="text-sm text-brand-light-text dark:text-brand-text">
            Form controls will be added in Phase 6.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
