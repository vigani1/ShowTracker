import { Link } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function RegisterScreen() {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleRegister = async () => {
    if (!email.trim() || !password || !confirmPassword) {
      setError("Email and password are required.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await signIn("password", {
        flow: "signUp",
        email: email.trim().toLowerCase(),
        password,
      });

      if (!result.signingIn) {
        setError("Failed to create account.");
      }
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Failed to create account."
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ScreenWrapper contentClassName="justify-center">
      <View className="gap-4">
        <Text className="text-3xl font-semibold text-brand-light-text dark:text-brand-text">
          Create account
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          Get started with your personalized tracking dashboard.
        </Text>
        <View className="mt-2 gap-3 rounded-2xl border border-brand-surface/40 bg-brand-light-surface p-4 dark:border-brand-surface dark:bg-brand-surface/60">
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#64748b"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#64748b"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Confirm password"
            placeholderTextColor="#64748b"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {error ? (
            <Text className="text-sm text-red-500 dark:text-red-400">{error}</Text>
          ) : null}
          <Button
            label={isPending ? "Creating account..." : "Create account"}
            onPress={handleRegister}
            disabled={isPending}
          />
        </View>
        <Link href="/login" className="text-sm text-brand-primary">
          Already have an account? Sign in
        </Link>
      </View>
    </ScreenWrapper>
  );
}
