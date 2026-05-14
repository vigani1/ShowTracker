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
import { useStableCount } from "@/hooks/use-stable-display-value";
import { toHttpsImageUrl } from "@/lib/image-url";

type TimeBreakdown = {
  months: number;
  days: number;
  hours: number;
  minutes: number;
};

type RailItem = {
  key: string;
  routeId: string | null;
  title: string;
  posterUrl: string | null | undefined;
  meta?: string;
  badge?: string;
};

type ProfileLibraryEntry = {
  id: string;
  title: string;
  mediaType: "tv" | "anime" | "movie";
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
  posterUrl: string | null;
  backdropUrl: string | null;
  overview?: string | null;
  firstAired: string | null;
  tmdbId: number | null;
  anilistId: number | null;
  malId: number | null;
  tvmazeId?: number | null;
  imdbId?: string | null;
  isAutoTracked?: boolean;
  watchedEpisodes?: number;
  totalEpisodes?: number | null;
  progressPercent?: number | null;
  genres?: string[];
  rating?: number | null;
  remainingEpisodes: number | null;
  lastActivityAt: number;
  relationRootAnilistId?: number | null;
  anilistFormat?: string | null;
  animeSeason?: string | null;
  animeSeasonYear?: number | null;
};

type ProfileStats = {
  totalWatchTimeFormatted?: string;
  totalWatchTimeBreakdown?: TimeBreakdown;
  tvWatchTimeFormatted?: string;
  tvWatchTimeBreakdown?: TimeBreakdown;
  animeWatchTimeFormatted?: string;
  animeWatchTimeBreakdown?: TimeBreakdown;
  movieWatchTimeFormatted?: string;
  movieWatchTimeBreakdown?: TimeBreakdown;
  totalEpisodesWatched?: number;
  tvEpisodes?: number;
  animeEpisodes?: number;
  movieCount?: number;
  currentStreak?: number;
  longestStreak?: number;
  completedShows?: number;
  totalTrackedShows?: number;
  statsRebuiltAt?: number | null;
  statsSource?: "cached" | "live";
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

const animeSeasonMonthOffsetByName: Record<string, number> = {
  WINTER: 0,
  SPRING: 3,
  SUMMER: 6,
  FALL: 9,
};

const animeFormatWeightByType: Record<string, number> = {
  TV: 0,
  TV_SHORT: 1,
  MOVIE: 2,
  ONA: 3,
  OVA: 4,
  SPECIAL: 5,
  MUSIC: 6,
};

const mainlineAnimeFormats = new Set(["TV", "TV_SHORT"]);

function getAnimeChronologyValue(entry: Pick<ProfileLibraryEntry, "firstAired" | "animeSeason" | "animeSeasonYear">) {
  const firstAired = entry.firstAired?.trim();
  if (firstAired) {
    const directDateMatch = firstAired.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (directDateMatch) {
      const year = Number.parseInt(directDateMatch[1], 10);
      const month = Number.parseInt(directDateMatch[2], 10) - 1;
      const day = Number.parseInt(directDateMatch[3], 10);
      const asDate = Date.UTC(year, month, day);
      if (Number.isFinite(asDate)) {
        return asDate;
      }
    }
  }

  if (typeof entry.animeSeasonYear === "number") {
    const season = entry.animeSeason?.toUpperCase() ?? "";
    const monthOffset = animeSeasonMonthOffsetByName[season] ?? 0;
    return Date.UTC(entry.animeSeasonYear, monthOffset, 1);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getAnimeFormatWeight(entry: Pick<ProfileLibraryEntry, "anilistFormat">) {
  const format = entry.anilistFormat?.toUpperCase();
  if (!format) {
    return 99;
  }
  return animeFormatWeightByType[format] ?? 99;
}

function isMainlineAnime(entry: Pick<ProfileLibraryEntry, "anilistFormat">) {
  const format = entry.anilistFormat?.toUpperCase();
  if (!format) {
    return true;
  }
  return mainlineAnimeFormats.has(format);
}

function selectPrimaryAnimeEntries(entries: ProfileLibraryEntry[]) {
  const grouped = new Map<string, ProfileLibraryEntry[]>();

  for (const entry of entries) {
    const groupKey =
      typeof entry.relationRootAnilistId === "number"
        ? `root:${entry.relationRootAnilistId}`
        : typeof entry.anilistId === "number"
          ? `anilist:${entry.anilistId}`
          : typeof entry.malId === "number"
            ? `mal:${entry.malId}`
            : `show:${entry.id}`;

    const group = grouped.get(groupKey) ?? [];
    group.push(entry);
    grouped.set(groupKey, group);
  }

  const selected: ProfileLibraryEntry[] = [];

  for (const group of grouped.values()) {
    const mainline = group.filter((entry) => isMainlineAnime(entry));
    const pool = mainline.length > 0 ? mainline : group;
    const sorted = [...pool].sort((a, b) => {
      const chronologyA = getAnimeChronologyValue(a);
      const chronologyB = getAnimeChronologyValue(b);
      if (chronologyA !== chronologyB) {
        return chronologyA - chronologyB;
      }

      const formatA = getAnimeFormatWeight(a);
      const formatB = getAnimeFormatWeight(b);
      if (formatA !== formatB) {
        return formatA - formatB;
      }

      if (a.title !== b.title) {
        return a.title.localeCompare(b.title);
      }

      const idA = a.anilistId ?? a.malId ?? Number.MAX_SAFE_INTEGER;
      const idB = b.anilistId ?? b.malId ?? Number.MAX_SAFE_INTEGER;
      return idA - idB;
    });

    if (sorted[0]) {
      selected.push(sorted[0]);
    }
  }

  return selected.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function SectionHeader({
  title,
  icon,
  rightLabel,
  actionLabel,
  actionHref,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  rightLabel?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Ionicons name={icon} size={14} color="#ef4444" />
        </View>
        <Text className="text-lg font-extrabold tracking-tight text-text-primary" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        {rightLabel ? (
          <Text className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
            {rightLabel}
          </Text>
        ) : null}
        {actionLabel && actionHref ? (
          <Link href={actionHref} asChild>
            <Pressable className="rounded-full border border-border-default bg-bg-surface px-2.5 py-1">
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
                {actionLabel}
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function StatsPanelUnified({
  stats,
  isDesktop,
}: {
  stats: ProfileStats;
  isDesktop: boolean;
}) {
  const isMobile = !isDesktop;
  const completed = stats.completedShows ?? 0;
  const total = stats.totalTrackedShows ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const mediaMetrics: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    value: string;
    meta: string;
    breakdown?: TimeBreakdown;
  }[] = [
    {
      icon: "tv-outline",
      title: "TV",
      value: stats.tvWatchTimeFormatted ?? "0min",
      meta: `${formatCount(stats.tvEpisodes ?? 0)} eps`,
      breakdown: stats.tvWatchTimeBreakdown,
    },
    {
      icon: "planet-outline",
      title: "Anime",
      value: stats.animeWatchTimeFormatted ?? "0min",
      meta: `${formatCount(stats.animeEpisodes ?? 0)} eps`,
      breakdown: stats.animeWatchTimeBreakdown,
    },
    {
      icon: "film-outline",
      title: "Movies",
      value: stats.movieWatchTimeFormatted ?? "0min",
      meta: `${formatCount(stats.movieCount ?? 0)} watched`,
      breakdown: stats.movieWatchTimeBreakdown,
    },
  ];

  const streakMetrics: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
  }[] = [
    { icon: "flame-outline", label: "Current streak", value: `${stats.currentStreak ?? 0}d` },
    { icon: "trophy-outline", label: "Best streak", value: `${stats.longestStreak ?? 0}d` },
  ];

  return (
    <View className="overflow-hidden rounded-3xl border border-border-default bg-[#121214]">
      <LinearGradient
        colors={["rgba(239,68,68,0.16)", "rgba(39,39,42,0.26)", "rgba(18,18,20,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View
        className={`${isMobile ? "gap-4" : "flex-row items-stretch gap-4"} relative p-4`}
      >
        <View className="min-w-0 flex-1 justify-between rounded-2xl border border-white/10 bg-black/20 p-4">
          <View className="flex-row items-center gap-2">
            <View className="h-8 w-8 items-center justify-center rounded-xl bg-primary/15">
              <Ionicons name="time-outline" size={16} color="#ef4444" />
            </View>
            <Text className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Total watch time
            </Text>
          </View>
          <Text
            className={`${isMobile ? "text-4xl" : "text-5xl"} mt-5 font-black leading-tight text-text-primary`}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.64}
          >
            {stats.totalWatchTimeFormatted ?? "0min"}
          </Text>
          <View className="mt-5 flex-row flex-wrap gap-2">
            <View className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <Text className="text-[11px] font-bold text-text-secondary">
                {formatCount(stats.totalEpisodesWatched ?? 0)} episodes
              </Text>
            </View>
            <View className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <Text className="text-[11px] font-bold text-text-secondary">
                {formatCount(stats.movieCount ?? 0)} movies
              </Text>
            </View>
            {breakdownPills(stats.totalWatchTimeBreakdown).map((s) => (
              <View key={s.key} className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5">
                <Text className="text-[11px] font-black text-text-primary">
                  {s.value}{s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className={`${isMobile ? "" : "w-72"} justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4`}>
          <View className="flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Completion
            </Text>
            <View className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1">
              <Ionicons name="checkmark-circle" size={12} color="#ef4444" />
              <Text className="text-xs font-black text-text-primary" numberOfLines={1}>
                {pct}%
              </Text>
            </View>
          </View>
          <View className="mt-6 flex-row items-end gap-2">
            <Text className="text-3xl font-black text-text-primary">{completed}</Text>
            <Text className="pb-1 text-sm font-semibold text-text-muted">of {total} finished</Text>
          </View>
          <View className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/40">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </View>
          <Text className="mt-2 text-[11px] font-semibold text-text-muted">
            {Math.max(total - completed, 0)} still in progress or queued
          </Text>
        </View>
      </View>

      <View
        className="relative flex-row flex-wrap px-4 pb-4"
        style={{ gap: isMobile ? 10 : 12 }}
      >
        {mediaMetrics.map((m) => {
          const segments = breakdownPills(m.breakdown);

          return (
            <View
              key={m.title}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
              style={{
                flexBasis: isDesktop ? 0 : "100%",
                flexGrow: 1,
              }}
            >
              <View className="h-1 bg-primary" />
              <View className="p-4">
                <View className="flex-row items-center justify-between">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                    <Ionicons name={m.icon} size={17} color="#ef4444" />
                  </View>
                  <Text className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {m.title}
                  </Text>
                </View>
                <Text
                  className="mt-5 text-2xl font-black leading-tight text-text-primary"
                  numberOfLines={1}
                  minimumFontScale={0.74}
                  adjustsFontSizeToFit
                >
                  {m.value}
                </Text>
                <Text className="mt-1 text-xs font-semibold text-text-muted" numberOfLines={1}>
                  {m.meta}
                </Text>
                {segments.length > 0 ? (
                  <View className="mt-3 flex-row flex-wrap gap-1.5">
                    {segments.map((s) => (
                      <View
                        key={s.key}
                        className="rounded-lg bg-black/30 px-2 py-1"
                      >
                        <Text className="text-[10px] font-bold text-text-secondary">
                          {s.value}{s.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}

        <View
          className={`${isMobile ? "gap-2" : "flex-row gap-3"} w-full`}
        >
          {streakMetrics.map((m) => (
            <View
              key={m.label}
              className="flex-1 flex-row items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                  <Ionicons name={m.icon} size={17} color="#ef4444" />
                </View>
                <Text className="text-xs font-bold uppercase tracking-widest text-text-muted">
                  {m.label}
                </Text>
              </View>
              <Text className="text-2xl font-black text-text-primary">
                {m.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function breakdownPills(breakdown?: TimeBreakdown) {
  if (!breakdown) return [];

  if (breakdown.months > 0 || breakdown.days > 0) {
    return [
      { key: "months", value: breakdown.months, label: "MO" },
      { key: "days", value: breakdown.days, label: "D" },
      { key: "hours", value: breakdown.hours, label: "H" },
    ];
  }

  if (breakdown.hours > 0) {
    return [
      { key: "hours", value: breakdown.hours, label: "H" },
      { key: "minutes", value: breakdown.minutes, label: "MIN" },
    ];
  }

  return [{ key: "minutes", value: breakdown.minutes, label: "MIN" }];
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
      <View className="items-center justify-center rounded-xl border border-border-default bg-bg-surface py-8">
        <Ionicons name="film-outline" size={24} color="#52525b" />
        <Text className="mt-2 text-sm text-text-secondary">{emptyMessage}</Text>
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
            className="overflow-hidden rounded-xl border border-border-default bg-bg-surface"
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
                <View className="absolute left-2 top-2 rounded-md border border-white/20 bg-bg-base/80 px-2 py-1">
                  <Text className="text-[10px] font-bold uppercase tracking-wide text-white">{item.badge}</Text>
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
  const [shouldLoadHeavySections, setShouldLoadHeavySections] = useState(false);
  const [visibleRailCount, setVisibleRailCount] = useState(8);
  const [isLoadingMoreRails, setIsLoadingMoreRails] = useState(false);
  const canLoadMoreFromEdgeRef = useRef(true);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileSummary = useQuery(api.stats.getUserProfileSummary);
  const stats = useQuery(api.stats.getUserStats, shouldLoadHeavySections ? {} : "skip");
  const favorites = useQuery(
    api.stats.getUserFavorites,
    shouldLoadHeavySections ? { limit: 60 } : "skip"
  );
  const lists = useQuery(api.lists.getUserLists, shouldLoadHeavySections ? {} : "skip");
  const library = useQuery(api.shows.getLibrary, shouldLoadHeavySections ? {} : "skip");
  const upsertUserProfile = useMutation(api.stats.upsertUserProfile);

  const isInitialLoading = profileSummary === undefined;
  const isHeavySectionsLoading =
    shouldLoadHeavySections &&
    (stats === undefined || favorites === undefined || lists === undefined || library === undefined);
  const profileIdentity = stats ?? profileSummary;

  const favoriteEntries = useMemo(
    () => favorites ?? [],
    [favorites]
  );
  const libraryEntries = useMemo(
    () => library ?? [],
    [library]
  );
  const primaryAnimeLibraryEntries = useMemo(
    () =>
      selectPrimaryAnimeEntries(
        libraryEntries.filter((entry) => entry.mediaType === "anime")
      ),
    [libraryEntries]
  );

  const heroBackdrop =
    profileIdentity?.bannerUrl ??
    libraryEntries.find((entry) => typeof entry.backdropUrl === "string" && entry.backdropUrl.length > 0)
      ?.backdropUrl ??
    null;
  const heroBackdropUrl = toHttpsImageUrl(heroBackdrop);
  const avatarUrl = toHttpsImageUrl(profileIdentity?.avatarUrl);

  const favoriteTvRailItems = useMemo<RailItem[]>(
    () =>
      favoriteEntries
        .filter((entry) => entry.mediaType === "tv")
        .map((entry) => ({
          key: `fav-tv-${String(entry.id)}`,
          routeId: getRouteId({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            anilistId: entry.anilistId,
            malId: entry.malId,
          }),
          title: entry.title,
          posterUrl: entry.posterUrl,
          badge: "Favorite",
        })),
    [favoriteEntries]
  );

  const favoriteAnimeRailItems = useMemo<RailItem[]>(
    () =>
      favoriteEntries
        .filter((entry) => entry.mediaType === "anime")
        .map((entry) => ({
          key: `fav-anime-${String(entry.id)}`,
          routeId: getRouteId({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            anilistId: entry.anilistId,
            malId: entry.malId,
          }),
          title: entry.title,
          posterUrl: entry.posterUrl,
          badge: "Favorite",
        })),
    [favoriteEntries]
  );

  const favoriteMovieRailItems = useMemo<RailItem[]>(
    () =>
      favoriteEntries
        .filter((entry) => entry.mediaType === "movie")
        .map((entry) => ({
          key: `fav-movie-${String(entry.id)}`,
          routeId: getRouteId({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            anilistId: entry.anilistId,
            malId: entry.malId,
          }),
          title: entry.title,
          posterUrl: entry.posterUrl,
          badge: "Favorite",
        })),
    [favoriteEntries]
  );

  const activeTvRailItems = useMemo<RailItem[]>(
    () =>
      libraryEntries
        .filter((entry) => entry.mediaType === "tv")
        .map((entry) => ({
          key: `active-tv-${entry.id ?? entry.title}`,
          routeId: getRouteId({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            anilistId: entry.anilistId,
            malId: entry.malId,
          }),
          title: entry.title,
          posterUrl: entry.posterUrl,
          meta:
            typeof entry.remainingEpisodes === "number" &&
            entry.remainingEpisodes > 0
              ? `${entry.remainingEpisodes} left`
              : formatStatus(entry.status),
          badge: "TV",
        })),
    [libraryEntries]
  );

  const activeAnimeRailItems = useMemo<RailItem[]>(
    () =>
      primaryAnimeLibraryEntries
        .map((entry) => ({
          key: `active-anime-${entry.id ?? entry.title}`,
          routeId: getRouteId({
            mediaType: entry.mediaType,
            tmdbId: entry.tmdbId,
            anilistId: entry.anilistId,
            malId: entry.malId,
          }),
          title: entry.title,
          posterUrl: entry.posterUrl,
          meta:
            typeof entry.remainingEpisodes === "number" &&
            entry.remainingEpisodes > 0
              ? `${entry.remainingEpisodes} left`
              : formatStatus(entry.status),
          badge: "Anime",
        })),
    [primaryAnimeLibraryEntries]
  );

  const activeMovieRailItems = useMemo<RailItem[]>(
    () =>
      libraryEntries
        .filter((entry) => entry.mediaType === "movie")
        .map((entry) => ({
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
    [libraryEntries]
  );
  const stableListCount = useStableCount(
    lists?.length,
    "profile-lists",
    isHeavySectionsLoading
  );
  const stableFavoriteTvCount = useStableCount(
    favoriteTvRailItems.length,
    "profile-favorite-tv",
    isHeavySectionsLoading
  );
  const stableFavoriteAnimeCount = useStableCount(
    favoriteAnimeRailItems.length,
    "profile-favorite-anime",
    isHeavySectionsLoading
  );
  const stableFavoriteMovieCount = useStableCount(
    favoriteMovieRailItems.length,
    "profile-favorite-movie",
    isHeavySectionsLoading
  );
  const stableActiveTvCount = useStableCount(
    activeTvRailItems.length,
    "profile-active-tv",
    isHeavySectionsLoading
  );
  const stableActiveAnimeCount = useStableCount(
    activeAnimeRailItems.length,
    "profile-active-anime",
    isHeavySectionsLoading
  );
  const stableActiveMovieCount = useStableCount(
    activeMovieRailItems.length,
    "profile-active-movie",
    isHeavySectionsLoading
  );

  const railPageSize = isDesktop ? 14 : 8;
  const activeRailVisibleCount = Math.max(visibleRailCount, 40);

  const hasMoreRails =
    (lists?.length ?? 0) > visibleRailCount ||
    favoriteTvRailItems.length > visibleRailCount ||
    favoriteAnimeRailItems.length > visibleRailCount ||
    activeTvRailItems.length > activeRailVisibleCount ||
    activeAnimeRailItems.length > activeRailVisibleCount ||
    favoriteMovieRailItems.length > visibleRailCount ||
    activeMovieRailItems.length > activeRailVisibleCount;

  const visibleLists = useMemo(
    () => (lists ?? []).slice(0, visibleRailCount),
    [lists, visibleRailCount]
  );
  const visibleFavoriteTvRailItems = useMemo(
    () => favoriteTvRailItems.slice(0, visibleRailCount),
    [favoriteTvRailItems, visibleRailCount]
  );
  const visibleFavoriteAnimeRailItems = useMemo(
    () => favoriteAnimeRailItems.slice(0, visibleRailCount),
    [favoriteAnimeRailItems, visibleRailCount]
  );
  const visibleActiveTvRailItems = useMemo(
    () => activeTvRailItems.slice(0, activeRailVisibleCount),
    [activeTvRailItems, activeRailVisibleCount]
  );
  const visibleActiveAnimeRailItems = useMemo(
    () => activeAnimeRailItems.slice(0, activeRailVisibleCount),
    [activeAnimeRailItems, activeRailVisibleCount]
  );
  const visibleFavoriteMovieRailItems = useMemo(
    () => favoriteMovieRailItems.slice(0, visibleRailCount),
    [favoriteMovieRailItems, visibleRailCount]
  );
  const visibleMovieRailItems = useMemo(
    () => activeMovieRailItems.slice(0, activeRailVisibleCount),
    [activeMovieRailItems, activeRailVisibleCount]
  );

  useEffect(() => {
    setVisibleRailCount((current) => Math.max(current, railPageSize));
    setIsLoadingMoreRails(false);
    canLoadMoreFromEdgeRef.current = true;
  }, [railPageSize]);

  useEffect(() => {
    deferredLoadTimerRef.current = setTimeout(() => {
      setShouldLoadHeavySections(true);
    }, 180);

    return () => {
      if (deferredLoadTimerRef.current) {
        clearTimeout(deferredLoadTimerRef.current);
      }
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  const loadMoreRails = useCallback(() => {
    if (
      !hasMoreRails ||
      isLoadingMoreRails ||
      isInitialLoading ||
      isHeavySectionsLoading
    ) {
      return;
    }

    setIsLoadingMoreRails(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleRailCount((count) => count + railPageSize);
      setIsLoadingMoreRails(false);
    }, 120);
  }, [
    hasMoreRails,
    isHeavySectionsLoading,
    isInitialLoading,
    isLoadingMoreRails,
    railPageSize,
  ]);

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
        !isInitialLoading &&
        !isHeavySectionsLoading
      ) {
        canLoadMoreFromEdgeRef.current = false;
        loadMoreRails();
      }
    },
    [isHeavySectionsLoading, isInitialLoading, isLoadingMoreRails, loadMoreRails]
  );

  const openProfileEditor = () => {
    setDraftUsername(profileIdentity?.username ?? "");
    setDraftBio(profileIdentity?.bio ?? "");
    setDraftAvatarUrl(profileIdentity?.avatarUrl ?? "");
    setDraftBannerUrl(profileIdentity?.bannerUrl ?? "");
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

  if (isInitialLoading) {
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
        <View className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
          <View className="relative" style={{ height: isDesktop ? 280 : 240 }}>
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
              colors={["rgba(9,9,11,0.1)", "rgba(9,9,11,0.5)", "rgba(9,9,11,0.95)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />

            <LinearGradient
              colors={["rgba(9,9,11,0.55)", "transparent", "rgba(9,9,11,0.35)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />

            <View className="absolute -right-8 -top-6 h-36 w-36 rounded-full bg-primary/15" />
            <View className="absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-accent/10" />

            <View className="absolute right-4 top-4 flex-row items-center gap-3">
              <Pressable
                onPress={openProfileEditor}
                className="rounded-full border border-white/40 bg-black/70 px-4 py-2 shadow-lg"
              >
                <Text className="text-xs font-bold tracking-wide text-white">EDIT</Text>
              </Pressable>
              <Link href="/profile/settings" asChild>
                <Pressable className="rounded-full border border-white/40 bg-black/70 px-4 py-2 shadow-lg">
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name="settings-outline" size={14} color="#e4e4e7" />
                    <Text className="text-xs font-bold tracking-wide text-white">SETTINGS</Text>
                  </View>
                </Pressable>
              </Link>
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

            <View className="absolute bottom-4 left-4 right-4 flex-row items-end justify-between">
              <View className="flex-row items-end gap-4">
                <View className="h-24 w-24 overflow-hidden rounded-full border-[3px] border-primary/50 bg-bg-elevated">
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} className="h-full w-full" resizeMode="cover" />
                  ) : (
                    <View className="h-full w-full items-center justify-center">
                      <Ionicons name="person" size={40} color="#a1a1aa" />
                    </View>
                  )}
                </View>

                <View className="max-w-[70%]">
                  <Text
                    className={`font-black text-white ${isDesktop ? "text-3xl tracking-tight" : "text-2xl"}`}
                    numberOfLines={1}
                  >
                    {profileIdentity?.username || "ShowTracker User"}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-2">
                    <Text className="text-sm text-zinc-300" numberOfLines={1}>
                      {isAuthenticated
                        ? `${formatCount(profileIdentity?.totalEpisodesWatched ?? 0)} episodes logged`
                        : "Not authenticated"}
                    </Text>
                    {(profileIdentity?.currentStreak ?? 0) > 0 && (
                      <>
                        <View className="h-1 w-1 rounded-full bg-zinc-500" />
                        <View className="flex-row items-center gap-1">
                          <Ionicons name="flame" size={12} color="#ef4444" />
                          <Text className="text-sm font-semibold text-zinc-300">
                            {profileIdentity?.currentStreak}d
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                  {profileIdentity?.bio ? (
                    <Text className="mt-0.5 text-xs text-zinc-400" numberOfLines={2}>
                      {profileIdentity.bio}
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

        <View className="mt-6">
          <View className="mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Ionicons name="bar-chart-outline" size={14} color="#ef4444" />
              </View>
              <Text className="text-lg font-extrabold tracking-tight text-text-primary">
                Stats
              </Text>
            </View>
          </View>
          {stats?.statsSource === "live" ? (
            <Text className="mb-3 text-xs text-text-muted">
              Stats are live-calculated. Use Settings to cache them for faster, cheaper loads.
            </Text>
          ) : null}
          {stats ? (
            <StatsPanelUnified stats={stats} isDesktop={isDesktop} />
          ) : (
            <View className="items-center justify-center rounded-2xl border border-border-default bg-bg-surface py-8">
              <ActivityIndicator size="small" color="#ef4444" />
              <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Loading detailed stats
              </Text>
            </View>
          )}
        </View>

        {isHeavySectionsLoading ? (
          <View className="mt-6 items-center justify-center rounded-xl border border-border-default bg-bg-surface py-5">
            <ActivityIndicator size="small" color="#ef4444" />
            <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Loading library sections
            </Text>
          </View>
        ) : null}

        <View className="mt-8">
          <SectionHeader
            title="Lists"
            icon="list-outline"
            rightLabel={
              typeof stableListCount === "number" ? `${stableListCount} TOTAL` : undefined
            }
          />

          <Link href="/list/create" asChild>
            <Pressable className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.12)", "rgba(239,68,68,0.02)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Ionicons name="add" size={18} color="#ef4444" />
                  </View>
                  <View>
                    <Text className="text-sm font-bold text-text-primary">New List</Text>
                    <Text className="text-[11px] text-text-muted">Create a custom collection</Text>
                  </View>
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
                  <Pressable className="w-48 flex-row overflow-hidden rounded-xl border border-border-default bg-bg-surface">
                    <View className="w-1 bg-primary" />
                    <View className="flex-1 p-3">
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

        {favoriteTvRailItems.length > 0 ? (
          <View className="mt-6">
            <SectionHeader
              title="Favorite TV"
              icon="heart"
              rightLabel={`${stableFavoriteTvCount ?? favoriteTvRailItems.length} FAVORITES`}
            />
            <PosterRail
              items={visibleFavoriteTvRailItems}
              emptyMessage="No favorite TV yet"
              isDesktop={isDesktop}
            />
          </View>
        ) : null}

        {favoriteAnimeRailItems.length > 0 ? (
          <View className="mt-6">
            <SectionHeader
              title="Favorite Anime"
              icon="heart"
              rightLabel={`${stableFavoriteAnimeCount ?? favoriteAnimeRailItems.length} FAVORITES`}
            />
            <PosterRail
              items={visibleFavoriteAnimeRailItems}
              emptyMessage="No favorite anime yet"
              isDesktop={isDesktop}
            />
          </View>
        ) : null}

        {favoriteMovieRailItems.length > 0 ? (
          <View className="mt-6">
            <SectionHeader
              title="Favorite Movies"
              icon="heart"
              rightLabel={`${stableFavoriteMovieCount ?? favoriteMovieRailItems.length} FAVORITES`}
            />
            <PosterRail
              items={visibleFavoriteMovieRailItems}
              emptyMessage="No favorite movies yet"
              isDesktop={isDesktop}
            />
          </View>
        ) : null}

        <View className="mt-6">
          <SectionHeader
            title="TV Shows"
            icon="tv-outline"
            rightLabel={`${stableActiveTvCount ?? activeTvRailItems.length} TRACKED`}
            actionLabel="Show all"
            actionHref="/library?media=tv"
          />
          <PosterRail
            items={visibleActiveTvRailItems}
            emptyMessage="Track a TV show to see it here"
            isDesktop={isDesktop}
          />
        </View>

        <View className="mt-6">
          <SectionHeader
            title="Anime"
            icon="planet-outline"
            rightLabel={`${stableActiveAnimeCount ?? activeAnimeRailItems.length} TRACKED`}
            actionLabel="Show all"
            actionHref="/library?media=anime"
          />
          <PosterRail
            items={visibleActiveAnimeRailItems}
            emptyMessage="Track an anime to see it here"
            isDesktop={isDesktop}
          />
        </View>

        <View className="mt-6">
          <SectionHeader
            title="Movies"
            icon="film-outline"
            rightLabel={`${stableActiveMovieCount ?? activeMovieRailItems.length} TRACKED`}
            actionLabel="Show all"
            actionHref="/library?media=movie"
          />
          <PosterRail
            items={visibleMovieRailItems}
            emptyMessage="Add movies to your library to see them here"
            isDesktop={isDesktop}
          />
        </View>

        {isLoadingMoreRails ? (
          <View className="items-center py-2">
            <ActivityIndicator size="small" color="#ef4444" />
          </View>
        ) : null}

        {!isDesktop && (
          <View className="mt-8 pb-8">
            <SectionHeader title="Account" icon="log-out-outline" />
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
