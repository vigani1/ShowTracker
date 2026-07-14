import JSZip from "jszip";
import Papa from "papaparse";
import type {
  ImportWatchStatus,
  ParsedImportEpisode,
  ParsedImportItem,
} from "@/lib/import/tv-time";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_CSV_ROWS = 250_000;

export const TV_TIME_GDPR_FILES = {
  trackingV2: "tracking-prod-records-v2.csv",
  trackingLegacy: "tracking-prod-records.csv",
  followedShows: "followed_tv_show.csv",
  userShowData: "user_tv_show_data.csv",
  rewatches: "rewatched_episode.csv",
  specialStatuses: "user_show_special_status.csv",
} as const;

const ALLOWED_FILE_NAMES = new Set<string>(Object.values(TV_TIME_GDPR_FILES));

const REQUIRED_HEADERS: Partial<Record<TvTimeGdprFileName, string[]>> = {
  [TV_TIME_GDPR_FILES.trackingV2]: [
    "s_id",
    "series_name",
    "ep_id",
    "season_number",
    "episode_number",
    "created_at",
  ],
  [TV_TIME_GDPR_FILES.trackingLegacy]: [
    "type",
    "entity_type",
    "created_at",
    "uuid",
  ],
  [TV_TIME_GDPR_FILES.followedShows]: [
    "tv_show_id",
    "tv_show_name",
    "archived",
    "active",
  ],
  [TV_TIME_GDPR_FILES.userShowData]: [
    "tv_show_id",
    "tv_show_name",
    "is_followed",
    "is_favorited",
  ],
  [TV_TIME_GDPR_FILES.rewatches]: [
    "episode_id",
    "cpt",
    "episode_season_number",
    "episode_number",
  ],
  [TV_TIME_GDPR_FILES.specialStatuses]: [
    "tv_show_id",
    "status",
    "tv_show_name",
  ],
};

export type TvTimeGdprFileName =
  (typeof TV_TIME_GDPR_FILES)[keyof typeof TV_TIME_GDPR_FILES];

type CsvRow = Record<string, string>;

type EpisodeAccumulator = {
  season: number;
  episode: number;
  sourceEpisodeId?: string;
  isSpecial?: boolean;
  timestamps: number[];
  watchCount: number;
  runtimeMinutes?: number;
};

type SeriesAccumulator = {
  sourceId: string;
  title: string;
  followed?: boolean;
  archived?: boolean;
  forLater?: boolean;
  favorite?: boolean;
  followedAt?: number;
  firstAiredYear?: number;
  expectedWatchedEpisodes?: number;
  episodes: Map<string, EpisodeAccumulator>;
};

export type ParsedTvTimeGdprItem = ParsedImportItem & {
  favorite: boolean;
  followedAt?: number;
  source: "tv_time_gdpr";
};

export type TvTimeGdprParseSummary = {
  filesRead: TvTimeGdprFileName[];
  ignoredFileCount: number;
  total: number;
  tv: number;
  movie: number;
  episodes: number;
  watchEvents: number;
  rewatches: number;
  favorites: number;
  warnings: string[];
};

export type TvTimeGdprParseResult = {
  items: ParsedTvTimeGdprItem[];
  summary: TvTimeGdprParseSummary;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value: unknown) {
  const parsed = Number.parseInt(cleanString(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: unknown) {
  const parsed = Number.parseInt(cleanString(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBoolean(value: unknown) {
  const normalized = cleanString(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseSqlTimestamp(value: unknown) {
  const normalized = cleanString(value);
  if (!normalized || normalized === "0001-01-01 00:00:00") {
    return undefined;
  }
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const isoLike = normalized.includes("T") ? normalized : normalized.replace(" ", "T");
  const parsed = Date.parse(hasZone ? isoLike : `${isoLike}Z`);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseUnixSeconds(value: unknown) {
  const parsed = Number(cleanString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed * 1000);
}

function parseEpochMicros(value: unknown) {
  const parsed = Number(cleanString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed / 1000);
}

function parseRuntimeMinutes(value: unknown, unit: "seconds" | "mixed") {
  const parsed = Number(cleanString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  const minutes = unit === "seconds" || parsed >= 300 ? parsed / 60 : parsed;
  return minutes > 0 ? minutes : undefined;
}

function uniqueSortedTimestamps(values: Array<number | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0
      )
    )
  ).sort((a, b) => a - b);
}

function normalizeSourceId(value: unknown) {
  const normalized = cleanString(value);
  if (!normalized || normalized === "0" || normalized === "-1") {
    return undefined;
  }
  return normalized;
}

function getSeries(
  series: Map<string, SeriesAccumulator>,
  sourceId: string,
  title?: string
) {
  const existing = series.get(sourceId);
  if (existing) {
    const normalizedTitle = cleanString(title);
    if (normalizedTitle && normalizedTitle.length > existing.title.length) {
      existing.title = normalizedTitle;
    }
    return existing;
  }

  const created: SeriesAccumulator = {
    sourceId,
    title: cleanString(title),
    episodes: new Map(),
  };
  series.set(sourceId, created);
  return created;
}

function addEpisode(
  target: SeriesAccumulator,
  args: {
    season?: number;
    episode?: number;
    sourceEpisodeId?: string;
    watchedAt?: number;
    watchCount?: number;
    runtimeMinutes?: number;
    isSpecial?: boolean;
  }
) {
  if (args.season === undefined || !args.episode) {
    return;
  }
  const key = `${args.season}:${args.episode}`;
  const existing = target.episodes.get(key);
  if (!existing) {
    target.episodes.set(key, {
      season: args.season,
      episode: args.episode,
      sourceEpisodeId: args.sourceEpisodeId,
      isSpecial: args.isSpecial,
      timestamps: uniqueSortedTimestamps([args.watchedAt]),
      watchCount: Math.max(1, args.watchCount ?? 1),
      runtimeMinutes: args.runtimeMinutes,
    });
    return;
  }

  existing.sourceEpisodeId ??= args.sourceEpisodeId;
  existing.isSpecial ??= args.isSpecial;
  existing.timestamps = uniqueSortedTimestamps([
    ...existing.timestamps,
    args.watchedAt,
  ]);
  existing.watchCount = Math.max(
    existing.watchCount,
    args.watchCount ?? 1,
    existing.timestamps.length
  );
  if (typeof args.runtimeMinutes === "number") {
    existing.runtimeMinutes = Math.max(existing.runtimeMinutes ?? 0, args.runtimeMinutes);
  }
}

function parseCsv(name: TvTimeGdprFileName, source: string) {
  const result = Papa.parse<CsvRow>(source, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ""),
  });

  const fatalErrors = result.errors.filter((error) => error.type !== "FieldMismatch");
  if (fatalErrors.length > 0) {
    throw new Error(
      `${name} could not be parsed: ${fatalErrors[0].message || "invalid CSV"}`
    );
  }
  if (result.data.length > MAX_CSV_ROWS) {
    throw new Error(`${name} contains too many rows.`);
  }

  const headers = new Set(result.meta.fields ?? []);
  const missing = (REQUIRED_HEADERS[name] ?? []).filter((header) => !headers.has(header));
  if (missing.length > 0) {
    throw new Error(`${name} is missing required columns: ${missing.join(", ")}.`);
  }

  return {
    rows: result.data,
    warningCount: result.errors.length - fatalErrors.length,
  };
}

function applyTrackingV2(
  rows: CsvRow[],
  series: Map<string, SeriesAccumulator>,
  episodeBySourceId: Map<string, EpisodeAccumulator>
) {
  for (const row of rows) {
    const sourceId = normalizeSourceId(row.s_id);
    if (!sourceId) {
      continue;
    }
    const target = getSeries(series, sourceId, row.series_name);
    const sourceEpisodeId = normalizeSourceId(row.ep_id);
    const season = parseNonNegativeInteger(row.season_number);
    const episode = parsePositiveInteger(row.episode_number);

    if (sourceEpisodeId && season !== undefined && episode !== undefined) {
      const rewatchCount = parseNonNegativeInteger(row.rewatch_count) ?? 0;
      addEpisode(target, {
        season,
        episode,
        sourceEpisodeId,
        watchedAt: parseSqlTimestamp(row.created_at),
        watchCount: rewatchCount + 1,
        runtimeMinutes: parseRuntimeMinutes(row.runtime, "seconds"),
        isSpecial: parseBoolean(row.is_special),
      });
      const accumulated = target.episodes.get(`${season}:${episode}`);
      if (accumulated) {
        episodeBySourceId.set(sourceEpisodeId, accumulated);
      }
    }

    const followed = parseBoolean(row.is_followed);
    const archived = parseBoolean(row.is_archived);
    const forLater = parseBoolean(row.is_for_later);
    if (followed !== undefined) target.followed = followed;
    if (archived !== undefined) target.archived = archived;
    if (forLater !== undefined) target.forLater = forLater;
    target.followedAt ??= parseEpochMicros(row.followed_at);
    target.expectedWatchedEpisodes ??= parseNonNegativeInteger(row.ep_watch_count);
  }
}

function applyLegacyTracking(
  rows: CsvRow[],
  series: Map<string, SeriesAccumulator>,
  movies: Map<string, SeriesAccumulator>
) {
  for (const row of rows) {
    const entityType = cleanString(row.entity_type).toLowerCase();
    const eventType = cleanString(row.type).toLowerCase();
    const watchedAt = parseUnixSeconds(row.watch_date) ?? parseSqlTimestamp(row.created_at);

    if (entityType === "movie") {
      const sourceId = normalizeSourceId(row.uuid);
      if (!sourceId) continue;
      const movie = getSeries(movies, sourceId, row.movie_name);
      const releaseTimestamp = parseSqlTimestamp(row.release_date);
      if (releaseTimestamp) {
        movie.firstAiredYear ??= new Date(releaseTimestamp).getUTCFullYear();
      }
      if (eventType === "towatch" || eventType === "follow") {
        movie.forLater = true;
      }
      if (eventType === "watch" || eventType === "rewatch") {
        movie.followed = true;
        addEpisode(movie, {
          season: 1,
          episode: 1,
          watchedAt,
          watchCount: eventType === "rewatch" ? 2 : 1,
          runtimeMinutes: parseRuntimeMinutes(row.runtime, "mixed"),
        });
      }
      continue;
    }

    if (entityType !== "episode" || !["watch", "rewatch"].includes(eventType)) {
      continue;
    }
    const sourceId = normalizeSourceId(row.series_id);
    if (!sourceId) continue;
    const target = getSeries(series, sourceId, row.series_name);
    addEpisode(target, {
      season: parseNonNegativeInteger(row.season_number),
      episode: parsePositiveInteger(row.episode_number),
      sourceEpisodeId: normalizeSourceId(row.episode_id),
      watchedAt,
      watchCount: eventType === "rewatch" ? 2 : 1,
      runtimeMinutes: parseRuntimeMinutes(row.runtime, "mixed"),
    });
  }
}

function applyFollowedShows(rows: CsvRow[], series: Map<string, SeriesAccumulator>) {
  for (const row of rows) {
    const sourceId = normalizeSourceId(row.tv_show_id);
    if (!sourceId) continue;
    const target = getSeries(series, sourceId, row.tv_show_name);
    const archived = parseBoolean(row.archived);
    const active = parseBoolean(row.active);
    if (archived !== undefined) target.archived = archived;
    if (active !== undefined) target.followed = active;
    target.followedAt ??= parseSqlTimestamp(row.created_at);
  }
}

function applyUserShowData(rows: CsvRow[], series: Map<string, SeriesAccumulator>) {
  for (const row of rows) {
    const sourceId = normalizeSourceId(row.tv_show_id);
    if (!sourceId) continue;
    const target = getSeries(series, sourceId, row.tv_show_name);
    const followed = parseBoolean(row.is_followed);
    const favorite = parseBoolean(row.is_favorited);
    if (followed !== undefined) target.followed = followed;
    if (favorite !== undefined) target.favorite = favorite;
    target.expectedWatchedEpisodes ??= parseNonNegativeInteger(row.nb_episodes_seen);
  }
}

function applyRewatches(
  rows: CsvRow[],
  series: Map<string, SeriesAccumulator>,
  episodeBySourceId: Map<string, EpisodeAccumulator>
) {
  for (const row of rows) {
    const sourceEpisodeId = normalizeSourceId(row.episode_id);
    const rewatchCount = parseNonNegativeInteger(row.cpt);
    if (!sourceEpisodeId || rewatchCount === undefined) continue;

    const direct = episodeBySourceId.get(sourceEpisodeId);
    if (direct) {
      direct.watchCount = Math.max(
        direct.watchCount,
        rewatchCount + 1,
        direct.timestamps.length
      );
      continue;
    }

    const title = cleanString(row.tv_show_name);
    const season = parseNonNegativeInteger(row.episode_season_number);
    const episode = parsePositiveInteger(row.episode_number);
    if (!title || season === undefined || episode === undefined) continue;
    const titleKey = title.toLowerCase();
    const target = Array.from(series.values()).find(
      (entry) => entry.title.toLowerCase() === titleKey
    );
    if (!target) continue;
    addEpisode(target, {
      season,
      episode,
      sourceEpisodeId,
      watchCount: rewatchCount + 1,
    });
  }
}

function applySpecialStatuses(rows: CsvRow[], series: Map<string, SeriesAccumulator>) {
  for (const row of rows) {
    const sourceId = normalizeSourceId(row.tv_show_id);
    if (!sourceId) continue;
    const target = getSeries(series, sourceId, row.tv_show_name);
    const status = cleanString(row.status).toLowerCase();
    if (status === "favorite") target.favorite = true;
    if (status === "for_later") target.forLater = true;
  }
}

function inferStatus(item: SeriesAccumulator, mediaType: "tv" | "movie") {
  if (mediaType === "movie") {
    return item.episodes.size > 0 ? "completed" : "plan_to_watch";
  }
  if (item.forLater && item.episodes.size === 0) return "plan_to_watch";
  if (item.archived) return "paused";
  if (item.episodes.size > 0) return "watching";
  return "plan_to_watch";
}

function toParsedItem(
  item: SeriesAccumulator,
  mediaType: "tv" | "movie"
): ParsedTvTimeGdprItem | null {
  if (!item.title) return null;
  const numericSourceId = parsePositiveInteger(item.sourceId);
  const watchedEpisodes: ParsedImportEpisode[] = Array.from(item.episodes.values())
    .sort((a, b) => a.season - b.season || a.episode - b.episode)
    .map((entry) => {
      const history = uniqueSortedTimestamps(entry.timestamps);
      const watchCount = Math.max(entry.watchCount, history.length, 1);
      return {
        season: entry.season,
        episode: entry.episode,
        sourceSeason: entry.season,
        sourceEpisode: entry.episode,
        sourceEpisodeId: entry.sourceEpisodeId,
        isSpecial: entry.isSpecial,
        runtime: entry.runtimeMinutes,
        watchedAt: history.at(-1),
        watchCount: watchCount > 1 ? watchCount : undefined,
        watchHistory: history.length > 0 ? history : undefined,
      };
    });

  return {
    title: item.title,
    mediaType,
    tvdbId: mediaType === "tv" ? numericSourceId : undefined,
    firstAiredYear: item.firstAiredYear,
    status: inferStatus(item, mediaType) satisfies ImportWatchStatus,
    watchedEpisodes,
    favorite: item.favorite === true,
    followedAt: item.followedAt,
    source: "tv_time_gdpr",
  };
}

export function parseTvTimeGdprFiles(
  files: Partial<Record<TvTimeGdprFileName, string>>,
  options: { ignoredFileCount?: number } = {}
): TvTimeGdprParseResult {
  if (!files[TV_TIME_GDPR_FILES.trackingV2]) {
    throw new Error(`${TV_TIME_GDPR_FILES.trackingV2} is required.`);
  }

  const parsedFiles = new Map<TvTimeGdprFileName, CsvRow[]>();
  const warnings: string[] = [];
  for (const name of Object.values(TV_TIME_GDPR_FILES)) {
    const source = files[name];
    if (source === undefined) continue;
    const parsed = parseCsv(name, source);
    parsedFiles.set(name, parsed.rows);
    if (parsed.warningCount > 0) {
      warnings.push(`${name}: ${parsed.warningCount} malformed rows were tolerated.`);
    }
  }

  const series = new Map<string, SeriesAccumulator>();
  const movies = new Map<string, SeriesAccumulator>();
  const episodeBySourceId = new Map<string, EpisodeAccumulator>();

  applyTrackingV2(
    parsedFiles.get(TV_TIME_GDPR_FILES.trackingV2) ?? [],
    series,
    episodeBySourceId
  );
  applyLegacyTracking(
    parsedFiles.get(TV_TIME_GDPR_FILES.trackingLegacy) ?? [],
    series,
    movies
  );
  applyFollowedShows(
    parsedFiles.get(TV_TIME_GDPR_FILES.followedShows) ?? [],
    series
  );
  applyUserShowData(
    parsedFiles.get(TV_TIME_GDPR_FILES.userShowData) ?? [],
    series
  );
  applyRewatches(
    parsedFiles.get(TV_TIME_GDPR_FILES.rewatches) ?? [],
    series,
    episodeBySourceId
  );
  applySpecialStatuses(
    parsedFiles.get(TV_TIME_GDPR_FILES.specialStatuses) ?? [],
    series
  );

  for (const item of series.values()) {
    if (
      typeof item.expectedWatchedEpisodes === "number" &&
      item.expectedWatchedEpisodes !== item.episodes.size
    ) {
      warnings.push(
        `${item.title}: archive summary reports ${item.expectedWatchedEpisodes} watched episodes; ${item.episodes.size} episode records were found.`
      );
    }
  }

  const items = [
    ...Array.from(series.values()).map((item) => toParsedItem(item, "tv")),
    ...Array.from(movies.values()).map((item) => toParsedItem(item, "movie")),
  ].filter((item): item is ParsedTvTimeGdprItem => item !== null);

  const episodes = items.reduce((total, item) => total + item.watchedEpisodes.length, 0);
  const watchEvents = items.reduce(
    (total, item) =>
      total +
      item.watchedEpisodes.reduce(
        (episodeTotal, episode) => episodeTotal + Math.max(1, episode.watchCount ?? 1),
        0
      ),
    0
  );

  return {
    items,
    summary: {
      filesRead: Array.from(parsedFiles.keys()),
      ignoredFileCount: options.ignoredFileCount ?? 0,
      total: items.length,
      tv: items.filter((item) => item.mediaType === "tv").length,
      movie: items.filter((item) => item.mediaType === "movie").length,
      episodes,
      watchEvents,
      rewatches: Math.max(0, watchEvents - episodes),
      favorites: items.filter((item) => item.favorite).length,
      warnings: Array.from(new Set(warnings)).slice(0, 100),
    },
  };
}

function getSafeArchiveFileName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("The archive contains an unsafe file path.");
  }
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

export async function parseTvTimeGdprArchive(
  bytes: ArrayBuffer
): Promise<TvTimeGdprParseResult> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("The TV Time archive is larger than 50 MB.");
  }

  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("The TV Time archive contains too many files.");
  }

  const selected = new Map<TvTimeGdprFileName, JSZip.JSZipObject>();
  let ignoredFileCount = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const fileName = getSafeArchiveFileName(entry.name);
    if (!ALLOWED_FILE_NAMES.has(fileName)) {
      ignoredFileCount += 1;
      continue;
    }
    if (selected.has(fileName as TvTimeGdprFileName)) {
      throw new Error(`The archive contains duplicate ${fileName} files.`);
    }
    selected.set(fileName as TvTimeGdprFileName, entry);
  }

  if (!selected.has(TV_TIME_GDPR_FILES.trackingV2)) {
    throw new Error(
      `This ZIP does not contain ${TV_TIME_GDPR_FILES.trackingV2}.`
    );
  }

  const extracted: Partial<Record<TvTimeGdprFileName, string>> = {};
  let extractedBytes = 0;
  for (const [name, entry] of selected) {
    const text = await entry.async("string");
    extractedBytes += new TextEncoder().encode(text).byteLength;
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("The approved tracking files are unexpectedly large.");
    }
    extracted[name] = text;
  }

  return parseTvTimeGdprFiles(extracted, { ignoredFileCount });
}
