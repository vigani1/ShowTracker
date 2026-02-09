import { Link, type Href, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { DESKTOP_TAB_RAIL_BREAKPOINT } from "@/constants/navigation";

export function LoginScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isDesktopAuth =
    Platform.OS === "web" && width >= DESKTOP_TAB_RAIL_BREAKPOINT;

  const handleAuthResult = (
    result: Awaited<ReturnType<typeof signIn>>,
    messages: {
      verificationRequired: string;
      authenticationFailed: string;
      fallback: string;
    }
  ) => {
    const authResult = result as Record<string, unknown>;

    const redirectValue = authResult.redirect;
    if (redirectValue instanceof URL || typeof redirectValue === "string") {
      const redirectTarget = redirectValue.toString();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = redirectTarget;
      } else {
        router.replace(redirectTarget as Href);
      }
      return;
    }

    if (authResult.signingIn === true) {
      router.replace("/");
      return;
    }

    const verificationRequired =
      authResult.started === true ||
      authResult.verificationRequired === true ||
      authResult.requiresVerification === true ||
      authResult.emailVerificationRequired === true ||
      authResult.requiresEmailVerification === true ||
      authResult.confirmationRequired === true ||
      authResult.requiresConfirmation === true ||
      authResult.needsConfirmation === true;
    if (verificationRequired) {
      setError(messages.verificationRequired);
      return;
    }

    const rawFailureSignal =
      (typeof authResult.errorCode === "string" && authResult.errorCode) ||
      (typeof authResult.reason === "string" && authResult.reason) ||
      (typeof authResult.error === "string" && authResult.error) ||
      (typeof authResult.status === "string" && authResult.status) ||
      "";
    const failureSignal = rawFailureSignal.toLowerCase();
    const authFailed =
      authResult.failed === true ||
      authResult.success === false ||
      authResult.authenticationFailed === true ||
      authResult.invalidCredentials === true ||
      failureSignal.includes("invalid") ||
      failureSignal.includes("credential") ||
      failureSignal.includes("unauthorized") ||
      failureSignal.includes("auth_failed");
    if (authFailed) {
      setError(messages.authenticationFailed);
      return;
    }

    setError(messages.fallback);
  };

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
      handleAuthResult(result, {
        verificationRequired:
          "Please verify your email before completing sign in.",
        authenticationFailed: "Invalid credentials.",
        fallback: "Sign in needs an additional verification step.",
      });
    } catch (authError) {
      console.error("Login failed", authError);
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
      const result = await signIn("anonymous");
      handleAuthResult(result, {
        verificationRequired:
          "Guest sign in needs confirmation before continuing.",
        authenticationFailed: "Failed to continue as guest.",
        fallback: "Guest sign in could not be completed yet.",
      });
    } catch (authError) {
      console.error("Anonymous login failed", authError);
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
    <ScreenWrapper contentClassName="pt-6">
      <View className={`gap-4 ${isDesktopAuth ? "pt-4" : "pt-12"}`}>
        <View className="rounded-[24px] border-2 border-brand-frame/55 bg-brand-light-surface px-5 py-4 dark:border-brand-surface/75 dark:bg-brand-surface/85">
          <Text className="mt-1 font-serif text-4xl font-bold text-brand-ink dark:text-brand-text">
            Sign In
          </Text>
          <Text className="mt-1 text-sm leading-6 text-brand-ink-soft dark:text-[#e2d7c1]">
            Access your watch data
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
          {error ? (
            <Text className="text-sm text-red-600 dark:text-red-300">{error}</Text>
          ) : null}
          <Button
            label={isPending ? "Signing in..." : "Sign in"}
            onPress={handleSignIn}
            disabled={isPending}
          />
          <Button
            label="Continue as guest"
            className="bg-brand-surface"
            onPress={handleAnonymousSignIn}
            disabled={isPending}
          />
        </View>

        <Link
          href="/register"
          className="text-sm font-semibold uppercase tracking-[1.2px] text-brand-primary"
        >
          Need an account? Create one
        </Link>
      </View>
    </ScreenWrapper>
  );
}

export default LoginScreen;
