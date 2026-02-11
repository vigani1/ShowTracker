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
        <Text className="text-2xl font-bold text-text-primary">
          Custom list
        </Text>
        <Text className="text-sm text-text-secondary">
          List ID: {id}
        </Text>
        <View className="rounded-2xl border border-border-default bg-bg-surface p-4">
          <Text className="text-sm text-text-secondary">
            List posters and reorder UI will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
