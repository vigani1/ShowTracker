import { Link } from "expo-router";
import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function LoginScreen() {
  return (
    <ScreenWrapper contentClassName="justify-center">
      <View className="gap-4">
        <Text className="text-3xl font-semibold text-brand-text">Welcome back</Text>
        <Text className="text-base text-slate-400">
          Sign in to sync your watchlist across every device.
        </Text>
        <View className="mt-6 rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-base text-brand-text">Auth form coming next.</Text>
        </View>
        <Link href="/register" className="text-sm text-brand-primary">
          Need an account? Create one
        </Link>
      </View>
    </ScreenWrapper>
  );
}
