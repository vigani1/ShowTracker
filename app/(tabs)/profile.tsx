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
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { ScreenWrapper } from "@/components/ScreenWrapper";
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
};

type AnimeHomeFranchiseMode = "core_only" | "all_relations";
type AnimeCompletionBehavior =
  | "ask_every_time"
  | "auto_open_next"
  | "auto_pause_others_keep_next";

const ANIME_SETTINGS_UPDATE_TIMEOUT_MS = 12000;

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
        <Text className="text-lg font-extrabold tracking-tight text-text-primary">
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

  const metrics: { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string }[] = [
    { icon: "tv-outline", value: stats.tvWatchTimeFormatted ?? "0min", label: "TV TIME" },
    { icon: "albums-outline", value: formatCount(stats.tvEpisodes ?? 0), label: "TV EPS" },
    { icon: "planet-outline", value: stats.animeWatchTimeFormatted ?? "0min", label: "ANIME TIME" },
    { icon: "sparkles-outline", value: formatCount(stats.animeEpisodes ?? 0), label: "ANIME EPS" },
    { icon: "film-outline", value: stats.movieWatchTimeFormatted ?? "0min", label: "MOVIE TIME" },
    { icon: "play-circle-outline", value: String(stats.movieCount ?? 0), label: "MOVIES" },
    { icon: "flame-outline", value: `${stats.currentStreak ?? 0}d`, label: "STREAK" },
    { icon: "trophy-outline", value: `${stats.longestStreak ?? 0}d`, label: "BEST STREAK" },
  ];

  return (
    <View className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
      <LinearGradient
        colors={["rgba(239,68,68,0.06)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View className="relative flex-row items-center justify-between px-5 pb-4 pt-5">
        <View>
          <Text className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Total Watch Time
          </Text>
          <Text className="mt-1 text-4xl font-black text-text-primary">
            {stats.totalWatchTimeFormatted ?? "0min"}
          </Text>
        </View>
        <View className="items-end">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="checkmark-circle" size={14} color="#ef4444" />
            <Text className="text-sm font-bold text-text-primary">
              {completed}/{total}
            </Text>
          </View>
          <View className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-bg-elevated">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </View>
          <Text className="mt-1 text-[10px] text-text-muted">
            {pct}% completed
          </Text>
        </View>
      </View>

      <View className="mx-5 h-px bg-border-default" />

      <View
        className="relative flex-row flex-wrap px-5 py-4"
        style={{ gap: 12 }}
      >
        {metrics.map((m) => (
          <View
            key={m.label}
            className="items-center py-2"
            style={{
              flexBasis: isDesktop ? "11.5%" : "48%",
              flexGrow: isDesktop ? 1 : 0,
              minHeight: isMobile ? 94 : undefined,
            }}
          >
            <View className="mb-2 h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Ionicons name={m.icon} size={16} color="#ef4444" />
            </View>
            <Text
              className={`${isMobile ? "text-base" : "text-lg"} font-black text-text-primary leading-tight text-center`}
              numberOfLines={2}
              minimumFontScale={0.85}
              adjustsFontSizeToFit
            >
              {m.value}
            </Text>
            <Text
              className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted text-center"
              numberOfLines={2}
            >
              {m.label}
            </Text>
          </View>
        ))}
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

function StatsPanelCards({
  stats,
  isDesktop,
}: {
  stats: ProfileStats;
  isDesktop: boolean;
}) {
  const completed = stats.completedShows ?? 0;
  const total = stats.totalTrackedShows ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const quickMetrics = [
    { icon: "flame-outline" as keyof typeof Ionicons.glyphMap, value: `${stats.currentStreak ?? 0}d`, label: "STREAK" },
    { icon: "trophy-outline" as keyof typeof Ionicons.glyphMap, value: `${stats.longestStreak ?? 0}d`, label: "BEST" },
    { icon: "checkmark-circle-outline" as keyof typeof Ionicons.glyphMap, value: `${completed}/${total}`, label: `${pct}%` },
  ];

  const mainCards: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    subtitle: string;
    breakdown?: TimeBreakdown;
  }[] = [
    {
      icon: "time-outline",
      label: "TOTAL TIME",
      value: stats.totalWatchTimeFormatted ?? "0min",
      subtitle: `${formatCount(stats.totalEpisodesWatched ?? 0)} episodes`,
      breakdown: stats.totalWatchTimeBreakdown,
    },
    {
      icon: "tv-outline",
      label: "TV TIME",
      value: stats.tvWatchTimeFormatted ?? "0min",
      subtitle: `${formatCount(stats.tvEpisodes ?? 0)} episodes`,
      breakdown: stats.tvWatchTimeBreakdown,
    },
    {
      icon: "planet-outline",
      label: "ANIME TIME",
      value: stats.animeWatchTimeFormatted ?? "0min",
      subtitle: `${formatCount(stats.animeEpisodes ?? 0)} episodes`,
      breakdown: stats.animeWatchTimeBreakdown,
    },
    {
      icon: "film-outline",
      label: "MOVIE TIME",
      value: stats.movieWatchTimeFormatted ?? "0min",
      subtitle: `${formatCount(stats.movieCount ?? 0)} movies`,
      breakdown: stats.movieWatchTimeBreakdown,
    },
  ];

  return (
    <View>
      <View className="flex-row gap-2">
        {quickMetrics.map((m) => (
          <View
            key={m.label}
            className="flex-1 flex-row items-center gap-2 overflow-hidden rounded-xl border border-border-default bg-bg-surface px-3 py-2.5"
          >
            <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Ionicons name={m.icon} size={14} color="#ef4444" />
            </View>
            <View>
              <Text className="text-base font-black text-text-primary">{m.value}</Text>
              <Text className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">{m.label}</Text>
            </View>
          </View>
        ))}
      </View>

      <View className="mt-3 flex-row flex-wrap gap-3">
        {mainCards.map((card) => {
          const segments = breakdownPills(card.breakdown);

          return (
            <View
              key={card.label}
              className="flex-row overflow-hidden rounded-xl border border-border-default bg-bg-surface"
              style={{ flexBasis: isDesktop ? "23.5%" : "48%", flexGrow: 1, minWidth: 160 }}
            >
              <View className="w-1 bg-primary" />
              <View className="flex-1 px-3 py-3">
                <View className="mb-2 flex-row items-center gap-2">
                  <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                    <Ionicons name={card.icon} size={14} color="#ef4444" />
                  </View>
                  <Text className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    {card.label}
                  </Text>
                </View>
                <Text className="text-2xl font-black text-text-primary">{card.value}</Text>
                <Text className="mt-0.5 text-[11px] text-text-secondary">{card.subtitle}</Text>
                {segments.length > 0 ? (
                  <View className="mt-2 flex-row flex-wrap gap-1.5">
                    {segments.map((s) => (
                      <View
                        key={s.key}
                        className="rounded-md bg-bg-elevated/70 px-2 py-0.5"
                      >
                        <Text className="text-[10px] font-semibold text-text-secondary">
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
      </View>
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
  const [isAnimeSettingsVisible, setIsAnimeSettingsVisible] = useState(false);
  const [isSavingAnimeSettings, setIsSavingAnimeSettings] = useState(false);
  const [animeSettingsError, setAnimeSettingsError] = useState<string | null>(null);
  const [statsVersion, setStatsVersion] = useState<"A" | "B">("A");
  const [shouldLoadHeavySections, setShouldLoadHeavySections] = useState(false);
  const [visibleRailCount, setVisibleRailCount] = useState(8);
  const [isLoadingMoreRails, setIsLoadingMoreRails] = useState(false);
  const canLoadMoreFromEdgeRef = useRef(true);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animeSettingsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingAnimeSettingsRef = useRef(false);
  const deferredLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileSummary = useQuery(api.stats.getUserProfileSummary);
  const stats = useQuery(api.stats.getUserStats, shouldLoadHeavySections ? {} : "skip");
  const favorites = useQuery(
    api.stats.getUserFavorites,
    shouldLoadHeavySections ? { limit: 60 } : "skip"
  );
  const lists = useQuery(api.lists.getUserLists, shouldLoadHeavySections ? {} : "skip");
  const library = useQuery(api.shows.getLibrary, shouldLoadHeavySections ? {} : "skip");
  const animeHomeSettings = useQuery(api.shows.getUserAnimeHomeSettings);
  const upsertUserProfile = useMutation(api.stats.upsertUserProfile);
  const setUserAnimeHomeSettings = useMutation(api.shows.setUserAnimeHomeSettings);
  const syncTrackedAnimeRelations = useAction(api.shows.syncTrackedAnimeRelations);
  const pruneAnimeFranchiseToCoreRelations = useAction(
    api.shows.pruneAnimeFranchiseToCoreRelations
  );

  const animeHomeFranchiseMode =
    (animeHomeSettings?.relationMode as AnimeHomeFranchiseMode | undefined) ??
    "core_only";
  const animeCompletionBehavior =
    (animeHomeSettings?.completionBehavior as AnimeCompletionBehavior | undefined) ??
    "ask_every_time";

  const isInitialLoading = profileSummary === undefined || animeHomeSettings === undefined;
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
  const trackedAnimeFranchiseRoots = useMemo(
    () =>
      Array.from(
        new Set(
          libraryEntries
            .filter(
              (entry) =>
                entry.mediaType === "anime" &&
                typeof entry.relationRootAnilistId === "number"
            )
            .map((entry) => entry.relationRootAnilistId as number)
        )
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
      if (animeSettingsTimeoutRef.current) {
        clearTimeout(animeSettingsTimeoutRef.current);
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

  const openAnimeSettings = () => {
    setAnimeSettingsError(null);
    setIsAnimeSettingsVisible(true);
  };

  const closeAnimeSettings = () => {
    if (isSavingAnimeSettings) {
      return;
    }
    setIsAnimeSettingsVisible(false);
    setAnimeSettingsError(null);
  };

  const updateAnimeSettings = useCallback(
    async (args: {
      relationMode?: AnimeHomeFranchiseMode;
      completionBehavior?: AnimeCompletionBehavior;
    }) => {
      if (isSavingAnimeSettingsRef.current) {
        return false;
      }
      isSavingAnimeSettingsRef.current = true;

      setAnimeSettingsError(null);
      setIsSavingAnimeSettings(true);

      try {
        if (animeSettingsTimeoutRef.current) {
          clearTimeout(animeSettingsTimeoutRef.current);
          animeSettingsTimeoutRef.current = null;
        }

        await Promise.race([
          setUserAnimeHomeSettings(args),
          new Promise<never>((_, reject) => {
            animeSettingsTimeoutRef.current = setTimeout(() => {
              reject(new Error("timeout"));
            }, ANIME_SETTINGS_UPDATE_TIMEOUT_MS);
          }),
        ]);
        return true;
      } catch (error) {
        console.error("Failed to update anime settings", error);
        const message = error instanceof Error ? error.message : String(error ?? "");
        setAnimeSettingsError(
          message.includes("timeout")
            ? "Update timed out. Please try again."
            : "Could not save anime settings."
        );
        return false;
      } finally {
        if (animeSettingsTimeoutRef.current) {
          clearTimeout(animeSettingsTimeoutRef.current);
          animeSettingsTimeoutRef.current = null;
        }
        isSavingAnimeSettingsRef.current = false;
        setIsSavingAnimeSettings(false);
      }
    },
    [setUserAnimeHomeSettings]
  );

  const handleSetHomeFranchiseMode = useCallback(
    async (relationMode: AnimeHomeFranchiseMode) => {
      const didUpdate = await updateAnimeSettings({ relationMode });
      if (!didUpdate) {
        return;
      }

      if (relationMode === "all_relations") {
        void syncTrackedAnimeRelations({ force: true }).catch((error) => {
          console.warn("Failed to sync tracked anime franchises", error);
        });
        return;
      }

      if (trackedAnimeFranchiseRoots.length === 0) {
        return;
      }

      const pruneResults = await Promise.allSettled(
        trackedAnimeFranchiseRoots.map((relationRootAnilistId) =>
          pruneAnimeFranchiseToCoreRelations({ relationRootAnilistId })
        )
      );

      const rejectedCount = pruneResults.filter(
        (result) => result.status === "rejected"
      ).length;
      if (rejectedCount === 0) {
        return;
      }

      console.warn(
        `Failed to prune ${rejectedCount}/${pruneResults.length} anime franchise entries`
      );
      if (rejectedCount === pruneResults.length) {
        setAnimeSettingsError(
          "Saved settings, but pruning franchise entries failed. Please try again."
        );
      }
    },
    [
      pruneAnimeFranchiseToCoreRelations,
      setAnimeSettingsError,
      syncTrackedAnimeRelations,
      trackedAnimeFranchiseRoots,
      updateAnimeSettings,
    ]
  );

  const handleSetCompletionBehavior = useCallback(
    async (completionBehavior: AnimeCompletionBehavior) => {
      await updateAnimeSettings({ completionBehavior });
    },
    [updateAnimeSettings]
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
              <Pressable
                onPress={openAnimeSettings}
                className="rounded-full border border-white/40 bg-black/70 px-4 py-2 shadow-lg"
              >
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="settings-outline" size={14} color="#e4e4e7" />
                  <Text className="text-xs font-bold tracking-wide text-white">SETTINGS</Text>
                </View>
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
            <Pressable
              onPress={() => setStatsVersion((v) => (v === "A" ? "B" : "A"))}
              className="rounded-full border border-border-default bg-bg-surface px-3 py-1"
            >
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                {statsVersion === "A" ? "Cards" : "Panel"}
              </Text>
            </Pressable>
          </View>
          {stats ? (
            statsVersion === "A" ? (
              <StatsPanelUnified stats={stats} isDesktop={isDesktop} />
            ) : (
              <StatsPanelCards stats={stats} isDesktop={isDesktop} />
            )
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
          <SectionHeader title="Lists" icon="list-outline" rightLabel={`${lists?.length ?? 0} TOTAL`} />

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
              rightLabel={`${favoriteTvRailItems.length} FAVORITES`}
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
              rightLabel={`${favoriteAnimeRailItems.length} FAVORITES`}
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
              rightLabel={`${favoriteMovieRailItems.length} FAVORITES`}
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
            rightLabel={`${activeTvRailItems.length} TRACKED`}
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
            rightLabel={`${activeAnimeRailItems.length} TRACKED`}
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
            rightLabel={`${activeMovieRailItems.length} TRACKED`}
            actionLabel="Show all"
            actionHref="/library?media=movie"
          />
          <PosterRail
            items={visibleMovieRailItems}
            emptyMessage="Add movies to your library to see them here"
            isDesktop={isDesktop}
          />
        </View>

        <View className="mt-8">
          <SectionHeader title="Data" icon="download-outline" />
          <Link href="/import" asChild>
            <Pressable className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
              <LinearGradient
                colors={["rgba(239,68,68,0.12)", "rgba(239,68,68,0.03)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Ionicons name="cloud-upload-outline" size={16} color="#ef4444" />
                  </View>
                  <View>
                    <Text className="text-sm font-bold text-text-primary">Import from TV Time</Text>
                    <Text className="text-[11px] text-text-muted">
                      Paste or upload your export JSON
                    </Text>
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          </Link>
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
        visible={isAnimeSettingsVisible}
        transparent
        animationType="fade"
        onRequestClose={closeAnimeSettings}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
          <Pressable
            className="absolute inset-0"
            onPress={closeAnimeSettings}
            disabled={isSavingAnimeSettings}
          />

          <View className={`w-full overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface ${isDesktop ? "max-w-md" : ""}`}>
            <LinearGradient
              colors={["rgba(239,68,68,0.2)", "rgba(56,189,248,0.06)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 4, width: "100%" }}
            />

            <View className="border-b border-border-default px-4 pb-3 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Anime Settings
              </Text>
              <Text className="mt-1 text-lg font-black text-text-primary">
                Home and Completion
              </Text>
              <Text className="mt-2 text-sm text-text-secondary">
                These defaults apply to all anime unless you set a franchise override on a show page.
              </Text>
            </View>

            <ScrollView
              className="max-h-[70vh]"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="gap-3 px-4 pb-4 pt-3">
                <View>
                  <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Home Franchise View
                  </Text>

                  <View className="gap-2">
                    <Pressable
                      disabled={isSavingAnimeSettings}
                      onPress={() => {
                        void handleSetHomeFranchiseMode("core_only");
                      }}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        animeHomeFranchiseMode === "core_only"
                          ? "border-primary/60 bg-primary/15"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-semibold ${
                            animeHomeFranchiseMode === "core_only"
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          Core Franchise Titles
                        </Text>
                        <Text className="mt-0.5 text-xs text-text-secondary">
                          Keep Home focused on the main franchise timeline.
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          animeHomeFranchiseMode === "core_only"
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={18}
                        color={animeHomeFranchiseMode === "core_only" ? "#ef4444" : "#71717a"}
                      />
                    </Pressable>

                    <Pressable
                      disabled={isSavingAnimeSettings}
                      onPress={() => {
                        void handleSetHomeFranchiseMode("all_relations");
                      }}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        animeHomeFranchiseMode === "all_relations"
                          ? "border-primary/60 bg-primary/15"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-semibold ${
                            animeHomeFranchiseMode === "all_relations"
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          All Franchise Titles
                        </Text>
                        <Text className="mt-0.5 text-xs text-text-secondary">
                          Include side stories and related titles on Home.
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          animeHomeFranchiseMode === "all_relations"
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={18}
                        color={animeHomeFranchiseMode === "all_relations" ? "#ef4444" : "#71717a"}
                      />
                    </Pressable>
                  </View>
                </View>

                <View>
                  <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    On Completion
                  </Text>

                  <View className="gap-2">
                    <Pressable
                      disabled={isSavingAnimeSettings}
                      onPress={() => {
                        void handleSetCompletionBehavior("ask_every_time");
                      }}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        animeCompletionBehavior === "ask_every_time"
                          ? "border-primary/60 bg-primary/15"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-semibold ${
                            animeCompletionBehavior === "ask_every_time"
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          Ask Every Time
                        </Text>
                        <Text className="mt-0.5 text-xs text-text-secondary">
                          Prompt before moving to the next season.
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          animeCompletionBehavior === "ask_every_time"
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={18}
                        color={animeCompletionBehavior === "ask_every_time" ? "#ef4444" : "#71717a"}
                      />
                    </Pressable>

                    <Pressable
                      disabled={isSavingAnimeSettings}
                      onPress={() => {
                        void handleSetCompletionBehavior("auto_open_next");
                      }}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        animeCompletionBehavior === "auto_open_next"
                          ? "border-primary/60 bg-primary/15"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-semibold ${
                            animeCompletionBehavior === "auto_open_next"
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          Open Next Season
                        </Text>
                        <Text className="mt-0.5 text-xs text-text-secondary">
                          Jump directly to the next main franchise season.
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          animeCompletionBehavior === "auto_open_next"
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={18}
                        color={animeCompletionBehavior === "auto_open_next" ? "#ef4444" : "#71717a"}
                      />
                    </Pressable>

                    <Pressable
                      disabled={isSavingAnimeSettings}
                      onPress={() => {
                        void handleSetCompletionBehavior("auto_pause_others_keep_next");
                      }}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        animeCompletionBehavior === "auto_pause_others_keep_next"
                          ? "border-primary/60 bg-primary/15"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.9 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-semibold ${
                            animeCompletionBehavior === "auto_pause_others_keep_next"
                              ? "text-primary"
                              : "text-text-primary"
                          }`}
                        >
                          Pause Other Franchise Titles
                        </Text>
                        <Text className="mt-0.5 text-xs text-text-secondary">
                          Keep the next season active and pause the rest.
                        </Text>
                      </View>
                      <Ionicons
                        name={
                          animeCompletionBehavior === "auto_pause_others_keep_next"
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={18}
                        color={animeCompletionBehavior === "auto_pause_others_keep_next" ? "#ef4444" : "#71717a"}
                      />
                    </Pressable>
                  </View>
                </View>

                <Text className="text-xs text-text-muted">
                  Tip: per-franchise overrides are available from each anime show page.
                </Text>

                {animeSettingsError ? (
                  <Text className="text-sm text-primary">{animeSettingsError}</Text>
                ) : null}

                {isSavingAnimeSettings ? (
                  <View className="flex-row items-center justify-center gap-2 py-1">
                    <ActivityIndicator size="small" color="#a1a1aa" />
                    <Text className="text-xs text-text-secondary">Saving settings...</Text>
                  </View>
                ) : null}

                <Pressable
                  disabled={isSavingAnimeSettings}
                  onPress={closeAnimeSettings}
                  className="items-center justify-center rounded-xl border border-border-default bg-bg-elevated py-3"
                  style={({ pressed }) => ({
                    opacity: isSavingAnimeSettings ? 0.45 : pressed ? 0.88 : 1,
                  })}
                >
                  <Text className="text-sm font-semibold text-text-primary">Done</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
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
