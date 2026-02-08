import { Link } from "expo-router";
import { Text, View } from "react-native";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function RegisterScreen() {
  return (
    <ScreenWrapper contentClassName="justify-center">
      <View className="gap-4">
        <Text className="text-3xl font-semibold text-brand-text">Create account</Text>
        <Text className="text-base text-slate-400">
          Get started with your personalized tracking dashboard.
        </Text>
        <View className="mt-6 rounded-2xl border border-brand-surface bg-brand-surface/60 p-4">
          <Text className="text-base text-brand-text">Registration form coming next.</Text>
        </View>
        <Link href="/login" className="text-sm text-brand-primary">
          Already have an account? Sign in
        </Link>
      </View>
    </ScreenWrapper>
  );
}
