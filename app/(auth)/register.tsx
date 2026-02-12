import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuthActions } from "@convex-dev/auth/react";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import { SafeAreaView } from "react-native-safe-area-context";

const fieldBase =
  "flex-row items-center gap-2 rounded-2xl border border-border-default bg-bg-base/70 px-3 py-2.5";

function BenefitRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-7 w-7 items-center justify-center rounded-lg bg-bg-base/60">
        <Ionicons name={icon} size={14} color="#ef4444" />
      </View>
      <Text className="text-sm text-text-secondary">{text}</Text>
    </View>
  );
}

export function RegisterScreen() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!password) {
      setError("Please enter a password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (!confirmPassword) {
      setError("Please confirm your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

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
        setSuccess("Account ready. Taking you to your dashboard...");
        if (redirectTimerRef.current) {
          clearTimeout(redirectTimerRef.current);
        }
        redirectTimerRef.current = setTimeout(() => {
          redirectTimerRef.current = null;
          router.replace("/home");
        }, 900);
        return;
      }

      setError("Unable to create account. Please try again.");
    } catch (authError) {
      console.error("Register failed", authError);
      const errorMessage = authError instanceof Error ? authError.message : "";

      if (errorMessage.includes("already exists") || errorMessage.includes("taken")) {
        setError("An account with this email already exists.");
      } else if (errorMessage.includes("invalid") || errorMessage.includes("email")) {
        setError("Please enter a valid email address.");
      } else if (errorMessage.includes("weak") || errorMessage.includes("password")) {
        setError("Password is too weak. Use at least 6 characters.");
      } else if (errorMessage.includes("network") || errorMessage.includes("connection")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top", "bottom"]}>
      <View className="relative flex-1 overflow-hidden bg-bg-base">
        <LinearGradient
          colors={["#09090b", "#100c0a", "#09090b"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <View className="absolute -right-20 -top-12 h-56 w-56 rounded-full bg-primary/20" />
        <View className="absolute -bottom-28 left-0 h-72 w-72 rounded-full bg-accent/10" />

        <View className={`flex-1 ${isDesktopAuth ? "flex-row" : ""}`}>
          {isDesktopAuth ? (
            <View className="w-[44%] justify-between border-r border-border-default px-8 py-9">
              <View>
                <View className="mb-5 flex-row items-center gap-2">
                  <View className="h-8 w-8 items-center justify-center rounded-xl bg-primary/20">
                    <Text className="text-sm font-black text-primary">ST</Text>
                  </View>
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    New account
                  </Text>
                </View>

                <Text className="text-5xl font-black tracking-tight text-text-primary">
                  Build your
                </Text>
                <Text className="mt-2 text-5xl font-black tracking-tight text-primary">
                  watch command center
                </Text>

                <Text className="mt-5 max-w-md text-sm leading-relaxed text-text-secondary">
                  Keep every show, anime, and movie organized with clean progress
                  tracking and episode reminders.
                </Text>

                <View className="mt-7 gap-3">
                  <BenefitRow icon="albums-outline" text="Personal library with custom lists" />
                  <BenefitRow icon="eye-outline" text="Episode-level watch tracking" />
                  <BenefitRow icon="bar-chart-outline" text="Stats for streaks, time, and re-watches" />
                </View>
              </View>

              <View className="rounded-2xl border border-border-default bg-bg-surface/85 p-4">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Why create an account
                </Text>
                <Text className="mt-2 text-xl font-black text-text-primary">Sync progress everywhere</Text>
                <Text className="mt-1 text-sm text-text-secondary">
                  Start on web, continue on mobile, never lose your place.
                </Text>
              </View>
            </View>
          ) : null}

          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <View
              className={`flex-1 ${
                isDesktopAuth ? "items-center justify-center px-8 py-8" : "px-0 pb-0 pt-0"
              }`}
            >
              {!isDesktopAuth ? (
                <View className="mb-4 rounded-2xl border border-border-default bg-bg-surface/80 p-4">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Join ShowTracker
                  </Text>
                  <Text className="mt-1 text-lg font-black text-text-primary">
                    Start tracking in under a minute
                  </Text>
                </View>
              ) : null}

              <View
                className={`w-full overflow-hidden bg-bg-surface/95 ${
                  isDesktopAuth
                    ? "max-w-md rounded-3xl border border-border-default"
                    : "rounded-none"
                }`}
              >
                <LinearGradient
                  colors={["rgba(239,68,68,0.2)", "rgba(249,115,22,0.12)", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ height: 4, width: "100%" }}
                />

                <View className="px-5 pb-5 pt-4">
                  <Link href="/login" asChild>
                    <Pressable className="mb-3 flex-row items-center gap-1 self-start rounded-lg bg-bg-elevated/70 px-2 py-1">
                      <Ionicons name="chevron-back" size={14} color="#a1a1aa" />
                      <Text className="text-xs font-semibold text-text-secondary">Back to sign in</Text>
                    </Pressable>
                  </Link>

                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Register
                  </Text>
                  <Text className="mt-1 text-3xl font-black tracking-tight text-text-primary">
                    Create your account
                  </Text>
                  <Text className="mt-1 text-sm text-text-secondary">
                    Your watch history starts here.
                  </Text>

                  <View className="mt-5 gap-3">
                    <View className={fieldBase}>
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-bg-elevated/70">
                        <Ionicons name="mail-outline" size={16} color="#a1a1aa" />
                      </View>
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        placeholder="Email"
                        placeholderTextColor="#52525b"
                        className="flex-1 text-base text-text-primary"
                        editable={!isPending}
                      />
                    </View>

                    <View className={fieldBase}>
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-bg-elevated/70">
                        <Ionicons name="lock-closed-outline" size={16} color="#a1a1aa" />
                      </View>
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        placeholder="Password"
                        placeholderTextColor="#52525b"
                        className="flex-1 text-base text-text-primary"
                        editable={!isPending}
                      />
                      <Pressable
                        onPress={() => setShowPassword((prev) => !prev)}
                        className="h-8 w-8 items-center justify-center rounded-lg bg-bg-elevated/60"
                      >
                        <Ionicons
                          name={showPassword ? "eye-off-outline" : "eye-outline"}
                          size={15}
                          color="#a1a1aa"
                        />
                      </Pressable>
                    </View>

                    <View className={fieldBase}>
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-bg-elevated/70">
                        <Ionicons name="shield-checkmark-outline" size={16} color="#a1a1aa" />
                      </View>
                      <TextInput
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry={!showConfirmPassword}
                        placeholder="Confirm password"
                        placeholderTextColor="#52525b"
                        className="flex-1 text-base text-text-primary"
                        editable={!isPending}
                      />
                      <Pressable
                        onPress={() => setShowConfirmPassword((prev) => !prev)}
                        className="h-8 w-8 items-center justify-center rounded-lg bg-bg-elevated/60"
                      >
                        <Ionicons
                          name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                          size={15}
                          color="#a1a1aa"
                        />
                      </Pressable>
                    </View>
                  </View>

                  {error ? (
                    <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5">
                      <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                      <Text className="flex-1 text-sm text-primary">{error}</Text>
                    </View>
                  ) : null}

                  {success ? (
                    <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5">
                      <Ionicons name="checkmark-circle-outline" size={16} color="#34d399" />
                      <Text className="flex-1 text-sm text-success">{success}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={handleRegister}
                    disabled={isPending}
                    className="mt-4 overflow-hidden rounded-xl"
                    style={({ pressed }) => (pressed && !isPending ? { opacity: 0.9 } : undefined)}
                  >
                    <LinearGradient
                      colors={["#ef4444", "#f97316"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={{ alignItems: "center", justifyContent: "center", paddingVertical: 12 }}
                    >
                      {isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text className="text-sm font-bold uppercase tracking-wide text-white">Create Account</Text>
                      )}
                    </LinearGradient>
                  </Pressable>

                  <View className="mt-4 flex-row items-center justify-center gap-1">
                    <Text className="text-sm text-text-secondary">Already have an account?</Text>
                    <Link href="/login" asChild>
                      <Pressable>
                        <Text className="text-sm font-bold text-primary">Sign in</Text>
                      </Pressable>
                    </Link>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default RegisterScreen;
