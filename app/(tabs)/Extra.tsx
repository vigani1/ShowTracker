import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export function ExtraScreen() {
  return (
    <ScreenWrapper>
      <View className="items-center py-10">
        <Text className="text-sm text-text-secondary">This tab is hidden.</Text>
      </View>
    </ScreenWrapper>
  );
}
