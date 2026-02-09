import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { PageBackButton } from "@/components/PageBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export function RegisterScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleRegister = async () => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    if (!password) {
      setError("Password is required.");
      return;
    }

    if (!confirmPassword) {
      setError("Password confirmation is required.");
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

      if (result.signingIn) {
        router.replace("/");
        return;
      }
      setError("Failed to create account.");
    } catch (authError) {
      console.error("Register failed", authError);
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
    <ScreenWrapper contentClassName="pt-6">
      <View className="gap-4 pt-12">
        <PageBackButton fallbackHref="/login" />

        <View className="rounded-[24px] border-2 border-brand-frame/55 bg-brand-light-surface px-5 py-4 dark:border-brand-surface/75 dark:bg-brand-surface/85">
          <Text className="mt-1 font-serif text-4xl font-bold text-brand-ink dark:text-brand-text">
            Register
          </Text>
          <Text className="mt-1 text-sm leading-6 text-brand-ink-soft dark:text-[#e2d7c1]">
            Create your account
          </Text>
        </View>

        <View className="gap-3 rounded-2xl border-2 border-brand-frame/55 bg-brand-light-surface p-4 dark:border-brand-surface/75 dark:bg-brand-surface/80">
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#7a6650"
            className="rounded-xl border-2 border-brand-frame/45 bg-[#fffaf0] px-4 py-3 text-base text-brand-ink dark:border-brand-surface/70 dark:bg-brand-background/70 dark:text-brand-text"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#7a6650"
            className="rounded-xl border-2 border-brand-frame/45 bg-[#fffaf0] px-4 py-3 text-base text-brand-ink dark:border-brand-surface/70 dark:bg-brand-background/70 dark:text-brand-text"
          />
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Confirm password"
            placeholderTextColor="#7a6650"
            className="rounded-xl border-2 border-brand-frame/45 bg-[#fffaf0] px-4 py-3 text-base text-brand-ink dark:border-brand-surface/70 dark:bg-brand-background/70 dark:text-brand-text"
          />
          {error ? (
            <Text className="text-sm text-red-600 dark:text-red-300">{error}</Text>
          ) : null}
          <Button
            label={isPending ? "Creating account..." : "Create account"}
            onPress={handleRegister}
            disabled={isPending}
          />
        </View>

        <Link
          href="/login"
          className="text-sm font-semibold uppercase tracking-[1.2px] text-brand-primary"
        >
          Already have an account? Sign in
        </Link>
      </View>
    </ScreenWrapper>
  );
}

export default RegisterScreen;
