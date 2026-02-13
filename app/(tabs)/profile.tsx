import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { toHttpsImageUrl } from "@/lib/image-url";

type TimeBreakdown = {
  months: number;
  days: number;
  hours: number;
};

type RailItem = {
  key: string;
  routeId: string | null;
  title: string;
  posterUrl: string | null | undefined;
  meta?: string;
  badge?: string;
};

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

function formatStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "watching") return "Watching";
  if (normalized === "plan_to_watch") return "Plan to Watch";
  const spaced = normalized.replace(/_/g, " ");
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

function getRouteId(args: {
  mediaType: "tv" | "anime" | "movie";
  tmdbId?: number | null;
  anilistId?: number | null;
  malId?: number | null;
}) {
  if (
    typeof args.tmdbId === "number" &&
    (args.mediaType === "tv" || args.mediaType === "movie")
  ) {
    return `tmdb:${args.mediaType}:${args.tmdbId}`;
  }
  if (typeof args.anilistId === "number" && args.mediaType === "anime") {
    return `anilist:anime:${args.anilistId}`;
  }
  if (typeof args.malId === "number" && args.mediaType === "anime") {
    return `jikan:anime:${args.malId}`;
  }
  return null;
}

function StatCard({
  icon,
  label,
  value,
  breakdown,
  accent,
  isDesktop,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  breakdown?: TimeBreakdown;
  accent: string;
  isDesktop: boolean;
}) {
  const segments = [
    { key: "months", value: breakdown?.months ?? 0, label: "MONTHS" },
    { key: "days", value: breakdown?.days ?? 0, label: "DAYS" },
    { key: "hours", value: breakdown?.hours ?? 0, label: "HOURS" },
  ].filter((segment) => segment.value > 0);

  return (
    <View
      className="overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface"
      style={{ flexBasis: isDesktop ? "23.5%" : "48%", flexGrow: 1, minWidth: 160 }}
    >
      <View style={{ height: 3, backgroundColor: accent }} />
      <View className="px-3 pb-4 pt-3">
        <View className="mb-3 flex-row items-center gap-2">
          <View
            className="h-7 w-7 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${accent}25` }}
          >
            <Ionicons name={icon} size={14} color={accent} />
          </View>
          <Text className="text-xs font-medium text-text-secondary">{label}</Text>
        </View>

        <Text className="text-center text-3xl font-black text-text-primary">{value}</Text>

        {segments.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap items-center justify-center gap-2">
            {segments.map((segment) => (
              <View
                key={segment.key}
                className="items-center rounded-md border border-border-default bg-bg-elevated/70 px-2 py-1"
              >
                <Text className="text-sm font-semibold text-text-primary">{segment.value}</Text>
                <Text className="text-[10px] text-text-secondary">{segment.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function QuickMetric({
  icon,
  value,
  label,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
  accent: string;
}) {
  return (
    <View className="flex-1 rounded-xl border-2 border-border-default bg-bg-surface px-3 py-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={14} color={accent} />
        <Text className="text-[11px] text-text-secondary">{label}</Text>
      </View>
      <Text className="mt-1 text-xl font-bold text-text-primary">{value}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  icon,
  rightLabel,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  rightLabel?: string;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={18} color="#ef4444" />
        <Text
          className="text-xl text-text-primary"
          style={{ fontFamily: "Courier New", fontWeight: "900" }}
        >
          {title}
        </Text>
      </View>
      {rightLabel ? (
        <Text className="text-[11px] font-black uppercase tracking-wide text-text-secondary">
          {rightLabel}
        </Text>
      ) : null}
    </View>
  );
}

function PosterRail({
  items,
  emptyMessage,
  isDesktop,
}: {
  items: RailItem[];
  emptyMessage: string;
  isDesktop: boolean;
}) {
  if (items.length === 0) {
    return (
      <View className="items-center justify-center rounded-xl border-2 border-border-default bg-bg-surface py-8">
        <Text className="text-sm text-text-secondary">{emptyMessage}</Text>
      </View>
    );
  }

  const posterWidth = isDesktop ? 122 : 102;
  const posterHeight = Math.round((posterWidth * 3) / 2);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-5 px-5"
      contentContainerStyle={{ gap: 10, paddingRight: 20 }}
    >
      {items.map((item) => {
        const card = (
          <Pressable
            className="overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface"
            style={({ pressed }) => (pressed && item.routeId ? { opacity: 0.92 } : undefined)}
            disabled={!item.routeId}
          >
            <View style={{ width: posterWidth, height: posterHeight }}>
              {toHttpsImageUrl(item.posterUrl) ? (
                <Image source={{ uri: toHttpsImageUrl(item.posterUrl) }} style={{ width: posterWidth, height: posterHeight }} resizeMode="cover" />
              ) : (
                <View className="h-full w-full items-center justify-center bg-bg-elevated">
                  <Ionicons name="image-outline" size={20} color="#71717a" />
                </View>
              )}

              <LinearGradient
                colors={["transparent", "rgba(9,9,11,0.92)"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 72 }}
              />

              <View className="absolute bottom-0 left-0 right-0 px-2 pb-2">
                <Text className="text-xs font-semibold text-white" numberOfLines={1}>
                  {item.title}
                </Text>
                {item.meta ? (
                  <Text className="text-[11px] text-text-secondary" numberOfLines={1}>
                    {item.meta}
                  </Text>
                ) : null}
              </View>

              {item.badge ? (
                <View className="absolute left-2 top-2 rounded-md border border-white/20 bg-black/70 px-2 py-1">
                  <Text className="text-[10px] font-black uppercase tracking-wide text-white">{item.badge}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );

        if (!item.routeId) {
          return <View key={item.key}>{card}</View>;
        }

        return (
          <Link
            key={item.key}
            href={{ pathname: "/show/[id]", params: { id: item.routeId } }}
            asChild
          >
            {card}
          </Link>
        );
      })}
    </ScrollView>
  );
}

export default function ProfileScreen() {
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 1024;

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftAvatarUrl, setDraftAvatarUrl] = useState("");
  const [draftBannerUrl, setDraftBannerUrl] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [visibleRailCount, setVisibleRailCount] = useState(8);
  const [isLoadingMoreRails, setIsLoadingMoreRails] = useState(false);
  const canLoadMoreFromEdgeRef = useRef(true);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stats = useQuery(api.stats.getUserStats);
  const favorites = useQuery(api.stats.getUserFavorites, { limit: 60 });
  const lists = useQuery(api.lists.getUserLists);
  const dashboard = useQuery(api.shows.getHomeDashboard, {});
  const upsertUserProfile = useMutation(api.stats.upsertUserProfile);

  const isLoading =
    stats === undefined || favorites === undefined || lists === undefined || dashboard === undefined;

  const heroBackdrop =
    stats?.bannerUrl ?? dashboard?.shows?.[0]?.backdropUrl ?? dashboard?.movies?.[0]?.backdropUrl ?? null;
  const heroBackdropUrl = toHttpsImageUrl(heroBackdrop);
  const avatarUrl = toHttpsImageUrl(stats?.avatarUrl);

  const favoriteShowRailItems = useMemo<RailItem[]>(
    () =>
      (favorites ?? [])
        .filter((entry) => entry.mediaType !== "movie")
        .map((entry) => ({
          key: `fav-show-${String(entry.id)}`,
          routeId: null,
          title: entry.title,
          posterUrl: entry.posterUrl,
          badge: "Favorite",
        })),
    [favorites]
  );

  const favoriteMovieRailItems = useMemo<RailItem[]>(
    () =>
      (favorites ?? [])
        .filter((entry) => entry.mediaType === "movie")
        .map((entry) => ({
          key: `fav-movie-${String(entry.id)}`,
          routeId: null,
          title: entry.title,
          posterUrl: entry.posterUrl,
          badge: "Favorite",
        })),
    [favorites]
  );

  const activeShowRailItems = useMemo<RailItem[]>(
    () =>
      (dashboard?.shows ?? []).map((entry) => ({
        key: `active-show-${entry.id ?? entry.title}`,
        routeId: getRouteId({
          mediaType: entry.mediaType,
          tmdbId: entry.tmdbId,
          anilistId: entry.anilistId,
          malId: entry.malId,
        }),
        title: entry.title,
        posterUrl: entry.posterUrl,
        meta:
          typeof entry.remainingEpisodes === "number" && entry.remainingEpisodes > 0
            ? `${entry.remainingEpisodes} left`
            : formatStatus(entry.status),
        badge: entry.mediaType === "anime" ? "Anime" : "TV",
      })),
    [dashboard]
  );

  const activeMovieRailItems = useMemo<RailItem[]>(
    () =>
      (dashboard?.movies ?? []).map((entry) => ({
        key: `active-movie-${entry.id ?? entry.title}`,
        routeId: getRouteId({
          mediaType: entry.mediaType,
          tmdbId: entry.tmdbId,
          anilistId: entry.anilistId,
          malId: entry.malId,
        }),
        title: entry.title,
        posterUrl: entry.posterUrl,
        meta: formatStatus(entry.status),
        badge: "Movie",
      })),
    [dashboard]
  );

  const railPageSize = isDesktop ? 14 : 8;

  const hasMoreRails =
    (lists?.length ?? 0) > visibleRailCount ||
    favoriteShowRailItems.length > visibleRailCount ||
    activeShowRailItems.length > visibleRailCount ||
    favoriteMovieRailItems.length > visibleRailCount ||
    activeMovieRailItems.length > visibleRailCount;

  const visibleLists = useMemo(
    () => (lists ?? []).slice(0, visibleRailCount),
    [lists, visibleRailCount]
  );
  const visibleFavoriteShowRailItems = useMemo(
    () => favoriteShowRailItems.slice(0, visibleRailCount),
    [favoriteShowRailItems, visibleRailCount]
  );
  const visibleActiveShowRailItems = useMemo(
    () => activeShowRailItems.slice(0, visibleRailCount),
    [activeShowRailItems, visibleRailCount]
  );
  const visibleFavoriteMovieRailItems = useMemo(
    () => favoriteMovieRailItems.slice(0, visibleRailCount),
    [favoriteMovieRailItems, visibleRailCount]
  );
  const visibleMovieRailItems = useMemo(
    () => activeMovieRailItems.slice(0, visibleRailCount),
    [activeMovieRailItems, visibleRailCount]
  );

  useEffect(() => {
    setVisibleRailCount((current) => Math.max(current, railPageSize));
    setIsLoadingMoreRails(false);
    canLoadMoreFromEdgeRef.current = true;
  }, [railPageSize]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  const loadMoreRails = useCallback(() => {
    if (!hasMoreRails || isLoadingMoreRails || isLoading) {
      return;
    }

    setIsLoadingMoreRails(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleRailCount((count) => count + railPageSize);
      setIsLoadingMoreRails(false);
    }, 120);
  }, [hasMoreRails, isLoading, isLoadingMoreRails, railPageSize]);

  const onProfileScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight = event.nativeEvent.contentSize.height;
      const distanceFromBottom = contentHeight - (y + viewportHeight);

      if (distanceFromBottom > 320) {
        canLoadMoreFromEdgeRef.current = true;
      }

      if (
        distanceFromBottom <= 180 &&
        canLoadMoreFromEdgeRef.current &&
        !isLoadingMoreRails &&
        !isLoading
      ) {
        canLoadMoreFromEdgeRef.current = false;
        loadMoreRails();
      }
    },
    [isLoading, isLoadingMoreRails, loadMoreRails]
  );

  const openProfileEditor = () => {
    setDraftUsername(stats?.username ?? "");
    setDraftBio(stats?.bio ?? "");
    setDraftAvatarUrl(stats?.avatarUrl ?? "");
    setDraftBannerUrl(stats?.bannerUrl ?? "");
    setProfileError(null);
    setProfileSuccess(null);
    setIsEditingProfile(true);
  };

  const closeProfileEditor = () => {
    if (isSavingProfile) return;
    setIsEditingProfile(false);
    setProfileError(null);
    setProfileSuccess(null);
  };

  const handleSaveProfile = async () => {
    const username = draftUsername.trim();
    if (!username) {
      setProfileError("Username is required.");
      return;
    }

    setProfileError(null);
    setProfileSuccess(null);
    setIsSavingProfile(true);

    try {
      await upsertUserProfile({
        username,
        bio: draftBio,
        avatarUrl: draftAvatarUrl,
        bannerUrl: draftBannerUrl,
      });
      setProfileSuccess("Profile updated.");
      setIsEditingProfile(false);
    } catch (error) {
      console.error("Failed to update profile", error);
      const errorMessage = error instanceof Error ? error.message : String(error ?? "");
      if (errorMessage.includes("Could not find public function")) {
        setProfileError("Profile update is not loaded in Convex yet. Run npx convex dev (or restart it) and try again.");
      } else {
        setProfileError("Could not save profile changes.");
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleSignOut = async () => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out failed", error);
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenWrapper>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#ef4444" />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        onScroll={onProfileScroll}
        scrollEventThrottle={16}
      >
        <View className="overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface">
          <View className="relative" style={{ height: isDesktop ? 250 : 220 }}>
            {heroBackdropUrl ? (
              <Image source={{ uri: heroBackdropUrl }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <LinearGradient
                colors={["#27272a", "#18181b", "#09090b"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
              />
            )}

            <LinearGradient
              colors={["rgba(9,9,11,0.2)", "rgba(9,9,11,0.9)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />

            <View className="absolute -right-8 -top-6 h-36 w-36 rounded-full bg-primary/25" />
            <View className="absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-accent/20" />

            <View className="absolute left-4 right-4 top-4 flex-row items-center justify-between">
              <View className="rounded-full border border-white/20 bg-black/35 px-3 py-1.5">
                <Text className="text-[11px] font-semibold text-white">
                  {stats?.currentStreak ?? 0} day streak
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={openProfileEditor}
                  className="rounded-full border border-white/40 bg-black/70 px-4 py-2 shadow-lg"
                >
                  <Text className="text-xs font-bold tracking-wide text-white">EDIT</Text>
                </Pressable>
                {isDesktop && (
                  <Pressable
                    onPress={() => setShowSignOutConfirm(true)}
                    disabled={!isAuthenticated || isSigningOut}
                    className="rounded-full border border-primary/50 bg-black/70 px-4 py-2 shadow-lg"
                    style={{ opacity: !isAuthenticated || isSigningOut ? 0.5 : 1 }}
                  >
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="log-out-outline" size={14} color="#ef4444" />
                      <Text className="text-xs font-bold tracking-wide text-primary">
                        {isSigningOut ? "..." : "LOGOUT"}
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </View>

            <View className="absolute bottom-4 left-4 right-4 flex-row items-end justify-between">
              <View className="flex-row items-end gap-3">
                <View className="h-20 w-20 overflow-hidden rounded-full border-4 border-bg-base bg-bg-elevated">
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} className="h-full w-full" resizeMode="cover" />
                  ) : (
                    <View className="h-full w-full items-center justify-center">
                      <Ionicons name="person" size={34} color="#a1a1aa" />
                    </View>
                  )}
                </View>

                <View className="max-w-[70%]">
                  <Text className="text-2xl font-black text-white" numberOfLines={1}>
                    {stats?.username || "ShowTracker User"}
                  </Text>
                  <Text className="text-sm text-zinc-300" numberOfLines={1}>
                    {isAuthenticated
                      ? `${formatCount(stats?.totalEpisodesWatched ?? 0)} episodes logged`
                      : "Not authenticated"}
                  </Text>
                  {stats?.bio ? (
                    <Text className="mt-0.5 text-xs text-zinc-300" numberOfLines={2}>
                      {stats.bio}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        </View>

        {!isEditingProfile && profileSuccess ? (
          <Text className="mt-3 text-sm text-success">{profileSuccess}</Text>
        ) : null}

        <View className="mt-4 flex-row flex-wrap gap-3">
          <QuickMetric
            icon="flame-outline"
            label="Current Streak"
            value={`${stats?.currentStreak ?? 0}d`}
            accent="#f97316"
          />
          <QuickMetric
            icon="trophy-outline"
            label="Longest Streak"
            value={`${stats?.longestStreak ?? 0}d`}
            accent="#fbbf24"
          />
          <QuickMetric
            icon="checkmark-circle-outline"
            label="Completed"
            value={`${stats?.completedShows ?? 0}/${stats?.totalTrackedShows ?? 0}`}
            accent="#34d399"
          />
        </View>

        <View className="mt-8">
          <SectionHeader title="Stats" icon="bar-chart-outline" rightLabel="YOUR WATCH ACTIVITY" />
          <View className="flex-row flex-wrap gap-3">
            <StatCard
              icon="tv-outline"
              label="TV Time"
              value={stats?.tvWatchTimeFormatted ?? "0 min"}
              breakdown={stats?.tvWatchTimeBreakdown}
              accent="#38bdf8"
              isDesktop={isDesktop}
            />
            <StatCard
              icon="albums-outline"
              label="Episodes Watched"
              value={formatCount(stats?.totalEpisodesWatched ?? 0)}
              accent="#ef4444"
              isDesktop={isDesktop}
            />
            <StatCard
              icon="film-outline"
              label="Movie Time"
              value={stats?.movieWatchTimeFormatted ?? "0 min"}
              breakdown={stats?.movieWatchTimeBreakdown}
              accent="#a78bfa"
              isDesktop={isDesktop}
            />
            <StatCard
              icon="play-circle-outline"
              label="Movies Watched"
              value={stats?.movieCount ?? 0}
              accent="#f59e0b"
              isDesktop={isDesktop}
            />
          </View>
        </View>

        <View className="mt-8">
          <SectionHeader title="Lists" icon="list-outline" rightLabel={`${lists?.length ?? 0} TOTAL`} />

          <Link href="/list/create" asChild>
            <Pressable className="overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.18)", "rgba(239,68,68,0.02)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingHorizontal: 16, paddingVertical: 18 }}
              >
                <View className="flex-row items-center justify-center gap-2">
                  <Ionicons name="add" size={22} color="#ef4444" />
                  <Text className="text-sm font-bold tracking-wide text-text-primary">CREATE A NEW LIST</Text>
                </View>
              </LinearGradient>
            </Pressable>
          </Link>

          {lists && lists.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-5 mt-3 px-5"
              contentContainerStyle={{ gap: 10, paddingRight: 20 }}
            >
              {visibleLists.map((list) => (
                <Link key={String(list.id)} href={`/list/${list.id}`} asChild>
                  <Pressable className="w-44 overflow-hidden rounded-xl border-2 border-border-default bg-bg-surface">
                    <View className="h-1 w-full bg-primary" />
                    <View className="p-3">
                      <Text className="text-sm font-bold text-text-primary" numberOfLines={1}>
                        {list.name}
                      </Text>
                      <Text className="mt-1 text-xs text-text-secondary">
                        {list.itemCount} {list.itemCount === 1 ? "show" : "shows"}
                      </Text>
                    </View>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {favoriteShowRailItems.length > 0 ? (
          <View className="mt-8">
            <SectionHeader
              title="Favorite Shows"
              icon="heart"
              rightLabel={`${favoriteShowRailItems.length} FAVORITES`}
            />
            <PosterRail
              items={visibleFavoriteShowRailItems}
              emptyMessage="No favorite shows yet"
              isDesktop={isDesktop}
            />
          </View>
        ) : null}

        {favoriteMovieRailItems.length > 0 ? (
          <View className="mt-8">
            <SectionHeader
              title="Favorite Movies"
              icon="heart"
              rightLabel={`${favoriteMovieRailItems.length} FAVORITES`}
            />
            <PosterRail
              items={visibleFavoriteMovieRailItems}
              emptyMessage="No favorite movies yet"
              isDesktop={isDesktop}
            />
          </View>
        ) : null}

        <View className="mt-8">
          <SectionHeader
            title="Shows"
            icon="tv-outline"
            rightLabel={`${dashboard?.shows?.length ?? 0} TRACKED`}
          />
          <PosterRail
            items={visibleActiveShowRailItems}
            emptyMessage="Track a show to see it here"
            isDesktop={isDesktop}
          />
        </View>

        <View className="mt-8">
          <SectionHeader
            title="Movies"
            icon="film-outline"
            rightLabel={`${dashboard?.movies?.length ?? 0} TRACKED`}
          />
          <PosterRail
            items={visibleMovieRailItems}
            emptyMessage="Add movies to your library to see them here"
            isDesktop={isDesktop}
          />
        </View>

        {hasMoreRails ? (
          <View className="items-center py-2">
            <ActivityIndicator size="small" color={isLoadingMoreRails ? "#ef4444" : "#52525b"} />
          </View>
        ) : null}

        {!isDesktop && (
          <View className="mt-8 pb-8">
            <SectionHeader title="Account" icon="person-outline" />
            <Pressable
              onPress={() => setShowSignOutConfirm(true)}
              disabled={!isAuthenticated || isSigningOut}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 py-3.5"
              style={{ opacity: !isAuthenticated || isSigningOut ? 0.5 : 1 }}
            >
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
              <Text className="font-semibold text-primary">
                {isSigningOut ? "Signing out..." : "Sign out"}
              </Text>
            </Pressable>
            {signOutError ? <Text className="mt-2 text-sm text-primary">{signOutError}</Text> : null}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={isEditingProfile}
        transparent
        animationType="fade"
        onRequestClose={closeProfileEditor}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            onPress={closeProfileEditor}
            disabled={isSavingProfile}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className={`w-full ${isDesktop ? "max-w-xl" : ""}`}
          >
            <View className="overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.2)", "rgba(56,189,248,0.06)", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 4, width: "100%" }}
              />

              <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
                <View>
                  <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Profile
                  </Text>
                  <Text className="text-lg font-black text-text-primary">Edit Details</Text>
                </View>
                <Pressable
                  onPress={closeProfileEditor}
                  disabled={isSavingProfile}
                  className="h-8 w-8 items-center justify-center rounded-full bg-bg-elevated"
                >
                  <Ionicons name="close" size={16} color="#a1a1aa" />
                </Pressable>
              </View>

              <ScrollView
                className="max-h-[70vh]"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View className="gap-3 px-4 pb-4">
                  <View>
                    <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Username
                    </Text>
                    <TextInput
                      value={draftUsername}
                      onChangeText={setDraftUsername}
                      editable={!isSavingProfile}
                      maxLength={32}
                      placeholder="Your username"
                      placeholderTextColor="#52525b"
                      className="rounded-lg border-2 border-border-default bg-bg-base px-3 py-2.5 text-text-primary"
                    />
                  </View>

                  <View>
                    <View className="mb-1 flex-row items-center justify-between">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                        Bio
                      </Text>
                      <Text className="text-[11px] text-text-secondary">
                        {draftBio.length}/280
                      </Text>
                    </View>
                    <TextInput
                      value={draftBio}
                      onChangeText={setDraftBio}
                      editable={!isSavingProfile}
                      maxLength={280}
                      placeholder="Short bio"
                      placeholderTextColor="#52525b"
                      multiline
                      textAlignVertical="top"
                      className="min-h-[90px] rounded-lg border-2 border-border-default bg-bg-base px-3 py-2.5 text-text-primary"
                    />
                  </View>

                  <View>
                    <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Avatar URL
                    </Text>
                    <TextInput
                      value={draftAvatarUrl}
                      onChangeText={setDraftAvatarUrl}
                      editable={!isSavingProfile}
                      placeholder="https://..."
                      placeholderTextColor="#52525b"
                      autoCapitalize="none"
                      className="rounded-lg border-2 border-border-default bg-bg-base px-3 py-2.5 text-text-primary"
                    />
                  </View>

                  <View>
                    <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Banner URL
                    </Text>
                    <TextInput
                      value={draftBannerUrl}
                      onChangeText={setDraftBannerUrl}
                      editable={!isSavingProfile}
                      placeholder="https://..."
                      placeholderTextColor="#52525b"
                      autoCapitalize="none"
                      className="rounded-lg border-2 border-border-default bg-bg-base px-3 py-2.5 text-text-primary"
                    />
                  </View>

                  {profileError ? <Text className="text-sm text-primary">{profileError}</Text> : null}

                  <View className="flex-row gap-2 pt-1">
                    <Pressable
                      onPress={closeProfileEditor}
                      disabled={isSavingProfile}
                      className="flex-1 items-center justify-center rounded-lg border-2 border-border-default bg-bg-elevated py-3"
                    >
                      <Text className="text-sm font-bold text-text-primary">Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveProfile}
                      disabled={isSavingProfile}
                      className="flex-1 items-center justify-center border-2 border-primary bg-primary py-3"
                      style={{ opacity: isSavingProfile ? 0.6 : 1 }}
                    >
                      {isSavingProfile ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text className="text-sm font-black uppercase tracking-wide text-white">Save</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showSignOutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => !isSigningOut && setShowSignOutConfirm(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5">
          <Pressable
            className="absolute inset-0"
            onPress={() => !isSigningOut && setShowSignOutConfirm(false)}
            disabled={isSigningOut}
          />

          <View className={`w-full overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface ${isDesktop ? "max-w-md" : ""}`}>
            <LinearGradient
              colors={["rgba(239,68,68,0.2)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ height: 4, width: "100%" }}
            />

            <View className="items-center px-6 py-8">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Ionicons name="log-out-outline" size={32} color="#ef4444" />
              </View>

              <Text className="text-xl font-black text-text-primary">Sign Out?</Text>
              <Text className="mt-2 text-center text-sm text-text-secondary">
                Are you sure you want to sign out of your account?
              </Text>

              {signOutError ? (
                <Text className="mt-4 text-center text-sm text-primary">{signOutError}</Text>
              ) : null}

              <View className="mt-6 w-full flex-row gap-3">
                <Pressable
                  onPress={() => setShowSignOutConfirm(false)}
                  disabled={isSigningOut}
                  className="flex-1 items-center justify-center rounded-lg border-2 border-border-default bg-bg-elevated py-3.5"
                >
                  <Text className="text-sm font-bold text-text-primary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSignOut}
                  disabled={isSigningOut}
                  className="flex-1 items-center justify-center border-2 border-primary bg-primary py-3.5"
                  style={{ opacity: isSigningOut ? 0.6 : 1 }}
                >
                  {isSigningOut ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-sm font-black uppercase tracking-wide text-white">Sign Out</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}
