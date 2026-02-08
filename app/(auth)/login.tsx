import { Link } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function LoginScreen() {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await signIn("password", {
        flow: "signIn",
        email: email.trim().toLowerCase(),
        password,
      });

      if (!result.signingIn) {
        setError("Invalid credentials.");
      }
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : "Failed to sign in."
      );
    } finally {
      setIsPending(false);
    }
  };

  const handleAnonymousSignIn = async () => {
    setIsPending(true);
    setError(null);
    try {
      await signIn("anonymous");
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Failed to continue as guest."
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ScreenWrapper contentClassName="justify-center">
      <View className="gap-4">
        <Text className="text-3xl font-semibold text-brand-light-text dark:text-brand-text">
          Welcome back
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          Sign in to sync your watchlist across every device.
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
          {error ? (
            <Text className="text-sm text-red-500 dark:text-red-400">{error}</Text>
          ) : null}
          <Button
            label={isPending ? "Signing in..." : "Sign in"}
            onPress={handleSignIn}
            disabled={isPending}
          />
          <Button
            label="Continue as guest"
            className="bg-slate-700 dark:bg-slate-600"
            onPress={handleAnonymousSignIn}
            disabled={isPending}
          />
        </View>
        <Link href="/register" className="text-sm text-brand-primary">
          Need an account? Create one
        </Link>
      </View>
    </ScreenWrapper>
  );
}
