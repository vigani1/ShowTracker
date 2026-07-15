import { Link, type Href, useRouter } from "expo-router";
import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BrandLoader } from "@/components/BrandLoader";
import { LinearGradient } from "expo-linear-gradient";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/convex/_generated/api";

const gradientBase = "absolute inset-0";
const gradientDivider = "h-1 w-full";

const fieldBase =
  "flex-row items-center gap-2 rounded-lg border-2 border-border-default bg-bg-base/70 px-3 py-2.5";

function FeatureRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-7 w-7 items-center justify-center rounded-lg bg-bg-base/60">
        <Ionicons name={icon} size={14} color="#f97316" />
      </View>
      <Text className="text-sm text-text-secondary">{text}</Text>
    </View>
  );
}

export function LoginScreen() {
  const { signIn } = useAuthActions();
  const checkPasswordAccount = useMutation(api.auth.checkPasswordAccount);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isDesktopAuth = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;

  const handleAuthResult = (
    result: Awaited<ReturnType<typeof signIn>>,
    messages: { fallback: string }
  ) => {
    const { redirect, signingIn } = result;

    if (redirect instanceof URL || typeof redirect === "string") {
      const redirectTarget = redirect.toString();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = redirectTarget;
      } else {
        router.replace(redirectTarget as Href);
      }
      return;
    }

    if (signingIn === true) {
      setSuccess("Signed in. Opening your dashboard...");
      return;
    }

    setError(messages.fallback);
  };

  const handleSignIn = async () => {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    try {
      // Account check now returns generic response to prevent enumeration
      // Proceed with sign-in attempt directly
      await checkPasswordAccount({ email });

      const result = await signIn("password", {
        flow: "signIn",
        email: email.trim().toLowerCase(),
        password,
      });

      handleAuthResult(result, {
        fallback: "Invalid email or password. Please try again.",
      });
    } catch (authError) {
      const errorMessage = authError instanceof Error ? authError.message : "";

      if (errorMessage.includes("Invalid") || errorMessage.includes("credential")) {
        setError("Invalid email or password.");
      } else if (errorMessage.includes("network") || errorMessage.includes("connection")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError("Something went wrong. Please try again.");
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
      handleAuthResult(result, {
        fallback: "Failed to continue as guest. Please try again.",
      });
    } catch {
      setError("Failed to continue as guest.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top", "bottom"]}>
      <View className="relative flex-1 overflow-hidden bg-bg-base">
        <LinearGradient
          colors={["#09090b", "#120d0d", "#09090b"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className={gradientBase}
        />
        <View className="absolute -left-20 -top-12 h-56 w-56 rounded-full bg-primary/20" />
        <View className="absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-accent/10" />

        <View className={`flex-1 ${isDesktopAuth ? "flex-row" : ""}`}>
          {isDesktopAuth ? (
            <View className="w-[44%] justify-center border-r border-border-default px-8 py-9">
              <View>
                <View className="mb-5 flex-row items-center gap-2">
                  <View className="h-8 w-8 items-center justify-center rounded-xl bg-primary/20">
                    <Text className="text-sm font-black text-primary">ST</Text>
                  </View>
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    ShowTracker
                  </Text>
                </View>

                <Text
                  className="text-5xl text-text-primary"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  Track everything.
                </Text>
                <Text
                  className="mt-2 text-5xl text-primary"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  Miss nothing.
                </Text>

                <Text className="mt-5 max-w-md text-sm leading-relaxed text-text-secondary">
                  Your watchlist, progress, upcoming episodes, and stats in one fast,
                  focused workspace.
                </Text>

                <View className="mt-7 gap-3">
                  <FeatureRow icon="flash-outline" text="Instant progress sync across web and mobile" />
                  <FeatureRow icon="calendar-outline" text="Upcoming episodes grouped by day" />
                  <FeatureRow icon="stats-chart-outline" text="Detailed watch streaks and time insights" />
                </View>
              </View>
            </View>
          ) : null}

          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="flex-grow"
          >
            <View
              className={`flex-1 ${
                isDesktopAuth ? "items-center justify-center px-8 py-8" : "px-0 pb-0 pt-0"
              }`}
            >
              {!isDesktopAuth ? (
                <View className="mb-4 rounded-xl border-2 border-border-default bg-bg-surface/80 p-4">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Welcome back
                  </Text>
                  <Text className="mt-1 text-lg font-black text-text-primary">
                    Continue your watch journey
                  </Text>
                </View>
              ) : null}

              <View
                className={`w-full overflow-hidden bg-bg-surface/95 ${
                  isDesktopAuth
                    ? "max-w-md rounded-xl border-2 border-border-default"
                    : "rounded-none"
                }`}
              >
                <LinearGradient
                  colors={["rgba(239,68,68,0.2)", "rgba(56,189,248,0.06)", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  className={gradientDivider}
                />

                <View className="px-5 pb-5 pt-4">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Sign in
                  </Text>
                  <Text
                    className="mt-1 text-3xl text-text-primary"
                    style={{ fontFamily: "Courier New", fontWeight: "900" }}
                  >
                    Welcome back
                  </Text>
                  <Text className="mt-1 text-sm text-text-secondary">
                    Access your profile, library, and schedule.
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
                        onSubmitEditing={() => {
                          void handleSignIn();
                        }}
                        secureTextEntry={!showPassword}
                        placeholder="Password"
                        placeholderTextColor="#52525b"
                        className="flex-1 text-base text-text-primary"
                        editable={!isPending}
                        returnKeyType="go"
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
                    onPress={handleSignIn}
                    disabled={isPending}
                    className="mt-4 items-center justify-center border-2 border-primary bg-primary py-3 active:opacity-90"
                  >
                    {isPending ? (
                      <BrandLoader compact onPrimary />
                    ) : (
                      <Text className="text-sm font-black uppercase tracking-wide text-white">Sign In</Text>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={handleAnonymousSignIn}
                    disabled={isPending}
                    className="mt-2 flex-row items-center justify-center gap-2 rounded-lg border-2 border-border-bright bg-bg-elevated/70 py-3 active:opacity-90"
                  >
                    <Ionicons name="person-outline" size={15} color="#a1a1aa" />
                    <Text className="text-sm font-semibold text-text-primary">Continue as guest</Text>
                  </Pressable>

                  <View className="mt-4 flex-row items-center justify-center gap-1">
                    <Text className="text-sm text-text-secondary">Need an account?</Text>
                    <Link href="/register" asChild>
                      <Pressable>
                        <Text className="text-sm font-bold text-primary">Create one</Text>
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

export default LoginScreen;
