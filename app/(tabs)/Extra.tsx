import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export function ExtraScreen() {
  return (
    <ScreenWrapper>
      <View className="pb-0">
        <View className="rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface px-4 py-5 dark:border-brand-surface/75 dark:bg-brand-surface/75">
          <Text className="font-serif text-2xl font-bold text-brand-ink dark:text-brand-text">
            More
          </Text>
          <Text className="mt-2 text-sm leading-6 text-brand-ink-soft dark:text-[#e2d7c1]">
            Reserved for future tools.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}

export default ExtraScreen;
