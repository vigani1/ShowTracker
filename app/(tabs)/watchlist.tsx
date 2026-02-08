import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function WatchlistScreen() {
  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-light-text dark:text-brand-text">
          Watchlist
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          Shows you are currently watching or planning to watch.
        </Text>
        <View className="rounded-2xl border border-brand-surface/40 bg-brand-light-surface p-4 dark:border-brand-surface dark:bg-brand-surface/60">
          <Text className="text-sm text-brand-light-text dark:text-brand-text">
            Watchlist cards with episode counts will live here.
          </Text>
        </View>
      </View>
    </ScreenWrapper>
  );
}
