import type { MediaType } from "@/lib/api/types";

export type ImportWatchStatus =
  | "watching"
  | "paused"
  | "dropped"
  | "completed"
  | "plan_to_watch";

export type ParsedImportEpisode = {
  season: number;
  episode: number;
  watchedAt?: number;
  watchCount?: number;
  watchHistory?: number[];
};

export type ParsedImportItem = {
  title: string;
  mediaType: MediaType;
  firstAiredYear?: number;
  tvdbId?: number;
  tmdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  imdbId?: string;
  status: ImportWatchStatus;
  watchedEpisodes: ParsedImportEpisode[];
};

const MAX_VISIT_NODES = 12000;
const ITEM_SIGNAL_KEYS = [
  "status",
  "watchStatus",
  "watch_status",
  "state",
  "watchedEpisodes",
  "watched_episodes",
  "watchedEpisodesCount",
  "watched_episodes_count",
  "episodesWatched",
  "is_watched",
  "seen_episodes",
  "progress",
  "seasons",
  "id",
  "tvdbId",
  "tvdb_id",
  "tmdbId",
  "tmdb_id",
  "anilistId",
  "anilist_id",
  "malId",
  "mal_id",
  "tvmazeId",
  "tvmaze_id",
  "imdbId",
  "imdb_id",
  "mediaType",
  "media_type",
  "type",
  "kind",
  "format",
];

const STATUS_PRIORITY: Record<ImportWatchStatus, number> = {
  plan_to_watch: 1,
  watching: 2,
  paused: 3,
  dropped: 4,
  completed: 5,
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = normalizeNumber(record[key]);
    if (typeof parsed === "number") {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value > 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (
        ["true", "yes", "y", "1", "watched", "done", "finished"].includes(normalized)
      ) {
        return true;
      }
      if (["false", "no", "n", "0"].includes(normalized)) {
        return false;
      }
    }
  }
  return undefined;
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => key in record);
}

function normalizeTitleForKey(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, " ");
}

function isLikelyEpisodeTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (
    /^((episode|ep|season|s)\s*[:#-]?\s*\d+)/i.test(normalized) ||
    /^\d+x\d+$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function parseYear(value?: string) {
  if (!value) {
    return undefined;
  }
  const match = value.match(/(19|20)\d{2}/);
  if (!match) {
    return undefined;
  }
  const year = Number.parseInt(match[0], 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return undefined;
  }
  return year;
}

function toEpisodeHistory(episode: ParsedImportEpisode) {
  if (Array.isArray(episode.watchHistory) && episode.watchHistory.length > 0) {
    return episode.watchHistory.filter(
      (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
    );
  }
  if (typeof episode.watchedAt === "number" && Number.isFinite(episode.watchedAt)) {
    return [episode.watchedAt];
  }
  return [];
}

function toEpisodeWatchCount(episode: ParsedImportEpisode, history: number[]) {
  const explicitCount =
    typeof episode.watchCount === "number" && Number.isFinite(episode.watchCount)
      ? Math.floor(episode.watchCount)
      : undefined;
  if (typeof explicitCount === "number" && explicitCount > 0) {
    return explicitCount;
  }
  if (history.length > 0) {
    return history.length;
  }
  return 1;
}

function mergeEpisodeEntries(existing: ParsedImportEpisode, incoming: ParsedImportEpisode) {
  const existingHistory = toEpisodeHistory(existing);
  const incomingHistory = toEpisodeHistory(incoming);
  const mergedHistory = [...existingHistory, ...incomingHistory];

  const existingCount = toEpisodeWatchCount(existing, existingHistory);
  const incomingCount = toEpisodeWatchCount(incoming, incomingHistory);
  const watchCount = existingCount + incomingCount;

  const latestWatchedAt = mergedHistory.length > 0 ? mergedHistory[mergedHistory.length - 1] : undefined;
  const watchedAtCandidates = [existing.watchedAt, incoming.watchedAt, latestWatchedAt].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  const watchedAt =
    watchedAtCandidates.length > 0
      ? watchedAtCandidates.reduce((max, value) => (value > max ? value : max), watchedAtCandidates[0])
      : undefined;

  return {
    season: existing.season,
    episode: existing.episode,
    watchedAt,
    watchCount: watchCount > 1 ? watchCount : undefined,
    watchHistory: mergedHistory.length > 1 ? mergedHistory : undefined,
  };
}

function normalizeIdNumber(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function normalizeExternalStringId(value?: string) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized === "-1" || normalized === "0") {
    return undefined;
  }
  return normalized;
}

function toRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry);
}

function readNestedString(
  record: Record<string, unknown>,
  key: string,
  nestedKeys: string[]
) {
  const nested = toRecord(record[key]);
  if (!nested) {
    return undefined;
  }
  return readString(nested, nestedKeys);
}

function readNestedNumber(
  record: Record<string, unknown>,
  key: string,
  nestedKeys: string[]
) {
  const nested = toRecord(record[key]);
  if (!nested) {
    return undefined;
  }
  return readNumber(nested, nestedKeys);
}

function normalizeStatus(input?: string, hasWatchedEpisodes?: boolean): ImportWatchStatus {
  const value = input?.trim().toLowerCase() ?? "";
  if (
    [
      "watching",
      "current",
      "active",
      "following",
      "in_progress",
      "continuing",
      "up_to_date",
      "up to date",
    ].includes(value)
  ) {
    return "watching";
  }
  if (["paused", "on hold", "on_hold"].includes(value)) {
    return "paused";
  }
  if (["dropped", "abandoned", "quit", "stopped"].includes(value)) {
    return "dropped";
  }
  if (["completed", "finished", "watched", "done", "watched_all"].includes(value)) {
    return "completed";
  }
  if (
    [
      "plan_to_watch",
      "planned",
      "plan",
      "to_watch",
      "watchlist",
      "for_later",
      "not_started_yet",
      "not started yet",
    ].includes(value)
  ) {
    return "plan_to_watch";
  }
  return hasWatchedEpisodes ? "watching" : "plan_to_watch";
}

function normalizeMediaType(input?: string): MediaType | null {
  const value = input?.trim().toLowerCase() ?? "";
  if (["anime", "animation_anime"].includes(value)) {
    return "anime";
  }
  if (["movie", "film", "cinema"].includes(value)) {
    return "movie";
  }
  if (["tv", "show", "series", "tv_show", "television"].includes(value)) {
    return "tv";
  }
  return null;
}

function inferMediaType(record: Record<string, unknown>): MediaType {
  const direct = normalizeMediaType(
    readString(record, ["mediaType", "media_type", "type", "kind", "format"])
  );
  if (direct) {
    return direct;
  }

  if (Array.isArray(record.seasons)) {
    return "tv";
  }

  const hasAnimeId =
    typeof readNumber(record, ["anilistId", "anilist_id", "malId", "mal_id"]) ===
    "number";
  if (hasAnimeId) {
    return "anime";
  }

  if ("is_watched" in record && !Array.isArray(record.seasons)) {
    return "movie";
  }

  return "tv";
}

function parseEpisodeArray(value: unknown): ParsedImportEpisode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byEpisodeKey = new Map<string, ParsedImportEpisode>();

  for (const entry of value) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const watched = readBoolean(record, ["is_watched", "isWatched", "watched", "seen"]);
    if (watched === false) {
      continue;
    }

    const season =
      readNumber(record, ["season", "seasonNumber", "season_number", "s"]) ?? 1;
    const episode = readNumber(record, [
      "episode",
      "episodeNumber",
      "episode_number",
      "number",
      "ep",
      "e",
    ]);

    if (typeof episode !== "number") {
      continue;
    }

    const watchedAtRaw = readString(record, ["watchedAt", "watched_at", "seen_at"]);
    const watchedAtDate = watchedAtRaw ? new Date(watchedAtRaw).getTime() : NaN;
    const watchedAt = Number.isFinite(watchedAtDate) ? watchedAtDate : undefined;

    const key = `${season}:${episode}`;
    const parsedEpisode: ParsedImportEpisode = {
      season,
      episode,
      watchedAt,
    };

    const existing = byEpisodeKey.get(key);
    if (!existing) {
      byEpisodeKey.set(key, parsedEpisode);
      continue;
    }
    byEpisodeKey.set(key, mergeEpisodeEntries(existing, parsedEpisode));
  }

  return Array.from(byEpisodeKey.values());
}

function parseTvTimeLiberatorSeasons(value: unknown) {
  const seasons = toRecordArray(value);
  if (seasons.length === 0) {
    return [];
  }

  const byEpisodeKey = new Map<string, ParsedImportEpisode>();

  for (const season of seasons) {
    const seasonNumber =
      readNumber(season, ["number", "season", "seasonNumber", "season_number"]) ?? 1;
    const seasonEpisodes = toRecordArray(season.episodes);

    for (const episode of seasonEpisodes) {
      const watched = readBoolean(episode, ["is_watched", "isWatched", "watched", "seen"]);
      if (watched === false) {
        continue;
      }

      const episodeNumber = readNumber(episode, [
        "number",
        "episode",
        "episodeNumber",
        "episode_number",
        "ep",
        "e",
      ]);

      if (typeof episodeNumber !== "number") {
        continue;
      }

      const watchedAtRaw = readString(episode, ["watched_at", "watchedAt", "seen_at"]);
      const watchedAtDate = watchedAtRaw ? new Date(watchedAtRaw).getTime() : NaN;
      const watchedAt = Number.isFinite(watchedAtDate) ? watchedAtDate : undefined;

      const key = `${seasonNumber}:${episodeNumber}`;
      const parsedEpisode: ParsedImportEpisode = {
        season: seasonNumber,
        episode: episodeNumber,
        watchedAt,
      };

      const existing = byEpisodeKey.get(key);
      if (!existing) {
        byEpisodeKey.set(key, parsedEpisode);
        continue;
      }
      byEpisodeKey.set(key, mergeEpisodeEntries(existing, parsedEpisode));
    }
  }

  return Array.from(byEpisodeKey.values());
}

function buildEpisodeList(record: Record<string, unknown>, mediaType: MediaType) {
  const liberatorEpisodes = parseTvTimeLiberatorSeasons(record.seasons);
  if (liberatorEpisodes.length > 0) {
    return liberatorEpisodes;
  }

  const explicit = parseEpisodeArray(
    record.watchedEpisodes ?? record.watched_episodes ?? record.episodes ?? record.history
  );
  if (explicit.length > 0) {
    return explicit;
  }

  const watchedEpisodeCount = readNumber(record, [
    "watchedEpisodes",
    "watched_episodes_count",
    "watchedEpisodesCount",
    "episodesWatched",
    "seen_episodes",
    "progress",
  ]);

  if (typeof watchedEpisodeCount === "number" && watchedEpisodeCount > 0) {
    const capped = Math.max(0, Math.min(5000, Math.floor(watchedEpisodeCount)));
    if (mediaType === "movie") {
      return [{ season: 1, episode: 1 }];
    }
    return Array.from({ length: capped }, (_, index) => ({
      season: 1,
      episode: index + 1,
    }));
  }

  const watchedFlag = readBoolean(record, ["watched", "isWatched", "seen"]);
  const watchedUnderscoreFlag = readBoolean(record, ["is_watched"]);
  const isWatchedMovie = watchedFlag || watchedUnderscoreFlag;
  if (isWatchedMovie && mediaType === "movie") {
    return [{ season: 1, episode: 1 }];
  }

  return [];
}

function maybeParseItem(value: unknown): ParsedImportItem | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const title = readString(record, ["title", "name", "showName", "show_name"]);
  if (!title) {
    return null;
  }

  const hasShowId =
    typeof normalizeIdNumber(
      readNumber(record, [
        "tvdbId",
        "tvdb_id",
        "tmdbId",
        "tmdb_id",
        "anilistId",
        "anilist_id",
        "malId",
        "mal_id",
        "tvmazeId",
        "tvmaze_id",
      ])
    ) === "number" ||
    typeof normalizeIdNumber(readNestedNumber(record, "id", ["tvdb", "tmdb", "anilist", "mal"])) ===
      "number";

  const hasExplicitStatus = hasAnyKey(record, [
    "status",
    "watchStatus",
    "watch_status",
    "state",
  ]);

  const hasEpisodeFields = hasAnyKey(record, [
    "episode",
    "episodeNumber",
    "episode_number",
    "number",
    "ep",
    "e",
  ]);

  if (isLikelyEpisodeTitle(title) && !hasShowId && hasEpisodeFields && !hasExplicitStatus) {
    return null;
  }

  const mediaType = inferMediaType(record);
  const watchedEpisodes = buildEpisodeList(record, mediaType);

  const hasItemSignals =
    hasShowId ||
    hasExplicitStatus ||
    watchedEpisodes.length > 0 ||
    hasAnyKey(record, ITEM_SIGNAL_KEYS);
  if (!hasItemSignals) {
    return null;
  }

  const statusInput = readString(record, ["status", "watchStatus", "watch_status", "state"]);
  const watchedMovieFlag = readBoolean(record, ["is_watched", "isWatched", "watched", "seen"]);
  const statusFromMovieFlag =
    mediaType === "movie" && typeof watchedMovieFlag === "boolean"
      ? watchedMovieFlag
        ? "completed"
        : "plan_to_watch"
      : undefined;

  const tvdbId = normalizeIdNumber(
    readNumber(record, ["tvdbId", "tvdb_id"]) ??
      readNestedNumber(record, "id", ["tvdb"])
  );
  const tmdbId = normalizeIdNumber(readNumber(record, ["tmdbId", "tmdb_id"]));
  const anilistId = normalizeIdNumber(readNumber(record, ["anilistId", "anilist_id"]));
  const malId = normalizeIdNumber(readNumber(record, ["malId", "mal_id"]));
  const tvmazeId = normalizeIdNumber(readNumber(record, ["tvmazeId", "tvmaze_id"]));

  return {
    title,
    mediaType,
    firstAiredYear: parseYear(
      readString(record, [
        "firstAired",
        "first_aired",
        "firstAirDate",
        "first_air_date",
        "premiered",
        "release_date",
        "year",
      ])
    ),
    tvdbId,
    tmdbId,
    anilistId,
    malId,
    tvmazeId,
    imdbId: normalizeExternalStringId(
      readString(record, ["imdbId", "imdb_id"]) ??
        readNestedString(record, "id", ["imdb"])
    ),
    status: statusFromMovieFlag ?? normalizeStatus(statusInput, watchedEpisodes.length > 0),
    watchedEpisodes,
  };
}

export function parseTvTimeImportJson(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  const queue: unknown[] = [parsed];
  const visited = new Set<unknown>();
  const candidates: ParsedImportItem[] = [];
  let visitedCount = 0;

  while (queue.length > 0 && visitedCount < MAX_VISIT_NODES) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    visitedCount += 1;

    const item = maybeParseItem(current);
    if (item) {
      candidates.push(item);
    }

    if (Array.isArray(current)) {
      for (const entry of current) {
        queue.push(entry);
      }
      continue;
    }

    const record = toRecord(current);
    if (record) {
      for (const value of Object.values(record)) {
        if (value && typeof value === "object") {
          queue.push(value);
        }
      }
    }
  }

  const deduped = new Map<string, ParsedImportItem>();
  for (const item of candidates) {
    const externalKey =
      typeof item.tmdbId === "number"
        ? `tmdb:${item.tmdbId}`
        : typeof item.tvdbId === "number"
          ? `tvdb:${item.tvdbId}`
        : typeof item.anilistId === "number"
          ? `anilist:${item.anilistId}`
          : typeof item.malId === "number"
            ? `mal:${item.malId}`
            : typeof item.tvmazeId === "number"
              ? `tvmaze:${item.tvmazeId}`
              : undefined;

    const key =
      externalKey ?? `${item.mediaType}:title:${normalizeTitleForKey(item.title)}`;

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    const mergedEpisodes = new Map<string, ParsedImportEpisode>();
    for (const episode of existing.watchedEpisodes) {
      mergedEpisodes.set(`${episode.season}:${episode.episode}`, episode);
    }
    for (const episode of item.watchedEpisodes) {
      const episodeKey = `${episode.season}:${episode.episode}`;
      const current = mergedEpisodes.get(episodeKey);
      if (!current) {
        mergedEpisodes.set(episodeKey, episode);
        continue;
      }
      mergedEpisodes.set(episodeKey, mergeEpisodeEntries(current, episode));
    }
    deduped.set(key, {
      ...existing,
      title: existing.title.length >= item.title.length ? existing.title : item.title,
      firstAiredYear: existing.firstAiredYear ?? item.firstAiredYear,
      tmdbId: existing.tmdbId ?? item.tmdbId,
      tvdbId: existing.tvdbId ?? item.tvdbId,
      anilistId: existing.anilistId ?? item.anilistId,
      malId: existing.malId ?? item.malId,
      tvmazeId: existing.tvmazeId ?? item.tvmazeId,
      imdbId: existing.imdbId ?? item.imdbId,
      status:
        STATUS_PRIORITY[item.status] >= STATUS_PRIORITY[existing.status]
          ? item.status
          : existing.status,
      watchedEpisodes: Array.from(mergedEpisodes.values()),
    });
  }

  const items = Array.from(deduped.values());
  const summary = {
    total: items.length,
    tv: items.filter((item) => item.mediaType === "tv").length,
    anime: items.filter((item) => item.mediaType === "anime").length,
    movie: items.filter((item) => item.mediaType === "movie").length,
    withEpisodeHistory: items.filter((item) => item.watchedEpisodes.length > 0).length,
  };

  return { items, summary };
}

export function isLikelyTvTimeExport(raw: string) {
  const snippet = normalizeText(raw).slice(0, 2000).toLowerCase();
  return (
    snippet.includes("tv time") ||
    snippet.includes("tvtime") ||
    snippet.includes("watched") ||
    snippet.includes("episodes")
  );
}
