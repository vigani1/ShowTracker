import { Link, Redirect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function NavLink({
  href,
  label,
  primary = false,
  fullWidth = false,
}: {
  href: "/login" | "/register";
  label: string;
  primary?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        className={`rounded-lg border-2 px-4 py-2 ${fullWidth ? "flex-1 items-center" : ""} ${
          primary ? "border-primary bg-primary" : "border-border-bright bg-bg-elevated"
        }`}
      >
        <Text
          className={`text-xs font-black uppercase tracking-wide ${
            primary ? "text-white" : "text-text-primary"
          }`}
        >
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

function FeatureCard({
  index,
  title,
  copy,
}: {
  index: string;
  title: string;
  copy: string;
}) {
  return (
    <View className="rounded-2xl border-2 border-border-bright bg-bg-base p-4">
      <View className="mb-2 self-start rounded-md border-2 border-primary bg-primary/20 px-2 py-1">
        <Text className="text-[11px] font-black uppercase tracking-wide text-primary">{index}</Text>
      </View>
      <Text
        className="text-xl text-text-primary"
        style={{ fontFamily: "Courier New", fontWeight: "900" }}
      >
        {title}
      </Text>
      <Text className="mt-2 text-sm leading-6 text-text-secondary">{copy}</Text>
    </View>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 overflow-hidden rounded-xl border-2 border-border-bright bg-bg-base px-3 py-3">
      <View className="mb-2 h-1 w-10 rounded-full bg-primary" />
      <Text className="text-3xl font-black text-text-primary">{value}</Text>
      <Text className="mt-1 text-[11px] font-black uppercase tracking-wide text-text-secondary">
        {label}
      </Text>
    </View>
  );
}

function Step({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <View className="rounded-2xl border-2 border-border-bright bg-bg-base p-4">
      <Text className="text-xs font-black uppercase tracking-wide text-primary">Step {number}</Text>
      <Text
        className="mt-1 text-2xl text-text-primary"
        style={{ fontFamily: "Courier New", fontWeight: "900" }}
      >
        {title}
      </Text>
      <Text className="mt-2 text-sm leading-6 text-text-secondary">{detail}</Text>
    </View>
  );
}

export default function LandingPage() {
  const { width } = useWindowDimensions();

  if (Platform.OS !== "web") {
    return <Redirect href="/login" />;
  }
  const isDesktop = width >= 1100;

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top"]}>
      <LinearGradient
        colors={["#09090b", "#111827", "#1f2937", "#09090b"]}
        locations={[0, 0.35, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View className="absolute -left-20 -top-10 h-56 w-56 rounded-full bg-primary/15" />
      <View className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-accent/10" />

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 pb-12 pt-4">
          <View
            className={`mb-4 rounded-2xl border-2 border-border-bright bg-bg-surface px-4 py-3 ${
              isDesktop ? "flex-row items-center justify-between" : "gap-3"
            }`}
          >
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-md border-2 border-primary bg-primary/20">
                <Text className="text-sm font-black text-primary">ST</Text>
              </View>
              <Text
                className="text-xl text-text-primary"
                style={{ fontFamily: "Courier New", fontWeight: "900" }}
              >
                ShowTracker
              </Text>
            </View>
            <View className={`flex-row gap-2 ${isDesktop ? "" : "w-full"}`}>
              <NavLink href="/login" label="Sign In" fullWidth={!isDesktop} />
              <NavLink
                href="/register"
                label="Create Account"
                primary
                fullWidth={!isDesktop}
              />
            </View>
          </View>

          <View className="overflow-hidden rounded-[28px] border-2 border-border-bright bg-bg-surface">
            <LinearGradient
              colors={["rgba(239,68,68,0.14)", "rgba(249,115,22,0.1)", "rgba(56,189,248,0.08)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />

            <View className={`gap-0 ${isDesktop ? "flex-row" : ""}`}>
              <View
                className={`${isDesktop ? "w-[66%]" : "w-full"} border-b-2 border-border-bright px-5 py-6`}
              >
                <View
                  className="self-start rounded-md border-2 border-primary bg-primary px-3 py-1"
                  style={{ transform: [{ rotate: "-2deg" }] }}
                >
                  <Text className="text-xs font-black uppercase tracking-wide text-white">
                    Open source and fully free
                  </Text>
                </View>

                <Text
                  className="mt-4 text-[50px] leading-[54px] text-text-primary"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  TRACK WHAT YOU WATCH.
                </Text>
                <Text
                  className="text-[50px] leading-[54px] text-primary-glow"
                  style={{ fontFamily: "Courier New", fontWeight: "900" }}
                >
                  KEEP IT ORGANIZED.
                </Text>

                <Text className="mt-4 max-w-2xl text-base leading-7 text-text-secondary">
                  ShowTracker is a personal project for tracking shows, anime, and movies in one place.
                  It is fully free, open source, and built for day-to-day use.
                </Text>

                <View className="mt-5 flex-row flex-wrap gap-2">
                  <Link href="/register" asChild>
                    <Pressable className="border-2 border-primary bg-primary px-6 py-3">
                      <Text className="text-sm font-black uppercase tracking-wide text-white">
                        Create Account
                      </Text>
                    </Pressable>
                  </Link>
                  <Link href="/login" asChild>
                    <Pressable className="border-2 border-border-bright bg-bg-elevated px-6 py-3">
                      <Text className="text-sm font-black uppercase tracking-wide text-text-primary">
                        Sign In
                      </Text>
                    </Pressable>
                  </Link>
                </View>

                <View className="mt-6 flex-row gap-2">
                  <StatBlock value="3" label="Media Types" />
                  <StatBlock value="1" label="Unified Queue" />
                  <StatBlock value="100%" label="Free" />
                </View>
              </View>

              <View
                className={`${isDesktop ? "w-[34%] border-l-2" : "w-full border-t-2"} border-border-bright`}
              >
                <View className="border-b-2 border-border-bright bg-bg-elevated px-5 py-5">
                  <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                    Tonight
                  </Text>
                  <Text className="mt-2 text-4xl font-black text-text-primary">+12</Text>
                  <Text className="text-sm font-semibold text-text-secondary">unwatched episodes</Text>
                </View>

                <View className="border-b-2 border-border-bright bg-bg-base px-5 py-5">
                  <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                    Momentum
                  </Text>
                  <Text className="mt-2 text-4xl font-black text-text-primary">7</Text>
                  <Text className="text-sm font-semibold text-text-secondary">days in a row</Text>
                </View>

                <LinearGradient
                  colors={["#ef4444", "#7f1d1d"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ paddingHorizontal: 20, paddingVertical: 20 }}
                >
                  <Text className="text-xs font-black uppercase tracking-wide text-white">
                    Project note
                  </Text>
                  <Text className="mt-2 text-lg font-black text-white">
                    Personal, open source, and intentionally fast.
                  </Text>
                </LinearGradient>
              </View>
            </View>
          </View>

          <View className="mt-6 rounded-2xl border-2 border-border-bright bg-bg-surface p-4">
            <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
              Why ShowTracker
            </Text>
            <Text
              className="mt-1 text-3xl text-text-primary"
              style={{ fontFamily: "Courier New", fontWeight: "900" }}
            >
              Built to track shows, anime, and movies cleanly.
            </Text>

            <View className="mt-4 gap-3">
              <FeatureCard
                index="01"
                title="Real Queue, No Chaos"
                copy="Your watchlist updates with unwatched episode counts, so you always know what is next."
              />
              <FeatureCard
                index="02"
                title="Progress That Feels Instant"
                copy="Mark episodes with one tap and everything syncs in real time across devices."
              />
              <FeatureCard
                index="03"
                title="Schedules You Can Trust"
                copy="Upcoming releases from your tracked titles, grouped by date so your week is planned."
              />
            </View>
          </View>

          <View className="mt-6 rounded-2xl border-2 border-border-bright bg-bg-elevated/60 p-4">
            <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
              How it works
            </Text>
            <Text
              className="mt-1 text-3xl text-text-primary"
              style={{ fontFamily: "Courier New", fontWeight: "900" }}
            >
              Three simple steps.
            </Text>

            <View className={`mt-4 gap-3 ${isDesktop ? "flex-row" : ""}`}>
              <View className="flex-1">
                <Step number="1" title="Track" detail="Find your show and add it to your library." />
              </View>
              <View className="flex-1">
                <Step
                  number="2"
                  title="Watch"
                  detail="Mark episodes and see your queue update automatically."
                />
              </View>
              <View className="flex-1">
                <Step number="3" title="Review" detail="Check stats and keep your streaks consistent." />
              </View>
            </View>
          </View>

          <View className="mt-6 overflow-hidden rounded-2xl border-2 border-border-bright">
            <LinearGradient
              colors={["#111111", "#7f1d1d", "#1e293b"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20 }}
            >
              <Text className="text-xs font-black uppercase tracking-wide text-zinc-300">
                Project access
              </Text>
              <Text
                className="mt-2 text-4xl leading-[44px] text-white"
                style={{ fontFamily: "Courier New", fontWeight: "900" }}
              >
                Use ShowTracker for free.
              </Text>
              <Text className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                No ads and no subscriptions. Create an account to sync your data, or sign in if you
                already have one.
              </Text>

              <View className="mt-4 flex-row flex-wrap gap-2">
                <Link href="/register" asChild>
                  <Pressable className="rounded-lg border-2 border-white bg-white px-5 py-3">
                    <Text className="text-sm font-black uppercase tracking-wide text-black">
                      Create Account
                    </Text>
                  </Pressable>
                </Link>
                <Link href="/login" asChild>
                  <Pressable className="rounded-lg border-2 border-white/70 bg-black/20 px-5 py-3">
                    <Text className="text-sm font-black uppercase tracking-wide text-white">
                      Sign In
                    </Text>
                  </Pressable>
                </Link>
              </View>
            </LinearGradient>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
