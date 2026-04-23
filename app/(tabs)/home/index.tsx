import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useAction, useQuery } from "convex/react";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { api } from "@/convex/_generated/api";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { getTmdbShowDetails, type TmdbShowDetails } from "@/lib/api/tmdb";
import type { MediaType } from "@/lib/api/types";
import { toHttpsImageUrl } from "@/lib/image-url";

type HomeTab = "watchlist" | "upcoming";
type HomeMediaFilter = "all" | "tv" | "anime";
type HomePausedSectionMode = "auto_paused_only" | "all_paused";

type WatchlistItem = {
  id: string;
  title: string;
  mediaType: MediaType;
  posterUrl: string | null;
  tmdbId: number | null;
  anilistId: number | null;
  malId: number | null;
  status: "watching" | "paused" | "dropped" | "completed" | "plan_to_watch";
  isAutoTracked: boolean;
  trackingState: "not_started" | "in_progress" | "upcoming" | "tba";
  remainingEpisodes: number | null;
  watchedEpisodes: number;
  totalEpisodes: number | null;
  autoPausedAt?: number | null;
  lastWatchedAt?: number | null;
};

type UpcomingEpisode = {
  routeId: string | null;
  showTitle: string;
  mediaType: "tv" | "anime";
  posterUrl?: string;
  daysUntil: number;
  episode: {
    seasonNumber: number;
    episodeNumber: number;
    name?: string;
    airDate?: string;
  };
};

type UpcomingGroup = {
  date: string;
  episodes: UpcomingEpisode[];
};

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const GRID_GAP = 12;
const INITIAL_UPCOMING_HYDRATION_TIMEOUT_MS = 8000;
const TMDB_AIRED_LOOKUP_BATCH_SIZE = 8;
const WATCHLIST_FUTURE_LOOKAHEAD_DAYS = 365;

function estimateAiredEpisodesFromTmdb(details: TmdbShowDetails) {
  const now = new Date();

  const parseEpisodeReleaseTime = (airDate?: string | null) => {
    const trimmed = airDate?.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsedLocal = parseLocalDate(trimmed);
      if (!parsedLocal) {
        return null;
      }

      return parsedLocal;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  };

  const isFutureEpisode = (airDate?: string | null) => {
    const parsed = parseEpisodeReleaseTime(airDate);
    if (!parsed) {
      return false;
    }

    return parsed.getTime() > now.getTime();
  };

  const isReleasedEpisode = (airDate?: string | null) => {
    const parsed = parseEpisodeReleaseTime(airDate);
    if (!parsed) {
      return false;
    }

    return parsed.getTime() <= now.getTime();
  };

  const nonSpecialSeasons = (details.seasons ?? []).filter(
    (season) => season.season_number >= 1
  );

  const getEpisodeOffset = (seasonNumber: number, episodeNumber: number) => {
    const targetSeason = nonSpecialSeasons.find(
      (season) => season.season_number === seasonNumber
    );
    const targetSeasonEpisodeCount =
      typeof targetSeason?.episode_count === "number"
        ? Math.max(targetSeason.episode_count, 0)
        : null;

    // Some TMDB TV entries report absolute episode numbers in
    // `last_episode_to_air` / `next_episode_to_air` even when a season number
    // is also present. When that happens, avoid double-counting prior seasons.
    if (
      typeof targetSeasonEpisodeCount === "number" &&
      episodeNumber > targetSeasonEpisodeCount
    ) {
      return Math.max(episodeNumber, 0);
    }

    const episodesBeforeSeason = nonSpecialSeasons.reduce((sum, season) => {
      if (season.season_number < seasonNumber) {
        return sum + Math.max(season.episode_count ?? 0, 0);
      }
      return sum;
    }, 0);

    return episodesBeforeSeason + Math.max(episodeNumber, 0);
  };

  const nextEpisode = details.next_episode_to_air;
  if (
    typeof nextEpisode?.season_number === "number" &&
    typeof nextEpisode.episode_number === "number"
  ) {
    const releasedThroughNext = getEpisodeOffset(
      nextEpisode.season_number,
      nextEpisode.episode_number
    );

    if (isReleasedEpisode(nextEpisode.air_date) && releasedThroughNext > 0) {
      return releasedThroughNext;
    }

    if (isFutureEpisode(nextEpisode.air_date)) {
      const airedBeforeNext = getEpisodeOffset(
        nextEpisode.season_number,
        nextEpisode.episode_number - 1
      );

      if (airedBeforeNext > 0) {
        return airedBeforeNext;
      }
    }
  }

  const lastEpisode = details.last_episode_to_air;
  const lastSeasonNumber = lastEpisode?.season_number;
  const lastEpisodeNumber = lastEpisode?.episode_number;
  if (
    typeof lastSeasonNumber === "number" &&
    typeof lastEpisodeNumber === "number"
  ) {
    const adjustedEpisodeNumber = isReleasedEpisode(lastEpisode?.air_date)
      ? lastEpisodeNumber
      : lastEpisodeNumber - 1;

    if (nonSpecialSeasons.length === 0) {
      return Math.max(adjustedEpisodeNumber, 0);
    }

    const airedAcrossSeasons = getEpisodeOffset(lastSeasonNumber, adjustedEpisodeNumber);

    if (airedAcrossSeasons > 0) {
      return airedAcrossSeasons;
    }

    return Math.max(adjustedEpisodeNumber, 0);
  }

  if (typeof details.number_of_episodes === "number" && details.number_of_episodes > 0) {
    return details.number_of_episodes;
  }

  return null;
}

function parseLocalDate(dateString: string) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getUtcDayIndex(date: Date) {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS
  );
}

function formatDateForApi(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUpcomingDistanceLabel(daysUntil: number) {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil === -1) return "Yesterday";
  if (daysUntil > 1) return `In ${daysUntil}d`;
  return `${Math.abs(daysUntil)}d ago`;
}

function parseEpisodeAirtime(airDate?: string | null) {
  const trimmed = airDate?.trim();
  if (
    !trimmed ||
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    !/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)
  ) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEpisodeAirtime(airDate?: string | null) {
  const parsed = parseEpisodeAirtime(airDate);
  if (!parsed) {
    return null;
  }

  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPausedSinceLabel(timestamp?: number | null) {
  if (typeof timestamp !== "number") {
    return "Auto-paused";
  }

  const pausedAt = new Date(timestamp);
  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((now - pausedAt.getTime()) / DAY_IN_MS));

  if (diffDays < 7) {
    return diffDays <= 1 ? "Paused recently" : `Paused ${diffDays}d ago`;
  }

  if (diffDays < 30) {
    return `Paused ${Math.floor(diffDays / 7)}w ago`;
  }

  return `Paused ${Math.floor(diffDays / 30)}mo ago`;
}

function getColumnCount(width: number, isWeb: boolean) {
  if (isWeb) {
    if (width >= 1600) return 6;
    if (width >= 1300) return 5;
    if (width >= 1050) return 4;
    if (width >= 800) return 3;
    return 2;
  }
  return width >= 500 ? 3 : 2;
}

function chunkItems<T>(items: T[], chunkSize: number) {
  if (chunkSize <= 0) {
    return [items];
  }

  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    rows.push(items.slice(index, index + chunkSize));
  }
  return rows;
}

function addDaysToDateString(dateString: string, days: number): string {
  const date = parseLocalDate(dateString);
  if (!date) return dateString;

  date.setDate(date.getDate() + days);
  return formatDateForApi(date);
}

function addDaysToDate(date: Date, days: number) {
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonthsToDate(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfMonthDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonthDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeekDate(date: Date) {
  return addDaysToDate(date, -date.getDay());
}

function endOfWeekDate(date: Date) {
  return addDaysToDate(startOfWeekDate(date), 6);
}

function isSameCalendarMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function getMonthTitle(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function getMonthShortLabel(monthIndex: number) {
  return new Date(2026, monthIndex, 1).toLocaleDateString("en-US", {
    month: "short",
  });
}

function getWeekRangeLabel(weekStart: Date) {
  const weekEnd = addDaysToDate(weekStart, 6);
  const startMonth = weekStart.toLocaleDateString("en-US", { month: "short" });
  const endMonth = weekEnd.toLocaleDateString("en-US", { month: "short" });
  const startDay = weekStart.getDate();
  const endDay = weekEnd.getDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }

  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

function getShortWeekdayLabel(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function getInclusiveDayCount(startDate: string, endDate: string): number {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return 1;

  const inclusiveDays = getUtcDayIndex(end) - getUtcDayIndex(start) + 1;
  return Math.max(1, inclusiveDays);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getWatchlistRouteId(item: WatchlistItem) {
  if (
    typeof item.tmdbId === "number" &&
    (item.mediaType === "tv" || item.mediaType === "movie")
  ) {
    return `tmdb:${item.mediaType}:${item.tmdbId}`;
  }
  if (typeof item.anilistId === "number" && item.mediaType === "anime") {
    return `anilist:anime:${item.anilistId}`;
  }
  if (typeof item.malId === "number" && item.mediaType === "anime") {
    return `jikan:anime:${item.malId}`;
  }
  return null;
}

function getEpisodeCodeLabel(episode: UpcomingEpisode["episode"]) {
  return `S${String(episode.seasonNumber).padStart(2, "0")}E${String(
    episode.episodeNumber
  ).padStart(2, "0")}`;
}

function WatchlistCard({ item, isWeb }: { item: WatchlistItem; isWeb: boolean }) {
  const routeId = getWatchlistRouteId(item);
  const posterHeight = isWeb ? 280 : 240;
  const safeWatchedEpisodes =
    item.totalEpisodes !== null
      ? Math.min(item.watchedEpisodes, item.totalEpisodes)
      : item.watchedEpisodes;
  const watchedPercent =
    item.totalEpisodes && item.totalEpisodes > 0
      ? Math.min(100, Math.round((safeWatchedEpisodes / item.totalEpisodes) * 100))
      : null;
  const cornerLabel =
    item.remainingEpisodes === null
      ? item.trackingState === "tba"
        ? "TBA"
        : "Upcoming"
      : `${item.remainingEpisodes} left`;
  const progressLabel =
    item.totalEpisodes === null
      ? safeWatchedEpisodes > 0
        ? `${safeWatchedEpisodes} watched`
        : "Not started"
      : `${safeWatchedEpisodes}/${item.totalEpisodes} episodes`;
  const statusLabel = item.status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const isAutoPaused = item.status === "paused" && typeof item.autoPausedAt === "number";
  const metadataLabel = isAutoPaused ? formatPausedSinceLabel(item.autoPausedAt) : statusLabel;

  const card = (
    <View className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900">
      <View className="relative overflow-hidden" style={{ height: posterHeight }}>
        {item.posterUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(item.posterUrl) }}
            className="absolute inset-0"
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-zinc-800 px-3">
            <Text className="text-center text-sm font-semibold text-zinc-400">
              {item.title}
            </Text>
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.62)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96 }}
        />
        <View className="absolute right-2 top-2 rounded-md border-2 border-white/20 bg-black/80 px-2.5 py-1.5">
          <Text className="text-[11px] font-black uppercase tracking-wide text-white">
            {cornerLabel}
          </Text>
        </View>
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <Text className="mb-0.5 text-sm font-bold text-white" numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {progressLabel}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="text-[10px] uppercase tracking-wide text-zinc-300">
              {metadataLabel}
            </Text>
            {item.isAutoTracked ? (
              <Text className="rounded-sm border border-red-400/40 bg-red-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-red-100">
                Auto
              </Text>
            ) : null}
            {isAutoPaused ? (
              <Text className="rounded-sm border border-amber-300/30 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-100">
                Snoozed
              </Text>
            ) : null}
          </View>
          {watchedPercent !== null ? (
            <View className="mt-1.5 h-1 overflow-hidden bg-white/15">
              <View className="h-full bg-red-500" style={{ width: `${watchedPercent}%` }} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!routeId) {
    return card;
  }

  return (
    <Link href={{ pathname: "/show/[id]", params: { id: routeId } }} asChild>
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) =>
          pressed ? { opacity: 0.95, transform: [{ scale: 0.98 }] } : undefined
        }
      >
        {card}
      </Pressable>
    </Link>
  );
}

function WatchlistCardSkeleton({ isWeb }: { isWeb: boolean }) {
  const posterHeight = isWeb ? 280 : 240;

  return (
    <View className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900">
      <View className="relative overflow-hidden" style={{ height: posterHeight }}>
        <LinearGradient
          colors={["#18181b", "#111113"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", inset: 0 }}
        />
        <View className="absolute right-2 top-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">
          <View className="h-3 w-14 rounded-full bg-white/10" />
        </View>
        <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
          <View className="h-4 w-3/4 rounded-full bg-white/15" />
          <View className="mt-2 h-3 w-1/2 rounded-full bg-white/10" />
          <View className="mt-2 flex-row items-center gap-2">
            <View className="h-2.5 w-16 rounded-full bg-white/10" />
            <View className="h-5 w-10 rounded-full bg-red-500/20" />
          </View>
          <View className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <View className="h-full w-2/5 rounded-full bg-red-500/40" />
          </View>
        </View>
      </View>
    </View>
  );
}

function UpcomingEpisodeListItem({
  episode,
  isWeb,
}: {
  episode: UpcomingEpisode;
  isWeb: boolean;
}) {
  const distanceLabel = getUpcomingDistanceLabel(episode.daysUntil);
  const airtimeLabel = formatEpisodeAirtime(episode.episode.airDate);
  const episodeTitle =
    episode.episode.name && episode.episode.name !== episode.showTitle
      ? episode.episode.name
      : `Episode ${episode.episode.episodeNumber}`;
  const accentClass =
    episode.daysUntil === 0
      ? "border-primary/40 bg-primary/15"
      : episode.daysUntil < 0
        ? "border-amber-400/30 bg-amber-500/10"
        : "border-[#3b272b] bg-[#1a1316]";
  const accentTextClass =
    episode.daysUntil === 0
      ? "text-primary-glow"
      : episode.daysUntil < 0
        ? "text-amber-100"
        : "text-zinc-100";

  const content = (
    <View
      className={`flex-row items-center gap-3 rounded-2xl border px-3 py-3 ${
        isWeb ? "min-h-[84px]" : "min-h-[78px]"
      } ${
        episode.routeId ? "bg-[#161114]" : "bg-[#110d10] opacity-70"
      } border-[#342126]`}
    >
      <View className="h-14 w-14 overflow-hidden rounded-2xl border border-[#3c2529] bg-zinc-900">
        {episode.posterUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(episode.posterUrl) }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View className="h-full w-full items-center justify-center bg-zinc-800 px-2">
            <Text className="text-center text-[10px] font-black uppercase tracking-[1.2px] text-zinc-400">
              {episode.showTitle.slice(0, 2)}
            </Text>
          </View>
        )}
      </View>

      <View className="flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-bold text-white" numberOfLines={1}>
              {episode.showTitle}
            </Text>
            <Text className="mt-0.5 text-sm text-zinc-200" numberOfLines={1}>
              {episodeTitle}
            </Text>
        </View>

        <View className={`rounded-full border px-2.5 py-1 ${accentClass}`}>
          <Text className={`text-[10px] font-black uppercase tracking-[1.1px] ${accentTextClass}`}>
            {distanceLabel}
          </Text>
        </View>
      </View>

        <View className="mt-2 flex-row flex-wrap items-center gap-2">
          <Text className="text-[10px] font-black uppercase tracking-[1.2px] text-zinc-400">
            {getEpisodeCodeLabel(episode.episode)}
          </Text>
          {airtimeLabel ? (
            <View className="rounded-full border border-[#5a3139] bg-[#241419] px-2 py-1">
              <Text className="text-[10px] font-black uppercase tracking-[1.1px] text-[#ffae9f]">
                {airtimeLabel}
              </Text>
            </View>
          ) : null}
          <View className="rounded-full border border-[#342126] bg-[#1a1316] px-2 py-1">
            <Text className="text-[10px] font-black uppercase tracking-[1.1px] text-zinc-300">
              {episode.mediaType === "anime" ? "Anime" : "TV"}
            </Text>
          </View>
          <Text className="text-xs text-zinc-500" numberOfLines={1}>
            {episode.routeId ? "Open show" : "Missing show link"}
          </Text>
        </View>
      </View>
    </View>
  );

  if (!episode.routeId) {
    return content;
  }

  return (
    <Link href={{ pathname: "/show/[id]", params: { id: episode.routeId } }} asChild>
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) =>
          pressed ? { opacity: 0.9, transform: [{ scale: 0.99 }] } : undefined
        }
      >
        {content}
      </Pressable>
    </Link>
  );
}

function UpcomingAgendaPanel({
  dateKey,
  episodes,
  todayKey,
  isWeb,
  isLoading,
}: {
  dateKey: string;
  episodes: UpcomingEpisode[];
  todayKey: string;
  isWeb: boolean;
  isLoading?: boolean;
}) {
  const date = parseLocalDate(dateKey) ?? new Date();
  const isToday = dateKey === todayKey;

  return (
    <View
      className={`overflow-hidden rounded-[28px] border border-[#5a3a44] bg-[#161014] ${
        isWeb ? "min-h-0 flex-1" : ""
      }`}
    >
      <View className="border-b border-[#2b1c22] px-5 py-4">
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1">
            <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-zinc-500">
              Selected Day
            </Text>
            <Text className="mt-2 text-2xl font-black text-white">
              {date.toLocaleDateString("en-US", { weekday: "long" })}
            </Text>
            <Text className="mt-1 text-sm text-zinc-400">
              {date.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          </View>

          <View
            className={`rounded-full border px-3 py-1.5 ${
              isToday
                ? "border-[#ff6a56]/50 bg-[#35181d]"
                : "border-[#3b2a31] bg-[#1b1418]"
            }`}
          >
            <Text
              className={`text-[10px] font-black uppercase tracking-[1.2px] ${
                isToday ? "text-[#ffb0a4]" : "text-zinc-200"
              }`}
            >
              {isLoading ? "Loading" : isToday ? "Current" : `${episodes.length} releases`}
            </Text>
          </View>
        </View>
      </View>

      {isWeb ? (
        <ScrollView
          className="min-h-0 flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
          showsVerticalScrollIndicator
        >
          {isLoading ? (
            <View className="gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <View
                  key={`agenda-loading-${index}`}
                  className="overflow-hidden rounded-[24px] border border-[#2e2026] bg-[#140f12] px-4 py-4"
                >
                  <View className="flex-row gap-4">
                    <View className="h-[88px] w-[62px] rounded-[18px] bg-[#24191e]" />
                    <View className="flex-1 justify-between">
                      <View className="h-3 w-24 rounded-full bg-[#24191e]" />
                      <View className="h-5 w-4/5 rounded-full bg-[#2b1d22]" />
                      <View className="h-3 w-2/3 rounded-full bg-[#24191e]" />
                      <View className="flex-row gap-2">
                        <View className="h-6 w-16 rounded-full bg-[#24191e]" />
                        <View className="h-6 w-20 rounded-full bg-[#1d1519]" />
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : episodes.length === 0 ? (
            <View className="items-center justify-center px-6 py-12">
              <Text className="text-base font-semibold text-white">Nothing scheduled</Text>
              <Text className="mt-2 max-w-[280px] text-center text-sm leading-6 text-zinc-400">
                Pick another day to see what is landing next.
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {episodes.map((episode, index) => (
                <UpcomingEpisodeListItem
                  key={`${dateKey}:${episode.routeId ?? episode.showTitle}:${episode.episode.seasonNumber}:${episode.episode.episodeNumber}:${index}`}
                  episode={episode}
                  isWeb={isWeb}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <>
          {isLoading ? (
            <View className="gap-3 px-4 py-4">
              {Array.from({ length: 3 }, (_, index) => (
                <View
                  key={`agenda-loading-${index}`}
                  className="overflow-hidden rounded-[24px] border border-[#2e2026] bg-[#140f12] px-4 py-4"
                >
                  <View className="flex-row gap-4">
                    <View className="h-[88px] w-[62px] rounded-[18px] bg-[#24191e]" />
                    <View className="flex-1 justify-between">
                      <View className="h-3 w-24 rounded-full bg-[#24191e]" />
                      <View className="h-5 w-4/5 rounded-full bg-[#2b1d22]" />
                      <View className="h-3 w-2/3 rounded-full bg-[#24191e]" />
                      <View className="flex-row gap-2">
                        <View className="h-6 w-16 rounded-full bg-[#24191e]" />
                        <View className="h-6 w-20 rounded-full bg-[#1d1519]" />
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : episodes.length === 0 ? (
            <View className="items-center justify-center px-6 py-12">
              <Text className="text-base font-semibold text-white">Nothing scheduled</Text>
              <Text className="mt-2 max-w-[280px] text-center text-sm leading-6 text-zinc-400">
                Pick another day to see what is landing next.
              </Text>
            </View>
          ) : (
            <View className="gap-3 px-4 py-4">
              {episodes.map((episode, index) => (
                <UpcomingEpisodeListItem
                  key={`${dateKey}:${episode.routeId ?? episode.showTitle}:${episode.episode.seasonNumber}:${episode.episode.episodeNumber}:${index}`}
                  episode={episode}
                  isWeb={isWeb}
                />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function MonthPickerModal({
  visible,
  pickerYear,
  selectedMonthDate,
  currentMonthDate,
  onClose,
  onChangeYear,
  onSelectMonth,
  onGoToCurrentMonth,
}: {
  visible: boolean;
  pickerYear: number;
  selectedMonthDate: Date;
  currentMonthDate: Date;
  onClose: () => void;
  onChangeYear: (delta: number) => void;
  onSelectMonth: (monthIndex: number) => void;
  onGoToCurrentMonth: () => void;
}) {
  const monthRows = useMemo(
    () => chunkItems(Array.from({ length: 12 }, (_, monthIndex) => monthIndex), 3),
    []
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/75 px-5 py-8">
        <Pressable className="absolute inset-0" onPress={onClose} />

        <View className="w-full max-w-xl overflow-hidden rounded-[30px] border border-[#5e3d46] bg-[#120d10]">
          <LinearGradient
            colors={["rgba(255,106,86,0.16)", "rgba(120,36,49,0.08)", "rgba(18,13,16,0.96)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
          />

          <View className="relative border-b border-[#2d1c22] px-5 pb-4 pt-5">
            <View className="flex-row items-start justify-between gap-4">
              <View className="flex-1">
                <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-zinc-500">
                  Month Picker
                </Text>
                <Text className="mt-2 text-2xl font-black text-white">Jump through the schedule</Text>
                <Text className="mt-1 text-sm text-zinc-400">
                  Pick a month directly instead of paging one step at a time.
                </Text>
              </View>

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                className="h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5"
              >
                <Ionicons name="close" size={18} color="#d4d4d8" />
              </Pressable>
            </View>
          </View>

          <View className="px-5 py-5">
            <View className="mb-5 flex-row items-center justify-between gap-3">
              <Pressable
                onPress={() => onChangeYear(-1)}
                accessibilityRole="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                  Prev Year
                </Text>
              </Pressable>

              <View className="items-center">
                <Text className="text-[10px] font-black uppercase tracking-[1.6px] text-zinc-500">
                  Browse Year
                </Text>
                <Text className="mt-1 text-3xl font-black text-white">{pickerYear}</Text>
              </View>

              <Pressable
                onPress={() => onChangeYear(1)}
                accessibilityRole="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                  Next Year
                </Text>
              </Pressable>
            </View>

            <View className="gap-3">
              {monthRows.map((row, rowIndex) => (
                <View key={`month-row-${rowIndex}`} className="flex-row gap-3">
                  {row.map((monthIndex) => {
                    const isSelected =
                      selectedMonthDate.getFullYear() === pickerYear &&
                      selectedMonthDate.getMonth() === monthIndex;
                    const isCurrent =
                      currentMonthDate.getFullYear() === pickerYear &&
                      currentMonthDate.getMonth() === monthIndex;

                    return (
                      <Pressable
                        key={`month-option-${monthIndex}`}
                        onPress={() => onSelectMonth(monthIndex)}
                        accessibilityRole="button"
                        className={`min-h-[86px] flex-1 rounded-[24px] border px-3 py-3 ${
                          isSelected
                            ? "border-[#ff745f] bg-[#2a151a]"
                            : isCurrent
                              ? "border-[#87505a] bg-[#1d1318]"
                              : "border-[#34252c] bg-[#161014]"
                        }`}
                        style={({ pressed }) => ({
                          transform: [{ scale: pressed ? 0.985 : 1 }],
                        })}
                      >
                        <Text
                          className={`text-[10px] font-black uppercase tracking-[1.5px] ${
                            isSelected ? "text-[#ffb0a4]" : "text-zinc-500"
                          }`}
                        >
                          {String(monthIndex + 1).padStart(2, "0")}
                        </Text>
                        <Text className="mt-2 text-lg font-black text-white">
                          {getMonthShortLabel(monthIndex)}
                        </Text>
                        <Text
                          className={`mt-2 text-[11px] font-bold ${
                            isSelected
                              ? "text-[#ffcabf]"
                              : isCurrent
                                ? "text-zinc-200"
                                : "text-zinc-500"
                          }`}
                        >
                          {isSelected ? "Selected month" : isCurrent ? "Current month" : "Open month"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            <View className="mt-5 flex-row items-center justify-between gap-3 rounded-[24px] border border-[#2d1c22] bg-[#171114] px-4 py-3">
              <View className="flex-1">
                <Text className="text-[10px] font-black uppercase tracking-[1.4px] text-zinc-500">
                  Quick Reset
                </Text>
                <Text className="mt-1 text-sm text-zinc-300">{getMonthTitle(currentMonthDate)}</Text>
              </View>

              <Pressable
                onPress={onGoToCurrentMonth}
                accessibilityRole="button"
                className="rounded-full border border-[#ff6a56]/45 bg-[#35181d] px-4 py-2.5"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-[#ffb0a4]">
                  Current
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WebCalendarCell({
  date,
  monthDate,
  todayKey,
  selectedDateKey,
  episodes,
  onSelectDate,
}: {
  date: Date;
  monthDate: Date;
  todayKey: string;
  selectedDateKey: string;
  episodes: UpcomingEpisode[];
  onSelectDate: (dateKey: string) => void;
}) {
  const dateKey = formatDateForApi(date);
  const isSelected = dateKey === selectedDateKey;
  const isToday = dateKey === todayKey;
  const isCurrentMonth = isSameCalendarMonth(date, monthDate);
  const previewEpisodes = episodes.slice(0, 3);

  return (
    <Pressable
      onPress={() => onSelectDate(dateKey)}
      accessibilityRole="button"
      className={`h-full min-h-[132px] rounded-[24px] border px-3 py-3 ${
        isSelected
          ? "border-[#ff745f] bg-[#2a151a]"
          : isToday
            ? "border-[#87505a] bg-[#1d1318]"
            : "border-[#34252c] bg-[#141014]"
      } ${isCurrentMonth ? "" : "opacity-45"}`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View className="flex-row items-start justify-between gap-2">
        <View>
          <Text className="text-[10px] font-black uppercase tracking-[1.5px] text-zinc-500">
            {getShortWeekdayLabel(date)}
          </Text>
          <Text className="mt-2 text-2xl font-black text-white">{date.getDate()}</Text>
        </View>
        {episodes.length > 0 ? (
          <View className="rounded-full border border-[#5a3139] bg-[#241419] px-2.5 py-1">
            <Text className="text-[10px] font-black uppercase tracking-[1.1px] text-[#ffae9f]">
              {episodes.length}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-3 gap-1.5">
        {previewEpisodes.map((episode, index) => (
          <View
            key={`${dateKey}:${episode.routeId ?? episode.showTitle}:${index}`}
            className="flex-row items-center gap-2 rounded-2xl border border-[#32232a] bg-[#1b1418] px-2 py-1.5"
          >
            <View className="h-7 w-7 overflow-hidden rounded-xl bg-zinc-800">
              {episode.posterUrl ? (
                <Image
                  source={{ uri: toHttpsImageUrl(episode.posterUrl) }}
                  className="h-full w-full"
                  resizeMode="cover"
                />
              ) : null}
            </View>
            <Text className="flex-1 text-xs font-semibold text-zinc-100" numberOfLines={1}>
              {episode.showTitle}
            </Text>
          </View>
        ))}
        {episodes.length === 0 ? (
          <View className="flex-row items-center gap-2 px-1 pt-1">
            <View className="h-2 w-2 rounded-full bg-white/20" />
            <Text className="text-[11px] font-semibold text-zinc-500">Quiet day</Text>
          </View>
        ) : null}
        {episodes.length > previewEpisodes.length ? (
          <Text className="px-1 text-[11px] font-semibold text-zinc-500">
            +{episodes.length - previewEpisodes.length} more
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function WebUpcomingCalendar({
  monthDate,
  calendarDays,
  episodesByDate,
  selectedDateKey,
  todayKey,
  onSelectDate,
  onGoToPreviousMonth,
  onGoToNextMonth,
  onGoToToday,
  onOpenMonthPicker,
  isWide,
  isLoading,
}: {
  monthDate: Date;
  calendarDays: Date[];
  episodesByDate: Map<string, UpcomingEpisode[]>;
  selectedDateKey: string;
  todayKey: string;
  onSelectDate: (dateKey: string) => void;
  onGoToPreviousMonth: () => void;
  onGoToNextMonth: () => void;
  onGoToToday: () => void;
  onOpenMonthPicker: () => void;
  isWide: boolean;
  isLoading?: boolean;
}) {
  const selectedEpisodes = episodesByDate.get(selectedDateKey) ?? [];
  const calendarWeeks = useMemo(
    () =>
      Array.from({ length: Math.ceil(calendarDays.length / 7) }, (_, index) =>
        calendarDays.slice(index * 7, index * 7 + 7)
      ),
    [calendarDays]
  );

  return (
    <View className={`min-h-0 flex-1 gap-4 ${isWide ? "flex-row" : ""}`}>
      <View
        className="min-h-0 overflow-hidden rounded-[30px] border border-[#563841] bg-[#0d090c]"
        style={isWide ? { flex: 1.85 } : undefined}
      >
        <View className="border-b border-[#2c1c22] px-5 py-4">
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1">
              <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-zinc-500">
                Month View
              </Text>
              <Pressable
                onPress={onOpenMonthPicker}
                accessibilityRole="button"
                className="mt-2 self-start rounded-full border border-[#5d3942] bg-[#181115] px-4 py-2"
                style={({ pressed }) => ({
                  opacity: pressed ? 0.92 : 1,
                })}
              >
                <View className="flex-row items-center gap-2">
                  <Text className="text-3xl font-black text-white">{getMonthTitle(monthDate)}</Text>
                  <Ionicons name="chevron-down" size={18} color="#ffb0a4" />
                </View>
              </Pressable>
            </View>

            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={onGoToPreviousMonth}
                accessibilityRole="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                  Prev
                </Text>
              </Pressable>
              <Pressable
                onPress={onGoToToday}
                accessibilityRole="button"
                className="rounded-full border border-[#ff6a56]/45 bg-[#35181d] px-3 py-2"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-[#ffb0a4]">
                  Current
                </Text>
              </Pressable>
              <Pressable
                onPress={onGoToNextMonth}
                accessibilityRole="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                  Next
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <ScrollView
          className="min-h-0 flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
          showsVerticalScrollIndicator
        >
          <View className="mb-3 flex-row">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <View key={label} className="flex-1 px-1">
                <Text className="text-center text-[10px] font-black uppercase tracking-[1.6px] text-zinc-500">
                  {label}
                </Text>
              </View>
            ))}
          </View>

          <View className="gap-0.5">
            {isLoading
              ? Array.from({ length: 6 }, (_, weekIndex) => (
                  <View key={`week-loading-${weekIndex}`} className="flex-row items-stretch">
                    {Array.from({ length: 7 }, (_, dayIndex) => (
                      <View key={`day-loading-${weekIndex}-${dayIndex}`} className="flex-1 p-1">
                        <View className="min-h-[132px] rounded-[24px] border border-[#2b1d22] bg-[#120d10] px-3 py-3">
                          <View className="flex-row items-start justify-between gap-2">
                            <View>
                              <View className="h-3 w-8 rounded-full bg-[#24191e]" />
                              <View className="mt-2 h-8 w-10 rounded-[14px] bg-[#2b1d22]" />
                            </View>
                            <View className="h-6 w-8 rounded-full bg-[#24191e]" />
                          </View>

                          <View className="mt-3 gap-1.5">
                            {Array.from({ length: 3 }, (_, previewIndex) => (
                              <View
                                key={`preview-loading-${weekIndex}-${dayIndex}-${previewIndex}`}
                                className="h-[42px] rounded-2xl border border-[#24191e] bg-[#1a1316]"
                              />
                            ))}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ))
              : calendarWeeks.map((weekDates, weekIndex) => (
                  <View key={`week-${weekIndex}`} className="flex-row items-stretch">
                    {weekDates.map((date) => {
                      const dateKey = formatDateForApi(date);
                      return (
                        <View key={dateKey} className="flex-1 p-1">
                          <WebCalendarCell
                            date={date}
                            monthDate={monthDate}
                            todayKey={todayKey}
                            selectedDateKey={selectedDateKey}
                            episodes={episodesByDate.get(dateKey) ?? []}
                            onSelectDate={onSelectDate}
                          />
                        </View>
                      );
                    })}
                  </View>
                ))}
          </View>
        </ScrollView>
      </View>

      <UpcomingAgendaPanel
        dateKey={selectedDateKey}
        episodes={selectedEpisodes}
        todayKey={todayKey}
        isWeb
        isLoading={isLoading}
      />
    </View>
  );
}

function MobileUpcomingCalendar({
  weekStart,
  selectedDateKey,
  todayKey,
  episodesByDate,
  onSelectDate,
  onGoToPreviousWeek,
  onGoToNextWeek,
  onGoToToday,
  isLoading,
}: {
  weekStart: Date;
  selectedDateKey: string;
  todayKey: string;
  episodesByDate: Map<string, UpcomingEpisode[]>;
  onSelectDate: (dateKey: string) => void;
  onGoToPreviousWeek: () => void;
  onGoToNextWeek: () => void;
  onGoToToday: () => void;
  isLoading?: boolean;
}) {
  const selectedEpisodes = episodesByDate.get(selectedDateKey) ?? [];
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysToDate(weekStart, index)),
    [weekStart]
  );

  return (
    <View className="gap-4">
      <View className="overflow-hidden rounded-[28px] border border-[#563841] bg-[#0d090c] px-4 py-4">
        <View className="mb-4 flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-zinc-500">
              Week View
            </Text>
            <Text className="mt-2 text-2xl font-black text-white">{getWeekRangeLabel(weekStart)}</Text>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={onGoToPreviousWeek}
              accessibilityRole="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
            >
              <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                Prev
              </Text>
            </Pressable>
            <Pressable
              onPress={onGoToToday}
              accessibilityRole="button"
              className="rounded-full border border-[#ff6a56]/45 bg-[#35181d] px-3 py-2"
            >
              <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-[#ffb0a4]">
                Current
              </Text>
            </Pressable>
            <Pressable
              onPress={onGoToNextWeek}
              accessibilityRole="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2"
            >
              <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
                Next
              </Text>
            </Pressable>
          </View>
        </View>

        <View className="flex-row gap-2">
          {isLoading
            ? Array.from({ length: 7 }, (_, index) => (
                <View
                  key={`mobile-day-loading-${index}`}
                  className="min-w-0 flex-1 rounded-[22px] border border-[#2b1d22] bg-[#120d10] px-1 py-3"
                >
                  <View className="mx-auto h-3 w-7 rounded-full bg-[#24191e]" />
                  <View className="mx-auto mt-2 h-8 w-8 rounded-[14px] bg-[#2b1d22]" />
                  <View className="mt-2 h-3 items-center justify-center">
                    <View className="h-2 w-2 rounded-full bg-[#24191e]" />
                  </View>
                </View>
              ))
            : weekDates.map((date) => {
                const dateKey = formatDateForApi(date);
                const isSelected = dateKey === selectedDateKey;
                const isToday = dateKey === todayKey;
                const hasEpisodes = (episodesByDate.get(dateKey)?.length ?? 0) > 0;

                return (
                  <Pressable
                    key={dateKey}
                    onPress={() => onSelectDate(dateKey)}
                    accessibilityRole="button"
                    className={`min-w-0 flex-1 rounded-[22px] border px-1 py-3 ${
                      isSelected
                        ? "border-[#ff745f] bg-[#2a151a]"
                        : isToday
                          ? "border-[#87505a] bg-[#1d1318]"
                          : "border-[#34252c] bg-[#141014]"
                    }`}
                    style={({ pressed }) => ({
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    })}
                  >
                    <Text
                      className={`text-center text-[10px] font-black uppercase tracking-[1.3px] ${
                        isSelected ? "text-[#ffb0a4]" : "text-zinc-500"
                      }`}
                    >
                      {getShortWeekdayLabel(date)}
                    </Text>
                    <Text className="mt-2 text-center text-2xl font-black text-white">
                      {date.getDate()}
                    </Text>
                    <View className="mt-2 h-3 items-center justify-center">
                      {hasEpisodes ? <View className="h-2 w-2 rounded-full bg-[#ff9d8e]" /> : null}
                    </View>
                  </Pressable>
                );
              })}
        </View>
      </View>

      <UpcomingAgendaPanel
        dateKey={selectedDateKey}
        episodes={selectedEpisodes}
        todayKey={todayKey}
        isWeb={false}
        isLoading={isLoading}
      />
    </View>
  );
}

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<HomeTab>("watchlist");
  const [mediaFilter, setMediaFilter] = useState<HomeMediaFilter>("all");
  const [watchlistVisibleCount, setWatchlistVisibleCount] = useState(0);
  const [pausedVisibleCount, setPausedVisibleCount] = useState(0);
  const [notStartedVisibleCount, setNotStartedVisibleCount] = useState(0);
  const [isLoadingMoreWatchlist, setIsLoadingMoreWatchlist] = useState(false);
  const [isHydratingInitialUpcoming, setIsHydratingInitialUpcoming] = useState(false);
  const [isMonthPickerVisible, setIsMonthPickerVisible] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => new Date().getFullYear());
  const [gridWidth, setGridWidth] = useState(0);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";

  const todayDate = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateForApi(todayDate), [todayDate]);
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => todayDate);
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const watchlistFutureStartDate = todayKey;
  const watchlistFutureEndDate = useMemo(
    () => addDaysToDateString(todayKey, WATCHLIST_FUTURE_LOOKAHEAD_DAYS),
    [todayKey]
  );
  const watchlistFutureCountsQueryKey = `${watchlistFutureStartDate}:${watchlistFutureEndDate}:${mediaFilter}`;
  const effectiveWidth = gridWidth || Math.max(width - 40, 0);
  const usesMonthCalendarLayout = isWeb && effectiveWidth >= 980;

  const hydratedRangesRef = useRef(new Set<string>());
  const watchlistLoadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relationSyncTriggeredRef = useRef(false);
  const [tmdbAiredEpisodeCountById, setTmdbAiredEpisodeCountById] = useState<
    Record<number, number>
  >({});
  const [tmdbAiredLookupFailuresById, setTmdbAiredLookupFailuresById] = useState<
    Record<number, number>
  >({});
  const [resolvedFutureCountsQueryKey, setResolvedFutureCountsQueryKey] = useState<
    string | null
  >(null);

  const currentMonthDate = useMemo(
    () => startOfMonthDate(calendarAnchorDate),
    [calendarAnchorDate]
  );
  const currentWeekStart = useMemo(
    () => startOfWeekDate(calendarAnchorDate),
    [calendarAnchorDate]
  );
  const upcomingRange = useMemo(() => {
    if (usesMonthCalendarLayout) {
      const monthStart = startOfWeekDate(startOfMonthDate(calendarAnchorDate));
      const monthEnd = endOfWeekDate(endOfMonthDate(calendarAnchorDate));
      return {
        startDate: formatDateForApi(monthStart),
        endDate: formatDateForApi(monthEnd),
        days: getInclusiveDayCount(formatDateForApi(monthStart), formatDateForApi(monthEnd)),
      };
    }

    const startDate = addDaysToDate(currentWeekStart, -7);
    const endDate = addDaysToDate(currentWeekStart, 13);
    return {
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
      days: getInclusiveDayCount(formatDateForApi(startDate), formatDateForApi(endDate)),
    };
  }, [calendarAnchorDate, currentWeekStart, usesMonthCalendarLayout]);

  // Projection-backed feed eliminates N show-doc reads.
  const watchlist = useQuery(api.shows.getHomeFeed, {});
  const upcoming = useQuery(
    api.schedule.getUpcomingSchedule,
    activeTab === "upcoming"
      ? {
          startDate: upcomingRange.startDate,
          endDate: upcomingRange.endDate,
          mediaFilter: mediaFilter === "all" ? undefined : mediaFilter,
        }
      : "skip"
  );
  const watchlistFutureUpcomingCounts = useQuery(
    api.schedule.getFutureUpcomingCountsForWatchlist,
    activeTab === "watchlist"
      ? {
          startDate: watchlistFutureStartDate,
          endDate: watchlistFutureEndDate,
          mediaFilter: mediaFilter === "all" ? undefined : mediaFilter,
        }
      : "skip"
  );
  const hydrateScheduleRange = useAction(api.schedule.hydrateScheduleRange);
  const syncTrackedAnimeRelations = useAction(api.shows.syncTrackedAnimeRelations);
  const homeSettings = useQuery(api.shows.getUserAnimeHomeSettings);
  const pausedSectionMode =
    (homeSettings?.pausedSectionMode as HomePausedSectionMode | undefined) ??
    "auto_paused_only";

  const hydrateRange = useCallback(
    async (startDate: string, days: number) => {
      const safeDays = Math.max(1, Math.min(days, 42));
      const cacheKey = `${startDate}:${safeDays}`;
      if (hydratedRangesRef.current.has(cacheKey)) {
        return;
      }

      hydratedRangesRef.current.add(cacheKey);
      try {
        await hydrateScheduleRange({
          startDate,
          days: safeDays,
        });
      } catch (error) {
        hydratedRangesRef.current.delete(cacheKey);
        throw error;
      }
    },
    [hydrateScheduleRange]
  );

  useEffect(() => {
    if (activeTab !== "upcoming") {
      return;
    }

    let cancelled = false;
    setIsHydratingInitialUpcoming(true);

    const hydrationPromise = hydrateRange(
      upcomingRange.startDate,
      upcomingRange.days
    ).catch((error) => {
      console.warn("Upcoming calendar hydration failed", error);
    });

    void Promise.race([
      hydrationPromise,
      delay(INITIAL_UPCOMING_HYDRATION_TIMEOUT_MS),
    ])
      .finally(() => {
        if (!cancelled) {
          setIsHydratingInitialUpcoming(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    hydrateRange,
    upcomingRange.days,
    upcomingRange.startDate,
  ]);

  useEffect(() => {
    if (relationSyncTriggeredRef.current) {
      return;
    }

    relationSyncTriggeredRef.current = true;
    void syncTrackedAnimeRelations({ force: false }).catch((error) => {
      console.warn("Background anime relation sync failed", error);
      // Reset the trigger so subsequent attempts can retry
      relationSyncTriggeredRef.current = false;
    });
  }, [syncTrackedAnimeRelations]);

  const watchlistItems = useMemo(() => (watchlist ?? []) as WatchlistItem[], [watchlist]);

  const futureUpcomingCountByRoute = useMemo(() => {
    const counts = new Map<string, number>();

    for (const entry of (watchlistFutureUpcomingCounts ?? []) as {
      routeId: string;
      futureCount: number;
    }[]) {
      counts.set(entry.routeId, entry.futureCount);
    }

    return counts;
  }, [watchlistFutureUpcomingCounts]);

  useEffect(() => {
    if (
      activeTab === "watchlist" &&
      watchlist !== undefined &&
      watchlistFutureUpcomingCounts !== undefined
    ) {
      setResolvedFutureCountsQueryKey(watchlistFutureCountsQueryKey);
    }
  }, [
    activeTab,
    watchlist,
    watchlistFutureCountsQueryKey,
    watchlistFutureUpcomingCounts,
  ]);

  useEffect(() => {
    if (activeTab !== "watchlist") {
      return;
    }

    const tmdbIdsToFetch = watchlistItems
      .filter(
        (item) =>
          item.mediaType === "tv" &&
          typeof item.tmdbId === "number" &&
          tmdbAiredEpisodeCountById[item.tmdbId] === undefined &&
          (tmdbAiredLookupFailuresById[item.tmdbId] ?? 0) < 3
      )
      .map((item) => item.tmdbId as number);

    if (tmdbIdsToFetch.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(tmdbIdsToFetch)).slice(0, TMDB_AIRED_LOOKUP_BATCH_SIZE);
    let isCancelled = false;

    const fetchAiredCounts = async () => {
      const updates: Record<number, number> = {};
      const failedIds: number[] = [];

      await Promise.all(
        uniqueIds.map(async (tmdbId) => {
          try {
            const details = await getTmdbShowDetails("tv", tmdbId);
            const airedEpisodes = estimateAiredEpisodesFromTmdb(details);
            if (typeof airedEpisodes === "number") {
              updates[tmdbId] = airedEpisodes;
              return;
            }
          } catch (error) {
            console.warn(`Failed to fetch aired episode count for TMDB ${tmdbId}`, error);
          }

          failedIds.push(tmdbId);
        })
      );

      if (isCancelled) {
        return;
      }

      if (Object.keys(updates).length > 0) {
        setTmdbAiredEpisodeCountById((prev) => ({
          ...prev,
          ...updates,
        }));
      }

      if (failedIds.length > 0) {
        setTmdbAiredLookupFailuresById((prev) => {
          const next = { ...prev };
          for (const tmdbId of failedIds) {
            next[tmdbId] = (next[tmdbId] ?? 0) + 1;
          }
          return next;
        });
      }
    };

    void fetchAiredCounts();

    return () => {
      isCancelled = true;
    };
  }, [
    activeTab,
    tmdbAiredEpisodeCountById,
    tmdbAiredLookupFailuresById,
    watchlistItems,
  ]);

  const filteredWatchlist = useMemo(() => {
    return watchlistItems.filter((item) => {
      const routeId = item.id;
      const futureUpcomingCount = routeId
        ? futureUpcomingCountByRoute.get(routeId) ?? 0
        : 0;
      const allRemainingEpisodesAreFuture =
        typeof item.remainingEpisodes === "number" &&
        item.remainingEpisodes > 0 &&
        futureUpcomingCount >= item.remainingEpisodes;

      if (item.status === "paused") return false;
      if (item.status === "dropped") return false;
      if (item.trackingState === "upcoming") return false;
      if (item.status === "completed") return false;
      if (item.watchedEpisodes <= 0) {
        return false;
      }
      if (allRemainingEpisodesAreFuture) {
        return false;
      }

      if (item.mediaType === "tv" && typeof item.tmdbId === "number") {
        const airedEpisodes = tmdbAiredEpisodeCountById[item.tmdbId];
        if (typeof airedEpisodes === "number") {
          const watchedEpisodes = Math.min(item.watchedEpisodes, airedEpisodes);
          const releasedRemaining = Math.max(airedEpisodes - watchedEpisodes, 0);
          if (releasedRemaining <= 0) {
            return false;
          }
        } else if (typeof item.remainingEpisodes === "number" && item.remainingEpisodes <= 0) {
          return false;
        }
      } else if (
        typeof item.remainingEpisodes === "number" &&
        item.remainingEpisodes <= 0
      ) {
        return false;
      }

      if (mediaFilter !== "all" && item.mediaType !== mediaFilter) return false;
      return true;
    });
  }, [
    futureUpcomingCountByRoute,
    mediaFilter,
    tmdbAiredEpisodeCountById,
    watchlistItems,
  ]);

  const pausedSectionWatchlist = useMemo(() => {
    return watchlistItems.filter((item) => {
      if (item.status !== "paused") {
        return false;
      }
      if (typeof item.remainingEpisodes !== "number" || item.remainingEpisodes <= 0) {
        return false;
      }
      if (typeof item.watchedEpisodes !== "number" || item.watchedEpisodes <= 0) {
        return false;
      }
      if (
        pausedSectionMode === "auto_paused_only" &&
        typeof item.autoPausedAt !== "number"
      ) {
        return false;
      }
      if (item.trackingState === "upcoming") {
        return false;
      }
      if (mediaFilter !== "all" && item.mediaType !== mediaFilter) {
        return false;
      }
      return true;
    }).sort((a, b) => {
      const autoPausedDelta = Number(Boolean(b.autoPausedAt)) - Number(Boolean(a.autoPausedAt));
      if (autoPausedDelta !== 0) {
        return autoPausedDelta;
      }

      const pausedAtDelta = (b.autoPausedAt ?? 0) - (a.autoPausedAt ?? 0);
      if (pausedAtDelta !== 0) {
        return pausedAtDelta;
      }

      return (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0);
    });
  }, [mediaFilter, pausedSectionMode, watchlistItems]);

  const notStartedSectionWatchlist = useMemo(() => {
    return watchlistItems
      .filter((item) => {
        if (item.status === "paused" || item.status === "dropped" || item.status === "completed") {
          return false;
        }
        if (item.watchedEpisodes > 0) {
          return false;
        }
        if (mediaFilter !== "all" && item.mediaType !== mediaFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
  }, [mediaFilter, watchlistItems]);

  const upcomingGroups = useMemo(() => ((upcoming ?? []) as UpcomingGroup[]), [upcoming]);
  const episodesByDate = useMemo(() => {
    const nextMap = new Map<string, UpcomingEpisode[]>();
    for (const group of upcomingGroups) {
      nextMap.set(group.date, group.episodes);
    }
    return nextMap;
  }, [upcomingGroups]);

  const columns = getColumnCount(effectiveWidth, isWeb);
  const watchlistPageSize = Math.max(columns * 3, 6);
  const secondarySectionPageSize = Math.max(columns * 2, 6);
  const isWideCalendar = usesMonthCalendarLayout && effectiveWidth >= 1180;
  const webCalendarDays = useMemo(() => {
    const gridStart = startOfWeekDate(currentMonthDate);
    const gridEnd = endOfWeekDate(endOfMonthDate(currentMonthDate));
    const visibleDayCount =
      getUtcDayIndex(gridEnd) - getUtcDayIndex(gridStart) + 1;

    return Array.from({ length: visibleDayCount }, (_, index) =>
      addDaysToDate(gridStart, index)
    );
  }, [currentMonthDate]);

  const isWatchlistLoading = watchlist === undefined;
  const hasResolvedFutureCountsForCurrentKey =
    resolvedFutureCountsQueryKey === watchlistFutureCountsQueryKey;
  const isWatchlistFutureCountsLoading =
    activeTab === "watchlist" &&
    watchlist !== undefined &&
    (!hasResolvedFutureCountsForCurrentKey ||
      watchlistFutureUpcomingCounts === undefined);
  const upcomingCount = upcomingGroups.reduce((sum, group) => sum + group.episodes.length, 0);
  const visibleWatchlistItems = useMemo(
    () => filteredWatchlist.slice(0, watchlistVisibleCount),
    [filteredWatchlist, watchlistVisibleCount]
  );
  const hasMoreWatchlist = watchlistVisibleCount < filteredWatchlist.length;
  const watchlistSkeletonCount = Math.max(columns * 2, 6);
  const watchlistSkeletonRows = useMemo(
    () => chunkItems(Array.from({ length: watchlistSkeletonCount }, (_, index) => index), columns),
    [columns, watchlistSkeletonCount]
  );
  const watchlistTailSkeletonItems = useMemo(
    () => watchlistSkeletonRows[0] ?? Array.from({ length: columns }, (_, index) => index),
    [columns, watchlistSkeletonRows]
  );
  const pendingWatchlistTmdbLookups = useMemo(
    () =>
      visibleWatchlistItems.filter(
        (item) =>
          item.mediaType === "tv" &&
          typeof item.tmdbId === "number" &&
          tmdbAiredEpisodeCountById[item.tmdbId] === undefined &&
          (tmdbAiredLookupFailuresById[item.tmdbId] ?? 0) < 3
      ).length,
    [
      tmdbAiredEpisodeCountById,
      tmdbAiredLookupFailuresById,
      visibleWatchlistItems,
    ]
  );
  const isWatchlistFilterSettling =
    activeTab === "watchlist" &&
    watchlist !== undefined &&
    (isWatchlistFutureCountsLoading || pendingWatchlistTmdbLookups > 0);
  const isWatchlistVisualLoading = isWatchlistLoading || isWatchlistFilterSettling;
  const isUpcomingContentLoading =
    activeTab === "upcoming" && (upcoming === undefined || isHydratingInitialUpcoming);
  const watchlistSettleContextKey = useMemo(() => {
    if (watchlist === undefined) {
      return "";
    }

    const itemSignature = watchlistItems
      .map((item) =>
        [
          item.mediaType,
          item.id,
          item.status,
          item.trackingState,
          item.remainingEpisodes ?? "unknown",
          item.watchedEpisodes,
          item.tmdbId ?? "no-tmdb",
        ].join(":")
      )
      .join("|");

    return `${watchlistFutureCountsQueryKey}:${itemSignature}`;
  }, [watchlist, watchlistFutureCountsQueryKey, watchlistItems]);
  const [settledWatchlistSnapshot, setSettledWatchlistSnapshot] = useState<{
    key: string;
    items: WatchlistItem[];
  }>({
    key: "",
    items: [],
  });
  const canReuseSettledWatchlist =
    settledWatchlistSnapshot.key === watchlistSettleContextKey;
  const shouldRenderFullWatchlistSkeleton =
    isWatchlistLoading ||
    (isWatchlistFilterSettling && !canReuseSettledWatchlist);

  const headerText =
    activeTab === "watchlist"
      ? { title: "Watchlist", subtitle: "Filtered by media and watch state" }
      : {
          title: "Schedule",
          subtitle: usesMonthCalendarLayout
            ? "Month grid on web with a stronger day focus and readable layers."
            : "Weekly mobile calendar with direct day picks and quick navigation.",
        };

  const watchlistCount = isWatchlistVisualLoading
    ? watchlistItems.length
    : filteredWatchlist.length + pausedSectionWatchlist.length + notStartedSectionWatchlist.length;

  useEffect(() => {
    if (activeTab !== "upcoming" || !usesMonthCalendarLayout) {
      return;
    }

    const selectedDate = parseLocalDate(selectedDateKey);
    if (selectedDate && isSameCalendarMonth(selectedDate, currentMonthDate)) {
      return;
    }

    if (isSameCalendarMonth(todayDate, currentMonthDate)) {
      if (selectedDateKey !== todayKey) {
        setSelectedDateKey(todayKey);
      }
      return;
    }

    const monthStartKey = formatDateForApi(currentMonthDate);
    if (selectedDateKey !== monthStartKey) {
      setSelectedDateKey(monthStartKey);
    }
  }, [activeTab, currentMonthDate, selectedDateKey, todayDate, todayKey, usesMonthCalendarLayout]);

  useEffect(() => {
    if (activeTab !== "upcoming" || usesMonthCalendarLayout) {
      return;
    }

    const selectedDate = parseLocalDate(selectedDateKey);
    if (!selectedDate) {
      if (selectedDateKey !== todayKey) {
        setSelectedDateKey(todayKey);
      }
      return;
    }

    if (getUtcDayIndex(startOfWeekDate(selectedDate)) !== getUtcDayIndex(currentWeekStart)) {
      setCalendarAnchorDate(selectedDate);
    }
  }, [activeTab, currentWeekStart, selectedDateKey, todayKey, usesMonthCalendarLayout]);

  useEffect(() => {
    setWatchlistVisibleCount((current) => {
      const next = Math.min(
        filteredWatchlist.length,
        Math.max(current, watchlistPageSize)
      );
      return next;
    });
    setIsLoadingMoreWatchlist(false);
  }, [filteredWatchlist.length, watchlistPageSize]);

  useEffect(() => {
    setPausedVisibleCount((current) =>
      Math.min(
        pausedSectionWatchlist.length,
        Math.max(current, secondarySectionPageSize)
      )
    );
  }, [pausedSectionWatchlist.length, secondarySectionPageSize]);

  useEffect(() => {
    setNotStartedVisibleCount((current) =>
      Math.min(
        notStartedSectionWatchlist.length,
        Math.max(current, secondarySectionPageSize)
      )
    );
  }, [notStartedSectionWatchlist.length, secondarySectionPageSize]);

  useEffect(() => {
    if (watchlist === undefined) {
      setSettledWatchlistSnapshot({
        key: "",
        items: [],
      });
      return;
    }

    if (!isWatchlistFilterSettling) {
      setSettledWatchlistSnapshot({
        key: watchlistSettleContextKey,
        items: filteredWatchlist,
      });
    }
  }, [filteredWatchlist, isWatchlistFilterSettling, watchlist, watchlistSettleContextKey]);

  useEffect(() => {
    return () => {
      if (watchlistLoadMoreTimerRef.current) {
        clearTimeout(watchlistLoadMoreTimerRef.current);
      }
    };
  }, []);

  const loadMoreWatchlist = useCallback(() => {
    if (!hasMoreWatchlist || isLoadingMoreWatchlist || isWatchlistLoading) {
      return;
    }

    setIsLoadingMoreWatchlist(true);
    watchlistLoadMoreTimerRef.current = setTimeout(() => {
      setWatchlistVisibleCount((count) =>
        Math.min(count + watchlistPageSize, filteredWatchlist.length)
      );
      setIsLoadingMoreWatchlist(false);
    }, 120);
  }, [
    filteredWatchlist.length,
    hasMoreWatchlist,
    isLoadingMoreWatchlist,
    isWatchlistLoading,
    watchlistPageSize,
  ]);
  const displayWatchlistItems = useMemo(() => {
    if (!isWatchlistFilterSettling) {
      return visibleWatchlistItems;
    }

    if (!canReuseSettledWatchlist) {
      return [];
    }

    return settledWatchlistSnapshot.items.slice(0, watchlistVisibleCount);
  }, [
    canReuseSettledWatchlist,
    isWatchlistFilterSettling,
    settledWatchlistSnapshot.items,
    visibleWatchlistItems,
    watchlistVisibleCount,
  ]);
  const displayWatchlistRows = useMemo(
    () => chunkItems(displayWatchlistItems, columns),
    [columns, displayWatchlistItems]
  );
  const visiblePausedSectionItems = useMemo(
    () => pausedSectionWatchlist.slice(0, pausedVisibleCount),
    [pausedSectionWatchlist, pausedVisibleCount]
  );
  const visibleNotStartedSectionItems = useMemo(
    () => notStartedSectionWatchlist.slice(0, notStartedVisibleCount),
    [notStartedSectionWatchlist, notStartedVisibleCount]
  );
  const hasMorePausedSection = pausedVisibleCount < pausedSectionWatchlist.length;
  const hasMoreNotStartedSection =
    notStartedVisibleCount < notStartedSectionWatchlist.length;
  const autoPausedRows = useMemo(
    () => chunkItems(visiblePausedSectionItems, columns),
    [visiblePausedSectionItems, columns]
  );
  const notStartedRows = useMemo(
    () => chunkItems(visibleNotStartedSectionItems, columns),
    [visibleNotStartedSectionItems, columns]
  );

  const goToTodayCalendar = useCallback(() => {
    setCalendarAnchorDate(todayDate);
    setSelectedDateKey(todayKey);
  }, [todayDate, todayKey]);

  const openMonthPicker = useCallback(() => {
    setMonthPickerYear(currentMonthDate.getFullYear());
    setIsMonthPickerVisible(true);
  }, [currentMonthDate]);

  const closeMonthPicker = useCallback(() => {
    setIsMonthPickerVisible(false);
  }, []);

  const shiftMonthPickerYear = useCallback((delta: number) => {
    setMonthPickerYear((current) => current + delta);
  }, []);

  const selectMonthFromPicker = useCallback((monthIndex: number) => {
    const nextMonthDate = new Date(monthPickerYear, monthIndex, 1);
    setCalendarAnchorDate(nextMonthDate);
    setSelectedDateKey(formatDateForApi(nextMonthDate));
    setIsMonthPickerVisible(false);
  }, [monthPickerYear]);

  const goToCurrentMonthFromPicker = useCallback(() => {
    setMonthPickerYear(todayDate.getFullYear());
    setCalendarAnchorDate(todayDate);
    setSelectedDateKey(todayKey);
    setIsMonthPickerVisible(false);
  }, [todayDate, todayKey]);

  const goToPreviousMonth = useCallback(() => {
    setCalendarAnchorDate((current) => addMonthsToDate(startOfMonthDate(current), -1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCalendarAnchorDate((current) => addMonthsToDate(startOfMonthDate(current), 1));
  }, []);

  const goToPreviousWeek = useCallback(() => {
    setCalendarAnchorDate((current) => addDaysToDate(startOfWeekDate(current), -7));
    setSelectedDateKey((current) => addDaysToDateString(current, -7));
  }, []);

  const goToNextWeek = useCallback(() => {
    setCalendarAnchorDate((current) => addDaysToDate(startOfWeekDate(current), 7));
    setSelectedDateKey((current) => addDaysToDateString(current, 7));
  }, []);

  const handleSelectCalendarDate = useCallback(
    (dateKey: string) => {
      const selectedDate = parseLocalDate(dateKey);
      if (
        selectedDate &&
        usesMonthCalendarLayout &&
        !isSameCalendarMonth(selectedDate, currentMonthDate)
      ) {
        setCalendarAnchorDate(selectedDate);
      }

      setSelectedDateKey(dateKey);
    },
    [currentMonthDate, usesMonthCalendarLayout]
  );

  const renderWatchlistItem = useCallback<ListRenderItem<WatchlistItem>>(
    ({ item, index }) => {
      const columnIndex = index % columns;
      const halfGap = GRID_GAP / 2;

      return (
        <View
          style={{
            flex: 1,
            paddingLeft: columnIndex === 0 ? 0 : halfGap,
            paddingRight: columnIndex === columns - 1 ? 0 : halfGap,
          }}
        >
          <WatchlistCard item={item} isWeb={isWeb} />
        </View>
      );
    },
    [columns, isWeb]
  );

  const watchlistHeader = (
    <View className="pb-4">
      <PageIntro
        title={headerText.title}
        subtitle={headerText.subtitle}
        eyebrow="Today"
        icon="sparkles-outline"
        rightLabel={`${watchlistCount} matched`}
        className="mb-4"
      />

      <SegmentedControl
        className="mb-3"
        options={[
          { value: "watchlist", label: "Watchlist" },
          { value: "upcoming", label: "Schedule" },
        ]}
        value={activeTab}
        onValueChange={(value: HomeTab) => setActiveTab(value)}
      />

      <SegmentedControl
        className="mb-3"
        options={[
          { value: "all", label: "All" },
          { value: "tv", label: "TV Shows" },
          { value: "anime", label: "Anime" },
        ]}
        value={mediaFilter}
        onValueChange={(value: HomeMediaFilter) => setMediaFilter(value)}
      />

      {!isWatchlistVisualLoading &&
      filteredWatchlist.length === 0 &&
      pausedSectionWatchlist.length === 0 &&
      notStartedSectionWatchlist.length === 0 ? (
        <View className="mt-6 items-center rounded-xl border-2 border-border-default bg-bg-surface px-6 py-12">
          <Text className="text-lg font-semibold text-text-primary">
            No active shows
          </Text>
          <Text className="mt-1 text-center text-sm text-text-secondary">
            Start tracking shows to see them here.
          </Text>
        </View>
      ) : null}
    </View>
  );

  const autoPausedSection =
    !isWatchlistVisualLoading && pausedSectionWatchlist.length > 0 ? (
      <View className="mt-6 overflow-hidden rounded-[28px] border border-[#4d3831] bg-[#120f0f]">
        <LinearGradient
          colors={["rgba(251,191,36,0.12)", "rgba(120,53,15,0.08)", "rgba(18,15,15,0.98)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <View className="border-b border-[#382921] px-5 py-4">
          <View className="flex-row items-start justify-between gap-4">
            <View className="flex-1">
              <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-amber-200/70">
                {pausedSectionMode === "all_paused"
                  ? "Paused Queue"
                  : "Haven't Watched In A While"}
              </Text>
              <Text className="mt-2 text-2xl font-black text-white">
                {pausedSectionMode === "all_paused" ? "Paused" : "Auto-paused"}
              </Text>
              <Text className="mt-1 text-sm text-zinc-400">
                {pausedSectionMode === "all_paused"
                  ? "Everything you've paused, including titles snoozed automatically."
                  : "Shows you were following that got snoozed after inactivity."}
              </Text>
            </View>

            <View className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1.5">
              <Text className="text-[10px] font-black uppercase tracking-[1.2px] text-amber-100">
                {pausedSectionWatchlist.length} paused
              </Text>
            </View>
          </View>
        </View>

        <View className="px-4 py-4">
          <View className="gap-3">
            {autoPausedRows.map((row, rowIndex) => (
              <View key={`auto-paused-row-${rowIndex}`} className="flex-row gap-3">
                {row.map((item) => (
                  <View key={`auto-paused-${item.mediaType}-${item.id}`} style={{ flex: 1 / columns }}>
                    <WatchlistCard item={item} isWeb={isWeb} />
                  </View>
                ))}
                {row.length < columns
                  ? Array.from({ length: columns - row.length }, (_, fillerIndex) => (
                      <View
                        key={`auto-paused-row-${rowIndex}-filler-${fillerIndex}`}
                        style={{ flex: 1 / columns }}
                      />
                    ))
                  : null}
              </View>
            ))}
          </View>
          {hasMorePausedSection ? (
            <View className="items-center pt-4">
              <Pressable
                accessibilityRole="button"
                className="rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2.5"
                onPress={() =>
                  setPausedVisibleCount((count) =>
                    Math.min(
                      count + secondarySectionPageSize,
                      pausedSectionWatchlist.length
                    )
                  )
                }
                style={({ pressed }) => ({
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-amber-100">
                  Show more
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    ) : null;

  const notStartedSection =
    !isWatchlistVisualLoading && notStartedSectionWatchlist.length > 0 ? (
      <View className="mt-6 overflow-hidden rounded-[28px] border border-[#243744] bg-[#0c1216]">
        <LinearGradient
          colors={["rgba(56,189,248,0.12)", "rgba(14,116,144,0.08)", "rgba(12,18,22,0.98)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
        <View className="border-b border-[#20313c] px-5 py-4">
          <View className="flex-row items-start justify-between gap-4">
            <View className="flex-1">
              <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-sky-200/70">
                In Your Backlog
              </Text>
              <Text className="mt-2 text-2xl font-black text-white">Haven&apos;t started</Text>
              <Text className="mt-1 text-sm text-zinc-400">
                Shows you&apos;ve added but haven&apos;t watched yet.
              </Text>
            </View>

            <View className="rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1.5">
              <Text className="text-[10px] font-black uppercase tracking-[1.2px] text-sky-100">
                {notStartedSectionWatchlist.length} queued
              </Text>
            </View>
          </View>
        </View>

        <View className="px-4 py-4">
          <View className="gap-3">
            {notStartedRows.map((row, rowIndex) => (
              <View key={`not-started-row-${rowIndex}`} className="flex-row gap-3">
                {row.map((item) => (
                  <View key={`not-started-${item.mediaType}-${item.id}`} style={{ flex: 1 / columns }}>
                    <WatchlistCard item={item} isWeb={isWeb} />
                  </View>
                ))}
                {row.length < columns
                  ? Array.from({ length: columns - row.length }, (_, fillerIndex) => (
                      <View
                        key={`not-started-row-${rowIndex}-filler-${fillerIndex}`}
                        style={{ flex: 1 / columns }}
                      />
                    ))
                  : null}
              </View>
            ))}
          </View>
          {hasMoreNotStartedSection ? (
            <View className="items-center pt-4">
              <Pressable
                accessibilityRole="button"
                className="rounded-full border border-sky-300/20 bg-sky-400/10 px-4 py-2.5"
                onPress={() =>
                  setNotStartedVisibleCount((count) =>
                    Math.min(
                      count + secondarySectionPageSize,
                      notStartedSectionWatchlist.length
                    )
                  )
                }
                style={({ pressed }) => ({
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-sky-100">
                  Show more
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    ) : null;

  const watchlistFooter =
    !isWatchlistVisualLoading && hasMoreWatchlist ? (
      <View className="items-center py-4">
        <Pressable
          accessibilityRole="button"
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5"
          disabled={isLoadingMoreWatchlist}
          onPress={loadMoreWatchlist}
          style={({ pressed }) => ({
            opacity: isLoadingMoreWatchlist ? 0.7 : pressed ? 0.9 : 1,
          })}
        >
          {isLoadingMoreWatchlist ? (
            <ActivityIndicator size="small" color="#ef4444" />
          ) : (
            <Text className="text-[11px] font-black uppercase tracking-[1.2px] text-zinc-200">
              Load more
            </Text>
          )}
        </Pressable>
      </View>
    ) : null;
  const watchlistSettlingFooter =
    !isWatchlistLoading && isWatchlistFilterSettling ? (
      <View className="gap-3 pt-3">
        <View key="watchlist-skeleton-row-0" className="flex-row gap-3">
          {watchlistTailSkeletonItems.map((item) => (
            <View key={`watchlist-skeleton-${item}`} style={{ flex: 1 / columns }}>
              <WatchlistCardSkeleton isWeb={isWeb} />
            </View>
          ))}
        </View>
      </View>
    ) : null;

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
        {gridWidth > 0 ? (
          activeTab === "watchlist" ? (
            shouldRenderFullWatchlistSkeleton ? (
              <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
              >
                {watchlistHeader}

                <View className="gap-3">
                  {watchlistSkeletonRows.map((row, rowIndex) => (
                    <View key={`watchlist-skeleton-row-${rowIndex}`} className="flex-row gap-3">
                      {row.map((item) => (
                        <View key={`watchlist-skeleton-${item}`} style={{ flex: 1 / columns }}>
                          <WatchlistCardSkeleton isWeb={isWeb} />
                        </View>
                      ))}
                      {row.length < columns
                        ? Array.from({ length: columns - row.length }, (_, fillerIndex) => (
                            <View
                              key={`watchlist-skeleton-row-${rowIndex}-filler-${fillerIndex}`}
                              style={{ flex: 1 / columns }}
                            />
                          ))
                        : null}
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : isWeb ? (
              <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
              >
                {watchlistHeader}

                <View className="gap-3">
                  {displayWatchlistRows.map((row, rowIndex) => (
                    <View key={`watchlist-row-${rowIndex}`} className="flex-row gap-3">
                      {row.map((item) => (
                        <View
                          key={`${item.mediaType}-${item.id}`}
                          style={{ flex: 1 / columns }}
                        >
                          <WatchlistCard item={item} isWeb />
                        </View>
                      ))}
                      {row.length < columns
                        ? Array.from({ length: columns - row.length }, (_, fillerIndex) => (
                            isWatchlistFilterSettling &&
                            rowIndex === displayWatchlistRows.length - 1 ? (
                              <View
                                key={`watchlist-skeleton-${watchlistTailSkeletonItems[fillerIndex]}`}
                                style={{ flex: 1 / columns }}
                              >
                                <WatchlistCardSkeleton isWeb />
                              </View>
                            ) : (
                              <View
                                key={`watchlist-row-${rowIndex}-filler-${fillerIndex}`}
                                style={{ flex: 1 / columns }}
                              />
                            )
                          ))
                        : null}
                    </View>
                  ))}
                  {isWatchlistFilterSettling &&
                  (displayWatchlistRows.length === 0 ||
                    displayWatchlistRows[displayWatchlistRows.length - 1]?.length === columns) ? (
                    <View key="watchlist-skeleton-row-0" className="flex-row gap-3">
                      {watchlistTailSkeletonItems.map((item) => (
                        <View key={`watchlist-skeleton-${item}`} style={{ flex: 1 / columns }}>
                          <WatchlistCardSkeleton isWeb />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>

                {autoPausedSection}
                {notStartedSection}

                {watchlistFooter}
              </ScrollView>
            ) : (
              <FlashList
                key={`watchlist-${columns}`}
                data={displayWatchlistItems}
                keyExtractor={(item: WatchlistItem) => `${item.mediaType}-${item.id}`}
                renderItem={renderWatchlistItem}
                numColumns={columns}
                ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
                onEndReached={loadMoreWatchlist}
                onEndReachedThreshold={0.4}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                ListHeaderComponent={watchlistHeader}
                ListFooterComponent={
                  <>
                    {autoPausedSection}
                    {notStartedSection}
                    {isWatchlistFilterSettling ? watchlistSettlingFooter : watchlistFooter}
                  </>
                }
              />
            )
          ) : (
            <View className="flex-1">
              <View className="pb-3">
                <PageIntro
                  title={headerText.title}
                  subtitle={headerText.subtitle}
                  eyebrow="Calendar"
                  icon="calendar-outline"
                  rightLabel={`${upcomingCount} episodes`}
                  className="mb-4"
                />

                <SegmentedControl
                  className="mb-3"
                  options={[
                    { value: "watchlist", label: "Watchlist" },
                    { value: "upcoming", label: "Schedule" },
                  ]}
                  value={activeTab}
                  onValueChange={(value: HomeTab) => setActiveTab(value)}
                />

                <SegmentedControl
                  options={[
                    { value: "all", label: "All" },
                    { value: "tv", label: "TV Shows" },
                    { value: "anime", label: "Anime" },
                  ]}
                  value={mediaFilter}
                  onValueChange={(value: HomeMediaFilter) => setMediaFilter(value)}
                />

              </View>

              <View className="min-h-0 flex-1 pb-4">
                {usesMonthCalendarLayout ? (
                  <WebUpcomingCalendar
                    monthDate={currentMonthDate}
                    calendarDays={webCalendarDays}
                    episodesByDate={episodesByDate}
                    selectedDateKey={selectedDateKey}
                    todayKey={todayKey}
                    onSelectDate={(dateKey) => handleSelectCalendarDate(dateKey)}
                    onGoToPreviousMonth={goToPreviousMonth}
                    onGoToNextMonth={goToNextMonth}
                    onGoToToday={goToTodayCalendar}
                    onOpenMonthPicker={openMonthPicker}
                    isWide={isWideCalendar}
                    isLoading={isUpcomingContentLoading}
                  />
                ) : (
                  <ScrollView
                    className="min-h-0 flex-1"
                    contentContainerStyle={{ paddingBottom: 16 }}
                    showsVerticalScrollIndicator={false}
                  >
                    <MobileUpcomingCalendar
                      weekStart={currentWeekStart}
                      selectedDateKey={selectedDateKey}
                      todayKey={todayKey}
                      episodesByDate={episodesByDate}
                      onSelectDate={handleSelectCalendarDate}
                      onGoToPreviousWeek={goToPreviousWeek}
                      onGoToNextWeek={goToNextWeek}
                      onGoToToday={goToTodayCalendar}
                      isLoading={isUpcomingContentLoading}
                    />
                  </ScrollView>
                )}
              </View>
            </View>
          )
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="#ef4444" />
          </View>
        )}
      </View>

      <MonthPickerModal
        visible={isMonthPickerVisible}
        pickerYear={monthPickerYear}
        selectedMonthDate={currentMonthDate}
        currentMonthDate={todayDate}
        onClose={closeMonthPicker}
        onChangeYear={shiftMonthPickerYear}
        onSelectMonth={selectMonthFromPicker}
        onGoToCurrentMonth={goToCurrentMonthFromPicker}
      />
    </ScreenWrapper>
  );
}

export { HomeScreen as default };
