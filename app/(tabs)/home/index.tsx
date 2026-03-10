import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useAction, useQuery } from "convex/react";
import { FlashList } from "@shopify/flash-list";
import { api } from "@/convex/_generated/api";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SegmentedControl } from "@/components/SegmentedControl";
import { getTmdbShowDetails, type TmdbShowDetails } from "@/lib/api/tmdb";
import type { MediaType } from "@/lib/api/types";
import { toHttpsImageUrl } from "@/lib/image-url";

type HomeTab = "watchlist" | "upcoming";
type HomeMediaFilter = "all" | "tv" | "anime";

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
const WATCHLIST_FUTURE_FALLBACK_DAYS = 14;

function estimateAiredEpisodesFromTmdb(details: TmdbShowDetails) {
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    0,
    0,
    0,
    0
  );

  const parseEpisodeAirDate = (airDate?: string | null) => {
    if (!airDate) {
      return null;
    }

    const parsedLocal = parseLocalDate(airDate.slice(0, 10));
    if (parsedLocal) {
      return parsedLocal;
    }

    const parsed = new Date(airDate);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
  };

  const isFutureEpisode = (airDate?: string | null) => {
    const parsed = parseEpisodeAirDate(airDate);
    if (!parsed) {
      return false;
    }
    return parsed.getTime() > startOfToday.getTime();
  };

  const nonSpecialSeasons = (details.seasons ?? []).filter(
    (season) => season.season_number >= 1
  );

  const getEpisodeOffset = (seasonNumber: number, episodeNumber: number) => {
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
    typeof nextEpisode.episode_number === "number" &&
    isFutureEpisode(nextEpisode.air_date)
  ) {
    const airedBeforeNext = getEpisodeOffset(
      nextEpisode.season_number,
      nextEpisode.episode_number - 1
    );

    if (airedBeforeNext > 0) {
      return airedBeforeNext;
    }
  }

  const lastEpisode = details.last_episode_to_air;
  const lastSeasonNumber = lastEpisode?.season_number;
  const lastEpisodeNumber = lastEpisode?.episode_number;
  if (
    typeof lastSeasonNumber === "number" &&
    typeof lastEpisodeNumber === "number"
  ) {
    if (nonSpecialSeasons.length === 0) {
      const adjustedEpisodeNumber = isFutureEpisode(lastEpisode?.air_date)
        ? lastEpisodeNumber - 1
        : lastEpisodeNumber;
      return Math.max(adjustedEpisodeNumber, 0);
    }

    const adjustedEpisodeNumber = isFutureEpisode(lastEpisode?.air_date)
      ? lastEpisodeNumber - 1
      : lastEpisodeNumber;
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
  const watchedPercent =
    item.totalEpisodes && item.totalEpisodes > 0
      ? Math.round((item.watchedEpisodes / item.totalEpisodes) * 100)
      : null;
  const cornerLabel =
    item.remainingEpisodes === null
      ? item.trackingState === "tba"
        ? "TBA"
        : "Upcoming"
      : `${item.remainingEpisodes} left`;
  const progressLabel =
    item.totalEpisodes === null
      ? item.watchedEpisodes > 0
        ? `${item.watchedEpisodes} watched`
        : "Not started"
      : `${item.watchedEpisodes}/${item.totalEpisodes} episodes`;
  const statusLabel = item.status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

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
              {statusLabel}
            </Text>
            {item.isAutoTracked ? (
              <Text className="rounded-sm border border-red-400/40 bg-red-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-red-100">
                Auto
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

function UpcomingEpisodeListItem({
  episode,
  isWeb,
}: {
  episode: UpcomingEpisode;
  isWeb: boolean;
}) {
  const distanceLabel = getUpcomingDistanceLabel(episode.daysUntil);
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
}: {
  dateKey: string;
  episodes: UpcomingEpisode[];
  todayKey: string;
  isWeb: boolean;
}) {
  const date = parseLocalDate(dateKey) ?? new Date();
  const isToday = dateKey === todayKey;

  return (
    <View
      className={`overflow-hidden rounded-[28px] border border-[#5a3a44] bg-[#161014] ${
        isWeb ? "flex-1" : ""
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
              {isToday ? "Current" : `${episodes.length} releases`}
            </Text>
          </View>
        </View>
      </View>

      {episodes.length === 0 ? (
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
    </View>
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
  isWide,
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
  isWide: boolean;
}) {
  const selectedEpisodes = episodesByDate.get(selectedDateKey) ?? [];
  const calendarWeeks = useMemo(
    () => Array.from({ length: Math.ceil(calendarDays.length / 7) }, (_, index) => calendarDays.slice(index * 7, index * 7 + 7)),
    [calendarDays]
  );

  return (
    <View className={`gap-4 ${isWide ? "flex-row" : ""}`}>
      <View
        className="overflow-hidden rounded-[30px] border border-[#563841] bg-[#0d090c]"
        style={isWide ? { flex: 1.85 } : undefined}
      >
        <View className="border-b border-[#2c1c22] px-5 py-4">
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1">
              <Text className="text-[10px] font-black uppercase tracking-[1.8px] text-zinc-500">
                Month View
              </Text>
              <Text className="mt-2 text-3xl font-black text-white">{getMonthTitle(monthDate)}</Text>
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

        <View className="px-4 pb-4 pt-3">
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
            {calendarWeeks.map((weekDates, weekIndex) => (
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
        </View>
      </View>

      <UpcomingAgendaPanel
        dateKey={selectedDateKey}
        episodes={selectedEpisodes}
        todayKey={todayKey}
        isWeb
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
}: {
  weekStart: Date;
  selectedDateKey: string;
  todayKey: string;
  episodesByDate: Map<string, UpcomingEpisode[]>;
  onSelectDate: (dateKey: string) => void;
  onGoToPreviousWeek: () => void;
  onGoToNextWeek: () => void;
  onGoToToday: () => void;
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
          {weekDates.map((date) => {
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
      />
    </View>
  );
}

export function HomeScreen() {
  const [activeTab, setActiveTab] = useState<HomeTab>("watchlist");
  const [mediaFilter, setMediaFilter] = useState<HomeMediaFilter>("all");
  const [watchlistVisibleCount, setWatchlistVisibleCount] = useState(0);
  const [isLoadingMoreWatchlist, setIsLoadingMoreWatchlist] = useState(false);
  const [isHydratingInitialUpcoming, setIsHydratingInitialUpcoming] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";

  const todayDate = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateForApi(todayDate), [todayDate]);
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => todayDate);
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const watchlistFutureStartDate = todayKey;
  const watchlistFutureEndDate = useMemo(
    () => addDaysToDateString(todayKey, WATCHLIST_FUTURE_FALLBACK_DAYS),
    [todayKey]
  );
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
  const watchlistFutureUpcoming = useQuery(
    api.schedule.getUpcomingSchedule,
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

  const watchlistFutureUpcomingGroups = useMemo(
    () => (watchlistFutureUpcoming ?? []) as UpcomingGroup[],
    [watchlistFutureUpcoming]
  );

  const futureUpcomingCountByRoute = useMemo(() => {
    const counts = new Map<string, number>();

    for (const group of watchlistFutureUpcomingGroups) {
      for (const entry of group.episodes) {
        if (!entry.routeId || entry.daysUntil <= 0) {
          continue;
        }
        counts.set(entry.routeId, (counts.get(entry.routeId) ?? 0) + 1);
      }
    }

    return counts;
  }, [watchlistFutureUpcomingGroups]);

  useEffect(() => {
    if (activeTab !== "watchlist") {
      return;
    }

    const tmdbIdsToFetch = watchlistItems
      .filter(
        (item) =>
          item.mediaType === "tv" &&
          typeof item.tmdbId === "number" &&
          item.remainingEpisodes !== null &&
          item.remainingEpisodes > 0 &&
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
      if (item.status === "paused") return false;
      if (item.status === "dropped") return false;
      if (item.status === "completed") return false;
      if (item.trackingState === "upcoming") return false;
      if (typeof item.remainingEpisodes === "number" && item.remainingEpisodes <= 0) {
        return false;
      }

      if (item.mediaType === "tv" && typeof item.tmdbId === "number") {
        const airedEpisodes = tmdbAiredEpisodeCountById[item.tmdbId];
        if (typeof airedEpisodes === "number") {
          const releasedRemaining = Math.max(airedEpisodes - item.watchedEpisodes, 0);
          if (releasedRemaining <= 0) {
            return false;
          }
        } else if (typeof item.remainingEpisodes === "number" && item.remainingEpisodes > 0) {
          const routeId = getWatchlistRouteId(item);
          if (routeId) {
            const futureUpcomingCount = futureUpcomingCountByRoute.get(routeId) ?? 0;
            if (futureUpcomingCount >= item.remainingEpisodes) {
              return false;
            }
          }
        }
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
  const isWideCalendar = usesMonthCalendarLayout && effectiveWidth >= 1180;
  const webCalendarDays = useMemo(() => {
    const gridStart = startOfWeekDate(currentMonthDate);
    return Array.from({ length: 42 }, (_, index) => addDaysToDate(gridStart, index));
  }, [currentMonthDate]);

  const isWatchlistLoading = watchlist === undefined;
  const isUpcomingLoading =
    activeTab === "upcoming" && (upcoming === undefined || isHydratingInitialUpcoming);

  const headerText =
    activeTab === "watchlist"
      ? { title: "Watchlist", subtitle: "Filtered by media and watch state" }
      : {
          title: "Schedule",
          subtitle: usesMonthCalendarLayout
            ? "Month grid on web with a stronger day focus and readable layers."
            : "Weekly mobile calendar with direct day picks and quick navigation.",
        };

  const watchlistCount = filteredWatchlist.length;
  const upcomingCount = upcomingGroups.reduce((sum, group) => sum + group.episodes.length, 0);
  const visibleWatchlistItems = useMemo(
    () => filteredWatchlist.slice(0, watchlistVisibleCount),
    [filteredWatchlist, watchlistVisibleCount]
  );
  const hasMoreWatchlist = watchlistVisibleCount < filteredWatchlist.length;

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

  const goToTodayCalendar = useCallback(() => {
    setCalendarAnchorDate(todayDate);
    setSelectedDateKey(todayKey);
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

  const renderWatchlistItem = useCallback(
    ({ item, index }: { item: WatchlistItem; index: number }) => {
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

  return (
    <ScreenWrapper>
      <View className="flex-1" onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
        {gridWidth > 0 ? (
          activeTab === "watchlist" ? (
            <FlashList
              key={`watchlist-${columns}`}
              data={visibleWatchlistItems}
              keyExtractor={(item: WatchlistItem) => `${item.mediaType}-${item.id}`}
              renderItem={renderWatchlistItem as any}
              numColumns={columns}
              ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
              onEndReached={loadMoreWatchlist}
              onEndReachedThreshold={0.4}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListHeaderComponent={
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

                  {isWatchlistLoading ? (
                    <View className="mt-6 items-center py-10">
                      <ActivityIndicator size="small" color="#ef4444" />
                    </View>
                  ) : null}

                  {!isWatchlistLoading && filteredWatchlist.length === 0 ? (
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
              }
              ListFooterComponent={
                !isWatchlistLoading && hasMoreWatchlist ? (
                  <View className="items-center py-4">
                    <ActivityIndicator
                      size="small"
                      color={isLoadingMoreWatchlist ? "#ef4444" : "#52525b"}
                    />
                  </View>
                ) : null
              }
            />
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
                {isUpcomingLoading ? (
                  <View className="flex-1 items-center justify-center rounded-[28px] border border-[#563841] bg-[#0d090c]">
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="mt-3 text-sm text-zinc-400">Loading calendar...</Text>
                  </View>
                ) : (
                  <ScrollView
                    className="min-h-0 flex-1"
                    contentContainerStyle={{ paddingBottom: 16 }}
                    showsVerticalScrollIndicator={isWeb}
                  >
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
                        isWide={isWideCalendar}
                      />
                    ) : (
                      <MobileUpcomingCalendar
                        weekStart={currentWeekStart}
                        selectedDateKey={selectedDateKey}
                        todayKey={todayKey}
                        episodesByDate={episodesByDate}
                        onSelectDate={handleSelectCalendarDate}
                        onGoToPreviousWeek={goToPreviousWeek}
                        onGoToNextWeek={goToNextWeek}
                        onGoToToday={goToTodayCalendar}
                      />
                    )}
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
    </ScreenWrapper>
  );
}

export { HomeScreen as default };
