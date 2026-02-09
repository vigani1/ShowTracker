import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PageBackButton } from "@/components/PageBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScreenWrapper>
      <View className="gap-3 pt-12">
        <PageBackButton fallbackHref="/" />

        <Text className="text-2xl font-semibold text-brand-light-text dark:text-brand-text">
          Custom list
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          List ID: {id}
        </Text>
        <View className="rounded-2xl border border-brand-surface/40 bg-brand-light-surface p-4 dark:border-brand-surface dark:bg-brand-surface/60">
          <Text className="text-sm text-brand-light-text dark:text-brand-text">
            List posters and reorder UI will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
