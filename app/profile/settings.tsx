import type { ReactElement } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OverlayDetailFrame } from "@/components/OverlayDetailFrame";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

type AnimeHomeFranchiseMode = "core_only" | "all_relations";
type AnimeCompletionBehavior =
  | "ask_every_time"
  | "auto_open_next"
  | "auto_pause_others_keep_next";
type HomePausedSectionMode = "auto_paused_only" | "all_paused";
type WatchlistAirtimeMode = "same_day" | "after_airtime";

const TRACKING_REPAIR_MAX_BATCHES = 6;
const ANIME_SETTINGS_UPDATE_TIMEOUT_MS = 12000;

function SettingRow({
  title,
  detail,
  icon,
  tone,
  action,
  actionIcon,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "red" | "blue" | "yellow";
  action: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const color = tone === "red" ? "#ef4444" : tone === "blue" ? "#38bdf8" : "#facc15";
  const bg =
    tone === "red"
      ? "rgba(239,68,68,0.10)"
      : tone === "blue"
        ? "rgba(56,189,248,0.10)"
        : "rgba(250,204,21,0.10)";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border-default px-4 py-4 last:border-b-0"
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.82 : 1 })}
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-black text-text-primary">{title}</Text>
        <Text className="mt-0.5 text-xs text-text-secondary">{detail}</Text>
      </View>
      <View
        className="min-w-28 flex-row items-center justify-center gap-2 rounded-full border px-3 py-2"
        style={{
          borderColor: color,
          backgroundColor: bg,
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <>
            <Text className="text-xs font-black uppercase tracking-wide" style={{ color }}>
              {action}
            </Text>
            <Ionicons name={actionIcon ?? "arrow-forward"} size={14} color={color} />
          </>
        )}
      </View>
    </Pressable>
  );
}

function OptionRow({
  title,
  detail,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`flex-row items-center gap-3 rounded-lg border px-3 py-3 ${
        selected ? "border-primary/70 bg-primary/10" : "border-border-default bg-bg-base"
      }`}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.86 : 1 })}
    >
      <View className="min-w-0 flex-1">
        <Text className={`text-sm font-bold ${selected ? "text-primary" : "text-text-primary"}`}>
          {title}
        </Text>
        <Text className="mt-0.5 text-xs text-text-secondary">{detail}</Text>
      </View>
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={selected ? "#ef4444" : "#71717a"}
      />
    </Pressable>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const isOverlaySettingsRoute = router.canDismiss();
  const animeHomeSettings = useQuery(api.shows.getUserAnimeHomeSettings);
  const rebuildUserStats = useMutation(api.stats.rebuildUserStats);
  const repairMyShowsTrackingBatch = useMutation(api.shows.repairMyShowsTrackingBatch);
  const setUserAnimeHomeSettings = useMutation(api.shows.setUserAnimeHomeSettings);
  const syncTrackedAnimeRelations = useAction(api.shows.syncTrackedAnimeRelations);

  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isRepairingTracking, setIsRepairingTracking] = useState(false);
  const [isSavingAnimeSettings, setIsSavingAnimeSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const animeSettingsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animeHomeFranchiseMode =
    (animeHomeSettings?.relationMode as AnimeHomeFranchiseMode | undefined) ?? "core_only";
  const animeCompletionBehavior =
    (animeHomeSettings?.completionBehavior as AnimeCompletionBehavior | undefined) ?? "ask_every_time";
  const homePausedSectionMode =
    (animeHomeSettings?.pausedSectionMode as HomePausedSectionMode | undefined) ?? "auto_paused_only";
  const watchlistAirtimeMode =
    (animeHomeSettings?.watchlistAirtimeMode as WatchlistAirtimeMode | undefined) ?? "same_day";

  const close = useCallback(() => {
    if (router.canDismiss()) {
      router.back();
      return;
    }
    router.replace("/profile");
  }, [router]);

  const updateAnimeSettings = useCallback(
    async (args: {
      relationMode?: AnimeHomeFranchiseMode;
      completionBehavior?: AnimeCompletionBehavior;
      pausedSectionMode?: HomePausedSectionMode;
      watchlistAirtimeMode?: WatchlistAirtimeMode;
    }) => {
      if (isSavingAnimeSettings) return;
      setIsSavingAnimeSettings(true);
      setError(null);
      setNotice(null);

      let settingsSaved = false;
      try {
        const lastKnownUpdatedAt =
          typeof animeHomeSettings?.updatedAt === "number"
            ? animeHomeSettings.updatedAt
            : undefined;
        if (animeSettingsTimeoutRef.current) clearTimeout(animeSettingsTimeoutRef.current);
        await Promise.race([
          setUserAnimeHomeSettings({
            ...args,
            lastKnownUpdatedAt,
          }),
          new Promise<never>((_, reject) => {
            animeSettingsTimeoutRef.current = setTimeout(
              () => reject(new Error("timeout")),
              ANIME_SETTINGS_UPDATE_TIMEOUT_MS
            );
          }),
        ]);
        settingsSaved = true;
        if (args.relationMode === "all_relations") {
          await syncTrackedAnimeRelations({ force: true });
        }
        setNotice("Settings saved.");
      } catch (settingsError) {
        console.error("Failed to update settings", settingsError);
        setError(
          settingsSaved && args.relationMode === "all_relations"
            ? "Settings saved, but anime relation sync failed. Try again from Settings."
            : "Could not save settings."
        );
      } finally {
        if (animeSettingsTimeoutRef.current) {
          clearTimeout(animeSettingsTimeoutRef.current);
          animeSettingsTimeoutRef.current = null;
        }
        setIsSavingAnimeSettings(false);
      }
    },
    [animeHomeSettings?.updatedAt, isSavingAnimeSettings, setUserAnimeHomeSettings, syncTrackedAnimeRelations]
  );

  const refreshStats = useCallback(async () => {
    if (!isAuthenticated || isRefreshingStats) return;
    setIsRefreshingStats(true);
    setNotice(null);
    setError(null);
    try {
      const result = await rebuildUserStats();
      setNotice(`Stats refreshed for ${result.totalTrackedShows} tracked ${result.totalTrackedShows === 1 ? "show" : "shows"}.`);
    } catch (statsError) {
      console.error("Failed to refresh stats", statsError);
      setError("Could not refresh stats.");
    } finally {
      setIsRefreshingStats(false);
    }
  }, [isAuthenticated, isRefreshingStats, rebuildUserStats]);

  const refreshShows = useCallback(async () => {
    if (!isAuthenticated || isRepairingTracking) return;
    setIsRepairingTracking(true);
    setNotice(null);
    setError(null);
    try {
      let cursor: string | null = null;
      let scanned = 0;
      let patched = 0;
      let batches = 0;
      let isDone = false;
      while (!isDone && batches < TRACKING_REPAIR_MAX_BATCHES) {
        const batch: {
          scanned: number;
          patched: number;
          continueCursor: string | null;
          isDone: boolean;
        } = await repairMyShowsTrackingBatch(cursor ? { continueCursor: cursor } : {});
        scanned += batch.scanned;
        patched += batch.patched;
        cursor = batch.continueCursor;
        isDone = batch.isDone;
        batches += 1;
      }
      setNotice(
        isDone
          ? `Shows refreshed: ${patched}/${scanned} updated.`
          : `Paused after ${batches} batches. Run refresh again to continue.`
      );
    } catch (repairError) {
      console.error("Failed to refresh shows", repairError);
      setError("Could not refresh shows.");
    } finally {
      setIsRepairingTracking(false);
    }
  }, [isAuthenticated, isRepairingTracking, repairMyShowsTrackingBatch]);

  const animeGroups = useMemo(
    () => [
      {
        title: "Home Franchise View",
        options: [
          {
            title: "Core Franchise Titles",
            detail: "Keep Home focused on the main timeline.",
            selected: animeHomeFranchiseMode === "core_only",
            onPress: () => updateAnimeSettings({ relationMode: "core_only" }),
          },
          {
            title: "All Franchise Titles",
            detail: "Include side stories and related entries.",
            selected: animeHomeFranchiseMode === "all_relations",
            onPress: () => updateAnimeSettings({ relationMode: "all_relations" }),
          },
        ],
      },
      {
        title: "On Completion",
        options: [
          {
            title: "Ask Every Time",
            detail: "Prompt before moving to the next season.",
            selected: animeCompletionBehavior === "ask_every_time",
            onPress: () => updateAnimeSettings({ completionBehavior: "ask_every_time" }),
          },
          {
            title: "Open Next Season",
            detail: "Jump directly to the next main season.",
            selected: animeCompletionBehavior === "auto_open_next",
            onPress: () => updateAnimeSettings({ completionBehavior: "auto_open_next" }),
          },
          {
            title: "Pause Other Franchise Titles",
            detail: "Keep the next season active and pause the rest.",
            selected: animeCompletionBehavior === "auto_pause_others_keep_next",
            onPress: () => updateAnimeSettings({ completionBehavior: "auto_pause_others_keep_next" }),
          },
        ],
      },
      {
        title: "Home Watchlist",
        options: [
          {
            title: "Show Same-Day Episodes",
            detail: "Show episodes on Home once their calendar day starts.",
            selected: watchlistAirtimeMode === "same_day",
            onPress: () => updateAnimeSettings({ watchlistAirtimeMode: "same_day" }),
          },
          {
            title: "Wait Until Airtime",
            detail: "Hide same-day episodes until the scheduled time passes.",
            selected: watchlistAirtimeMode === "after_airtime",
            onPress: () => updateAnimeSettings({ watchlistAirtimeMode: "after_airtime" }),
          },
        ],
      },
      {
        title: "Home Paused Shelf",
        options: [
          {
            title: "Auto-paused Only",
            detail: "Show just titles snoozed by inactivity.",
            selected: homePausedSectionMode === "auto_paused_only",
            onPress: () => updateAnimeSettings({ pausedSectionMode: "auto_paused_only" }),
          },
          {
            title: "All Paused Shows",
            detail: "Include manually paused and auto-paused titles.",
            selected: homePausedSectionMode === "all_paused",
            onPress: () => updateAnimeSettings({ pausedSectionMode: "all_paused" }),
          },
        ],
      },
    ],
    [
      animeCompletionBehavior,
      animeHomeFranchiseMode,
      homePausedSectionMode,
      updateAnimeSettings,
      watchlistAirtimeMode,
    ]
  );

  const wrapSettings = (content: ReactElement) => {
    if (!isOverlaySettingsRoute) {
      return (
        <ScreenWrapper contentClassName="px-0 py-0" edges={["top"]}>
          {content}
        </ScreenWrapper>
      );
    }

    return (
      <OverlayDetailFrame onClose={close} closeAccessibilityLabel="Close settings">
        {content}
      </OverlayDetailFrame>
    );
  };

  return wrapSettings(
      <View className="flex-1 bg-bg-base">
        <View className="border-b border-border-default bg-bg-base px-5 py-5">
          <View className="flex-row items-start gap-4">
            {isDesktop || !isOverlaySettingsRoute ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                onPress={close}
                className="mt-0.5 h-10 w-10 items-center justify-center rounded-full border border-border-default bg-bg-surface"
              >
                <Ionicons name="close" size={18} color="#e4e4e7" />
              </Pressable>
            ) : null}
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-black uppercase tracking-wide text-primary">Settings</Text>
              <Text className="mt-1 text-2xl font-black text-text-primary">Profile Controls</Text>
              <Text className="mt-1 text-sm text-text-secondary">
                Data maintenance and anime behavior without cluttering your profile.
              </Text>
            </View>
          </View>
          {notice ? <Text className="mt-3 text-xs text-success">{notice}</Text> : null}
          {error ? <Text className="mt-3 text-xs text-primary">{error}</Text> : null}
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
          <View className="gap-5">
            <View className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.16)", "rgba(56,189,248,0.08)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 3 }}
              />
              <View className="border-b border-border-default px-4 py-3">
                <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                  Maintenance
                </Text>
              </View>
              <SettingRow
                title="Refresh stats"
                detail="Cache watch time, streaks, rewatches, and totals."
                icon="bar-chart-outline"
                tone="red"
                action="Refresh"
                actionIcon="refresh"
                busy={isRefreshingStats}
                disabled={!isAuthenticated}
                onPress={refreshStats}
              />
              <SettingRow
                title="Refresh my shows"
                detail="Fix stale watched counts, statuses, and Home projections."
                icon="refresh-outline"
                tone="blue"
                action="Refresh"
                actionIcon="refresh"
                busy={isRepairingTracking}
                disabled={!isAuthenticated}
                onPress={refreshShows}
              />
              <Link href="/import" asChild>
                <SettingRow
                  title="Import from TV Time"
                  detail="Paste or upload your export JSON."
                  icon="cloud-upload-outline"
                  tone="yellow"
                  action="Open"
                />
              </Link>
            </View>

            <View className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.14)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 3 }}
              />
              <View className="border-b border-border-default px-4 py-3">
                <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                  Anime Defaults
                </Text>
              </View>
              <View className="gap-4 p-4">
                {animeGroups.map((group) => (
                  <View key={group.title} className="gap-2">
                    <Text className="text-xs font-black uppercase tracking-wide text-text-muted">
                      {group.title}
                    </Text>
                    {group.options.map((option) => (
                      <OptionRow
                        key={option.title}
                        title={option.title}
                        detail={option.detail}
                        selected={option.selected}
                        disabled={isSavingAnimeSettings}
                        onPress={option.onPress}
                      />
                    ))}
                  </View>
                ))}
                {isSavingAnimeSettings ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#a1a1aa" />
                    <Text className="text-xs text-text-secondary">Saving settings...</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
  );
}
