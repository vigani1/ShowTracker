import { Link, type Href, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

const inputClasses =
  "rounded-xl border border-border-default bg-bg-elevated px-4 py-3 text-base text-text-primary";

export function LoginScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isDesktopAuth =
    Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;

  const handleAuthResult = (
    result: Awaited<ReturnType<typeof signIn>>,
    messages: { verificationRequired: string; authenticationFailed: string; fallback: string }
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
      setSuccess("Successfully signed in! Redirecting...");
      // AuthGate will handle the redirect when auth state updates
      return; 
    }
    const verificationRequired = authResult.started === true || authResult.verificationRequired === true || authResult.requiresVerification === true || authResult.emailVerificationRequired === true || authResult.requiresEmailVerification === true || authResult.confirmationRequired === true || authResult.requiresConfirmation === true || authResult.needsConfirmation === true;
    if (verificationRequired) { setError(messages.verificationRequired); return; }
    const rawFailureSignal = (typeof authResult.errorCode === "string" && authResult.errorCode) || (typeof authResult.reason === "string" && authResult.reason) || (typeof authResult.error === "string" && authResult.error) || (typeof authResult.status === "string" && authResult.status) || "";
    const failureSignal = rawFailureSignal.toLowerCase();
    const authFailed = authResult.failed === true || authResult.success === false || authResult.authenticationFailed === true || authResult.invalidCredentials === true || failureSignal.includes("invalid") || failureSignal.includes("credential") || failureSignal.includes("unauthorized") || failureSignal.includes("auth_failed");
    if (authFailed) { setError(messages.authenticationFailed); return; }
    setError(messages.fallback);
  };

  const handleSignIn = async () => {
    if (!email.trim()) { setError("Please enter your email address."); return; }
    if (!password) { setError("Please enter your password."); return; }
    setIsPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await signIn("password", { flow: "signIn", email: email.trim().toLowerCase(), password });
      handleAuthResult(result, { 
        verificationRequired: "Please check your email and verify your account before signing in.", 
        authenticationFailed: "Invalid email or password. Please try again.", 
        fallback: "Sign in needs an additional verification step. Please check your email." 
      });
    } catch (authError) {
      console.error("Login failed", authError);
      const errorMessage = authError instanceof Error ? authError.message : "";
      if (errorMessage.includes("Invalid") || errorMessage.includes("credential")) {
        setError("Invalid email or password. Please try again.");
      } else if (errorMessage.includes("network") || errorMessage.includes("connection")) {
        setError("Network error. Please check your internet connection and try again.");
      } else {
        setError("Something went wrong. Please try again later.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleAnonymousSignIn = async () => {
    setIsPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await signIn("anonymous");
      const authResult = result as Record<string, unknown>;
      
      if (authResult.signingIn === true) {
        setSuccess("Continuing as guest...");
        return;
      }
      
      setError("Failed to continue as guest. Please try again.");
    } catch (authError) {
      console.error("Anonymous login failed", authError);
      setError("Failed to continue as guest. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ScreenWrapper>
      <View className={`gap-5 ${isDesktopAuth ? "mx-auto max-w-md pt-12" : "pt-16"}`}>
        <View>
          <Text className="text-sm font-semibold text-primary">ShowTracker</Text>
          <Text className="mt-2 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
            Sign In
          </Text>
          <Text className="mt-1 text-sm text-text-secondary">
            Access your watch data
          </Text>
        </View>

        <View className="gap-3 rounded-2xl border border-border-default bg-bg-surface p-5">
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#52525b"
            className={inputClasses}
            editable={!isPending}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#52525b"
            className={inputClasses}
            editable={!isPending}
          />
          
          {/* Error Message */}
          {error ? (
            <View className="rounded-lg bg-primary/10 p-3">
              <Text className="text-sm text-primary">{error}</Text>
            </View>
          ) : null}
          
          {/* Success Message */}
          {success ? (
            <View className="rounded-lg bg-success/10 p-3">
              <Text className="text-sm text-success">{success}</Text>
            </View>
          ) : null}
          
          <Button label={isPending ? "Signing in..." : "Sign in"} onPress={handleSignIn} disabled={isPending} />
          <Button label="Continue as guest" variant="secondary" onPress={handleAnonymousSignIn} disabled={isPending} />
        </View>

        <Link href="/register" className="text-sm font-semibold text-primary">
          Need an account? Create one
        </Link>
      </View>
    </ScreenWrapper>
  );
}

export default LoginScreen;
