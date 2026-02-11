import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { PageBackButton } from "@/components/PageBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

const inputClasses =
  "rounded-xl border border-border-default bg-bg-elevated px-4 py-3 text-base text-text-primary";

export function RegisterScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isDesktopAuth =
    Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  const handleRegister = async () => {
    if (!email.trim()) { setError("Please enter your email address."); return; }
    if (!password) { setError("Please enter a password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters long."); return; }
    if (!confirmPassword) { setError("Please confirm your password."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match. Please try again."); return; }

    setIsPending(true);
    setError(null);
    setSuccess(null);
    try {
      const didSignIn = await signIn("password", {
        flow: "signUp",
        email: email.trim().toLowerCase(),
        password,
      });

      if (didSignIn) {
        setSuccess("Account created successfully! Redirecting...");
        if (redirectTimerRef.current) {
          clearTimeout(redirectTimerRef.current);
        }
        redirectTimerRef.current = setTimeout(() => {
          redirectTimerRef.current = null;
          router.replace("/");
        }, 1000);
        return;
      }

      setError("Unable to create account. Please try again.");
    } catch (authError) {
      console.error("Register failed", authError);
      const errorMessage = authError instanceof Error ? authError.message : "";
      if (errorMessage.includes("already exists") || errorMessage.includes("taken")) {
        setError("An account with this email already exists. Please sign in instead.");
      } else if (errorMessage.includes("invalid") || errorMessage.includes("email")) {
        setError("Please enter a valid email address.");
      } else if (errorMessage.includes("weak") || errorMessage.includes("password")) {
        setError("Password is too weak. Please use at least 6 characters.");
      } else if (errorMessage.includes("network") || errorMessage.includes("connection")) {
        setError("Network error. Please check your internet connection and try again.");
      } else {
        setError("Something went wrong. Please try again later.");
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ScreenWrapper>
      <PageBackButton fallbackHref="/login" />

      <View className={`gap-5 ${isDesktopAuth ? "mx-auto max-w-md pt-12" : "pt-16"}`}>
        <View>
          <Text className="text-sm font-semibold text-primary">ShowTracker</Text>
          <Text className="mt-2 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
            Register
          </Text>
          <Text className="mt-1 text-sm text-text-secondary">
            Create your account
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
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Confirm password"
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
          
          <Button label={isPending ? "Creating account..." : "Create account"} onPress={handleRegister} disabled={isPending} />
        </View>

        <Link href="/login" className="text-sm font-semibold text-primary">
          Already have an account? Sign in
        </Link>
      </View>
    </ScreenWrapper>
  );
}

export default RegisterScreen;
