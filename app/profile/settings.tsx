import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { BrandLoader } from "@/components/BrandLoader";

type AnimeHomeFranchiseMode = "core_only" | "all_relations";
type AnimeCompletionBehavior =
  | "ask_every_time"
  | "auto_open_next"
  | "auto_pause_others_keep_next";
type HomePausedSectionMode = "auto_paused_only" | "all_paused";
type WatchlistAirtimeMode = "same_day" | "after_airtime";

const TRACKING_REPAIR_MAX_BATCHES = 6;
const STATS_REBUILD_TRACKING_MAX_BATCHES = 25;
const ANIME_SETTINGS_UPDATE_TIMEOUT_MS = 12000;

function MaintenanceTile({
  title,
  caption,
  icon,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      className="min-h-28 flex-1 justify-between rounded-lg border border-border-default bg-bg-surface p-3"
      style={({ pressed }) => ({
        flexBasis: "30%",
        opacity: disabled ? 0.5 : pressed ? 0.82 : 1,
      })}
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="h-9 w-9 items-center justify-center rounded-md bg-bg-elevated">
          {busy ? (
            <BrandLoader compact />
          ) : (
            <Ionicons name={icon} size={17} color="#d4d4d8" />
          )}
        </View>
        <Ionicons name="arrow-up-outline" size={14} color="#71717a" style={{ transform: [{ rotate: "45deg" }] }} />
      </View>
      <View>
        <Text className="text-sm font-black text-text-primary" numberOfLines={2}>{title}</Text>
        <Text className="mt-0.5 text-[11px] text-text-muted" numberOfLines={1}>{caption}</Text>
      </View>
    </Pressable>
  );
}

function PreferenceControl({
  title,
  icon,
  options,
  disabled,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  options: {
    title: string;
    shortLabel: string;
    detail: string;
    selected: boolean;
    onPress: () => void;
  }[];
  disabled?: boolean;
}) {
  const selectedOption = options.find((option) => option.selected) ?? options[0];

  return (
    <View className="rounded-lg border border-border-default bg-bg-surface p-3">
      <View className="mb-3 flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color="#a1a1aa" />
        <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">{title}</Text>
      </View>
      <View className="flex-row overflow-hidden rounded-md border border-border-default bg-bg-base">
        {options.map((option, index) => (
          <Pressable
            key={option.title}
            accessibilityRole="button"
            accessibilityState={{ selected: option.selected }}
            disabled={disabled}
            onPress={option.onPress}
            className={`${option.selected ? "bg-primary" : "bg-bg-base"} flex-1 items-center justify-center px-2 py-2.5`}
            style={({ pressed }) => ({
              borderRightWidth: index === options.length - 1 ? 0 : 1,
              borderRightColor: "#27272a",
              opacity: disabled ? 0.45 : pressed ? 0.84 : 1,
            })}
          >
            <Text
              className={`${option.selected ? "text-white" : "text-text-secondary"} text-center text-[11px] font-black`}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {option.shortLabel}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="mt-3 flex-row items-start gap-2">
        <View className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
        <Text className="min-w-0 flex-1 text-xs leading-4 text-text-muted">
          <Text className="font-bold text-text-secondary">{selectedOption.title}. </Text>
          {selectedOption.detail}
        </Text>
      </View>
    </View>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
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
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [draftRelationMode, setDraftRelationMode] = useState<AnimeHomeFranchiseMode>("core_only");
  const [draftCompletionBehavior, setDraftCompletionBehavior] = useState<AnimeCompletionBehavior>("ask_every_time");
  const [draftPausedSectionMode, setDraftPausedSectionMode] = useState<HomePausedSectionMode>("auto_paused_only");
  const [draftAirtimeMode, setDraftAirtimeMode] = useState<WatchlistAirtimeMode>("same_day");
  const animeSettingsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animeHomeFranchiseMode =
    (animeHomeSettings?.relationMode as AnimeHomeFranchiseMode | undefined) ?? "core_only";
  const animeCompletionBehavior =
    (animeHomeSettings?.completionBehavior as AnimeCompletionBehavior | undefined) ?? "ask_every_time";
  const homePausedSectionMode =
    (animeHomeSettings?.pausedSectionMode as HomePausedSectionMode | undefined) ?? "auto_paused_only";
  const watchlistAirtimeMode =
    (animeHomeSettings?.watchlistAirtimeMode as WatchlistAirtimeMode | undefined) ?? "same_day";

  useEffect(() => {
    if (hasDraftChanges) return;
    setDraftRelationMode(animeHomeFranchiseMode);
    setDraftCompletionBehavior(animeCompletionBehavior);
    setDraftPausedSectionMode(homePausedSectionMode);
    setDraftAirtimeMode(watchlistAirtimeMode);
  }, [
    animeCompletionBehavior,
    animeHomeFranchiseMode,
    hasDraftChanges,
    homePausedSectionMode,
    watchlistAirtimeMode,
  ]);

  const close = useCallback(() => {
    if (router.canDismiss()) {
      router.back();
      return;
    }
    router.replace("/profile");
  }, [router]);

  const saveAnimeSettings = useCallback(
    async () => {
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
            relationMode: draftRelationMode,
            completionBehavior: draftCompletionBehavior,
            pausedSectionMode: draftPausedSectionMode,
            watchlistAirtimeMode: draftAirtimeMode,
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
        if (draftRelationMode === "all_relations" && animeHomeFranchiseMode !== "all_relations") {
          await syncTrackedAnimeRelations({ force: true });
        }
        setHasDraftChanges(false);
        setNotice("Settings saved.");
      } catch (settingsError) {
        console.error("Failed to update settings", settingsError);
        setError(
          settingsSaved && draftRelationMode === "all_relations"
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
    [
      animeHomeFranchiseMode,
      animeHomeSettings?.updatedAt,
      draftAirtimeMode,
      draftCompletionBehavior,
      draftPausedSectionMode,
      draftRelationMode,
      isSavingAnimeSettings,
      setUserAnimeHomeSettings,
      syncTrackedAnimeRelations,
    ]
  );

  const cancelChanges = useCallback(() => {
    setDraftRelationMode(animeHomeFranchiseMode);
    setDraftCompletionBehavior(animeCompletionBehavior);
    setDraftPausedSectionMode(homePausedSectionMode);
    setDraftAirtimeMode(watchlistAirtimeMode);
    setHasDraftChanges(false);
    setError(null);
    setNotice(null);
  }, [animeCompletionBehavior, animeHomeFranchiseMode, homePausedSectionMode, watchlistAirtimeMode]);

  const refreshStats = useCallback(async () => {
    if (!isAuthenticated || isRefreshingStats) return;
    setIsRefreshingStats(true);
    setNotice(null);
    setError(null);
    try {
      let cursor: string | null = null;
      let batches = 0;
      let isDone = false;
      while (!isDone && batches < STATS_REBUILD_TRACKING_MAX_BATCHES) {
        const batch: {
          continueCursor: string | null;
          isDone: boolean;
        } = await repairMyShowsTrackingBatch(cursor ? { continueCursor: cursor } : {});
        cursor = batch.continueCursor;
        isDone = batch.isDone;
        batches += 1;
      }
      if (!isDone) {
        throw new Error("Tracking history repair did not finish before the stats rebuild limit.");
      }
      const result = await rebuildUserStats();
      setNotice(`Stats refreshed for ${result.totalTrackedShows} tracked ${result.totalTrackedShows === 1 ? "show" : "shows"}.`);
    } catch (statsError) {
      console.error("Failed to refresh stats", statsError);
      setError("Could not refresh stats.");
    } finally {
      setIsRefreshingStats(false);
    }
  }, [isAuthenticated, isRefreshingStats, rebuildUserStats, repairMyShowsTrackingBatch]);

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
        title: "Franchise Scope",
        icon: "git-branch-outline" as const,
        options: [
          {
            title: "Core Franchise Titles",
            shortLabel: "Core only",
            detail: "Keep Home focused on the main timeline.",
            selected: draftRelationMode === "core_only",
            onPress: () => { setDraftRelationMode("core_only"); setHasDraftChanges(true); },
          },
          {
            title: "All Franchise Titles",
            shortLabel: "All titles",
            detail: "Include side stories and related entries.",
            selected: draftRelationMode === "all_relations",
            onPress: () => { setDraftRelationMode("all_relations"); setHasDraftChanges(true); },
          },
        ],
      },
      {
        title: "After Finishing",
        icon: "play-skip-forward-outline" as const,
        options: [
          {
            title: "Ask Every Time",
            shortLabel: "Ask",
            detail: "Prompt before moving to the next season.",
            selected: draftCompletionBehavior === "ask_every_time",
            onPress: () => { setDraftCompletionBehavior("ask_every_time"); setHasDraftChanges(true); },
          },
          {
            title: "Open Next Season",
            shortLabel: "Open next",
            detail: "Jump directly to the next main season.",
            selected: draftCompletionBehavior === "auto_open_next",
            onPress: () => { setDraftCompletionBehavior("auto_open_next"); setHasDraftChanges(true); },
          },
          {
            title: "Pause Other Franchise Titles",
            shortLabel: "Pause others",
            detail: "Keep the next season active and pause the rest.",
            selected: draftCompletionBehavior === "auto_pause_others_keep_next",
            onPress: () => { setDraftCompletionBehavior("auto_pause_others_keep_next"); setHasDraftChanges(true); },
          },
        ],
      },
      {
        title: "Episode Availability",
        icon: "time-outline" as const,
        options: [
          {
            title: "Show Same-Day Episodes",
            shortLabel: "Same day",
            detail: "Show episodes on Home once their calendar day starts.",
            selected: draftAirtimeMode === "same_day",
            onPress: () => { setDraftAirtimeMode("same_day"); setHasDraftChanges(true); },
          },
          {
            title: "Wait Until Airtime",
            shortLabel: "After airtime",
            detail: "Hide same-day episodes until the scheduled time passes.",
            selected: draftAirtimeMode === "after_airtime",
            onPress: () => { setDraftAirtimeMode("after_airtime"); setHasDraftChanges(true); },
          },
        ],
      },
      {
        title: "Paused Shelf",
        icon: "pause-circle-outline" as const,
        options: [
          {
            title: "Auto-paused Only",
            shortLabel: "Auto only",
            detail: "Show just titles snoozed by inactivity.",
            selected: draftPausedSectionMode === "auto_paused_only",
            onPress: () => { setDraftPausedSectionMode("auto_paused_only"); setHasDraftChanges(true); },
          },
          {
            title: "All Paused Shows",
            shortLabel: "All paused",
            detail: "Include manually paused and auto-paused titles.",
            selected: draftPausedSectionMode === "all_paused",
            onPress: () => { setDraftPausedSectionMode("all_paused"); setHasDraftChanges(true); },
          },
        ],
      },
    ],
    [
      draftAirtimeMode,
      draftCompletionBehavior,
      draftPausedSectionMode,
      draftRelationMode,
    ]
  );

  return (
    <ScreenWrapper contentClassName="px-0 py-0" edges={["top"]}>
      <View className="flex-1 bg-bg-base">
        <View className="border-b border-border-default bg-bg-base px-5 py-5">
          <View className="flex-row items-start gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase tracking-wide text-text-muted">Settings</Text>
              <Text className="mt-1 text-2xl font-black text-text-primary">Profile Controls</Text>
              <Text className="mt-1 text-sm text-text-secondary">
                Tracking maintenance and default behavior.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              onPress={close}
              className="mt-0.5 h-10 w-10 items-center justify-center rounded-md border border-border-default bg-bg-surface"
            >
              <Ionicons name="close" size={18} color="#e4e4e7" />
            </Pressable>
          </View>
          {notice ? <Text className="mt-3 text-xs text-success">{notice}</Text> : null}
          {error ? <Text className="mt-3 text-xs text-primary">{error}</Text> : null}
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
          <View className="gap-5">
            <View className="gap-3">
              <View className="border-b border-border-default pb-3">
                <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                  Data & Maintenance
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <MaintenanceTile
                  title="Refresh stats"
                  caption="Watch totals"
                  icon="bar-chart-outline"
                  busy={isRefreshingStats}
                  disabled={!isAuthenticated}
                  onPress={refreshStats}
                />
                <MaintenanceTile
                  title="Refresh shows"
                  caption="Tracking data"
                  icon="refresh-outline"
                  busy={isRepairingTracking}
                  disabled={!isAuthenticated}
                  onPress={refreshShows}
                />
                <Link href="/import" asChild>
                  <MaintenanceTile
                    title="TV Time import"
                    caption="Archive tools"
                    icon="cloud-upload-outline"
                  />
                </Link>
              </View>
            </View>

            <View>
              <View className="border-b border-border-default pb-3">
                <Text className="text-xs font-black uppercase tracking-wide text-text-secondary">
                  Viewing Preferences
                </Text>
              </View>
              <View className="gap-5 pt-4">
                {animeGroups.map((group) => (
                  <PreferenceControl
                    key={group.title}
                    title={group.title}
                    icon={group.icon}
                    options={group.options}
                    disabled={isSavingAnimeSettings}
                  />
                ))}
                <View className="flex-row justify-end gap-2 border-t border-border-default pt-4">
                  <Pressable
                    accessibilityRole="button"
                    disabled={!hasDraftChanges || isSavingAnimeSettings}
                    onPress={cancelChanges}
                    className="min-h-10 items-center justify-center rounded-lg border border-border-default bg-bg-surface px-5"
                    style={{ opacity: !hasDraftChanges || isSavingAnimeSettings ? 0.45 : 1 }}
                  >
                    <Text className="text-sm font-bold text-text-secondary">Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!hasDraftChanges || isSavingAnimeSettings}
                    onPress={saveAnimeSettings}
                    className="min-h-10 flex-row items-center justify-center gap-2 rounded-lg bg-primary px-5"
                    style={{ opacity: !hasDraftChanges || isSavingAnimeSettings ? 0.45 : 1 }}
                  >
                    {isSavingAnimeSettings ? <BrandLoader compact onPrimary /> : <Ionicons name="checkmark" size={17} color="#ffffff" />}
                    <Text className="text-sm font-black text-white">Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>

          </View>
        </ScrollView>
      </View>
    </ScreenWrapper>
  );
}
