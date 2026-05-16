#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultWorkDir = path.join(repoRoot, ".schedule-confidence");
const defaultDbPath = path.join(defaultWorkDir, "schedule-confidence.sqlite");
const defaultDeltaPath = path.join(defaultWorkDir, "convex-deltas.json");
const defaultAuditPath = path.join(defaultWorkDir, "audit-report.json");
const defaultDevDeltaPath = path.join(defaultWorkDir, "dev-convex-deltas.json");
const defaultDevAuditPath = path.join(defaultWorkDir, "dev-audit-report.json");
const defaultDevBeforePath = path.join(defaultWorkDir, "dev-before-snapshot.json");
const defaultDevAfterPath = path.join(defaultWorkDir, "dev-after-snapshot.json");
const defaultDevWorkflowReportPath = path.join(defaultWorkDir, "dev-workflow-report.json");
const dashboardHtmlPath = path.join(__dirname, "schedule-confidence-dashboard.html");
const syntheticPrefix = "SC Synthetic";
const fixtureNowMs = Date.UTC(2026, 4, 14, 12, 0, 0);
const scheduleLookaheadMs = 1000 * 60 * 60 * 24 * 120;

const directFixtureDate = "2026-05-13T21:00:00.000Z";
const bridgedFixtureDate = "2026-05-14T18:00:00.000Z";
const globalFixtureDate = "2026-05-14T09:00:00.000Z";
const futureFixtureDate = "2026-05-20T19:30:00.000Z";
const completedFixtureDate = "2026-05-12T22:00:00.000Z";
const titleFallbackFixtureDate = "2026-05-11T20:00:00.000Z";
const syntheticProviderEventDate = "2026-05-13T20:00:00.000Z";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const fixtureLibrary = [
  {
    id: "fixture-direct",
    userId: "fixture-user",
    showId: "show-direct",
    title: "Direct Match Show",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 4,
    totalEpisodes: 4,
    releasedEpisodes: 4,
    tmdbId: 1001,
    tvmazeId: 9001,
    imdbId: "tt9001001",
  },
  {
    id: "fixture-bridged",
    userId: "fixture-user",
    showId: "show-bridged",
    title: "Bridged Identity Show",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 2,
    totalEpisodes: 2,
    releasedEpisodes: 2,
    tmdbId: 1002,
    imdbId: "tt9001002",
  },
  {
    id: "fixture-global",
    userId: "fixture-user",
    showId: "show-global",
    title: "Global First Drama",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 7,
    totalEpisodes: 7,
    releasedEpisodes: 7,
    tmdbId: 1003,
    tvmazeId: 9003,
  },
  {
    id: "fixture-future",
    userId: "fixture-user",
    showId: "show-future",
    title: "Future Only Anime",
    mediaType: "anime",
    status: "watching",
    watchedEpisodesCount: 10,
    totalEpisodes: 12,
    releasedEpisodes: 10,
    anilistId: 8004,
    malId: 7004,
  },
  {
    id: "fixture-stale-signal-break",
    userId: "fixture-user",
    showId: "show-stale-signal-break",
    title: "Stale Signal Break",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 1201,
    totalEpisodes: 1202,
    releasedEpisodes: 1201,
    remainingEpisodes: 0,
    newEpisodeSignalAt: Date.UTC(2026, 4, 16, 13, 0, 0),
    lastWatchedAt: Date.UTC(2026, 4, 9, 13, 0, 0),
    tmdbId: 1014,
    imdbId: "tt9012014",
  },
  {
    id: "fixture-completed",
    userId: "fixture-user",
    showId: "show-completed",
    title: "Completed Returns",
    mediaType: "tv",
    status: "completed",
    watchedEpisodesCount: 12,
    totalEpisodes: 12,
    releasedEpisodes: 12,
    tmdbId: 1005,
    tvmazeId: 9005,
  },
  {
    id: "fixture-missing-provider",
    userId: "fixture-user",
    showId: "show-missing-provider",
    title: "Unlinked Mystery",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 1,
    totalEpisodes: null,
    releasedEpisodes: null,
  },
  {
    id: "fixture-static-completed-missing-provider",
    userId: "fixture-user",
    showId: "show-static-completed-missing-provider",
    title: "Static Completed Without Dated Source",
    mediaType: "tv",
    status: "completed",
    watchedEpisodesCount: 1,
    totalEpisodes: 1,
    releasedEpisodes: 1,
    tmdbId: 1010,
  },
  {
    id: "fixture-static-planned-finished-anime",
    userId: "fixture-user",
    showId: "show-static-planned-finished-anime",
    title: "Finished Planned Anime Without Airing Source",
    mediaType: "anime",
    status: "plan_to_watch",
    watchedEpisodesCount: 0,
    totalEpisodes: 12,
    releasedEpisodes: 12,
    anilistId: 8010,
    malId: 7010,
  },
  {
    id: "fixture-title-fallback",
    userId: "fixture-user",
    showId: "show-title-fallback",
    title: "Title Fallback Signal",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 2,
    totalEpisodes: 2,
    releasedEpisodes: 2,
  },
  {
    id: "fixture-future-season-total",
    userId: "fixture-user",
    showId: "show-future-season-total",
    title: "Future Season Total Trap",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 18,
    totalEpisodes: 26,
    releasedEpisodes: 26,
    tmdbId: 1011,
  },
  {
    id: "fixture-sparse-old-total",
    userId: "fixture-user",
    showId: "show-sparse-old-total",
    title: "Sparse Old Total Trap",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 220,
    totalEpisodes: 378,
    releasedEpisodes: 378,
    tmdbId: 1012,
    lastWatchedAt: Date.UTC(2026, 4, 1),
  },
  {
    id: "fixture-post-watch-count-drift",
    userId: "fixture-user",
    showId: "show-post-watch-count-drift",
    title: "Post Watch Count Drift",
    mediaType: "tv",
    status: "watching",
    watchedEpisodesCount: 2,
    totalEpisodes: 3,
    releasedEpisodes: null,
    tmdbId: 1013,
    lastWatchedAt: Date.UTC(2026, 4, 20),
  },
];

const fixtureProviderEvents = [
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:9001",
    title: "Direct Match Show",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 5,
    name: "Direct New Episode",
    airDate: directFixtureDate,
    providers: { tvmazeId: 9001, imdbId: "tt9001001" },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:9102",
    title: "Bridged Identity Show",
    mediaType: "tv",
    region: "GB",
    seasonNumber: 1,
    episodeNumber: 3,
    name: "Bridge by IMDb",
    airDate: bridgedFixtureDate,
    providers: { tvmazeId: 9102, imdbId: "tt9001002" },
  },
  {
    sourceProvider: "tvmaze-web",
    providerShowId: "tvmaze:9003",
    title: "Global First Drama",
    mediaType: "tv",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 8,
    name: "Japan Web Premiere",
    airDate: globalFixtureDate,
    providers: { tvmazeId: 9003 },
  },
  {
    sourceProvider: "anilist",
    providerShowId: "anilist:8004",
    title: "Future Only Anime",
    mediaType: "anime",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 11,
    name: "Episode 11",
    airDate: futureFixtureDate,
    providers: { anilistId: 8004, malId: 7004 },
  },
  {
    sourceProvider: "tmdb",
    providerShowId: "tmdb:1014",
    title: "Stale Signal Break",
    mediaType: "tv",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 1202,
    name: "Break Week Return",
    airDate: "2026-05-30T09:00:00.000Z",
    providers: { tmdbId: 1014, imdbId: "tt9012014" },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:9005",
    title: "Completed Returns",
    mediaType: "tv",
    region: "global",
    seasonNumber: 1,
    episodeNumber: 13,
    name: "Surprise Return",
    airDate: completedFixtureDate,
    providers: { tvmazeId: 9005 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:9199",
    title: "Title Fallback Signal",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 3,
    name: "Title Only",
    airDate: titleFallbackFixtureDate,
    providers: { tvmazeId: 9199 },
  },
  {
    sourceProvider: "tmdb",
    providerShowId: "tmdb:1011",
    title: "Future Season Total Trap",
    mediaType: "tv",
    region: "US",
    seasonNumber: 2,
    episodeNumber: 8,
    name: "Finished Current Season",
    airDate: "2026-04-01T12:00:00.000Z",
    providers: { tmdbId: 1011 },
  },
  {
    sourceProvider: "tmdb",
    providerShowId: "tmdb:1011",
    title: "Future Season Total Trap",
    mediaType: "tv",
    region: "US",
    seasonNumber: 3,
    episodeNumber: 1,
    name: "Future Season Premiere",
    airDate: "2026-06-01T12:00:00.000Z",
    providers: { tmdbId: 1011 },
  },
  {
    sourceProvider: "tmdb",
    providerShowId: "tmdb:1012",
    title: "Sparse Old Total Trap",
    mediaType: "tv",
    region: "US",
    seasonNumber: 4,
    episodeNumber: 220,
    name: "Old Finale",
    airDate: "2007-02-08T00:00:00.000Z",
    providers: { tmdbId: 1012 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:1013",
    title: "Post Watch Count Drift",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 1,
    name: "First",
    airDate: "2026-05-01T00:00:00.000Z",
    providers: { tmdbId: 1013 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:1013",
    title: "Post Watch Count Drift",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 2,
    name: "Second",
    airDate: "2026-05-08T00:00:00.000Z",
    providers: { tmdbId: 1013 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:1013",
    title: "Post Watch Count Drift",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 3,
    name: "Count Drift",
    airDate: "2026-05-10T00:00:00.000Z",
    providers: { tmdbId: 1013 },
  },
];

const syntheticProviderEvents = [
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:991001",
    title: "SC Synthetic Direct Provider Match",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 5,
    name: "Direct Synthetic Release",
    airDate: syntheticProviderEventDate,
    providers: { tvmazeId: 991001, imdbId: "tt9810011" },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:992002",
    title: "SC Synthetic Bridged Provider Match",
    mediaType: "tv",
    region: "GB",
    seasonNumber: 1,
    episodeNumber: 3,
    name: "Bridged Synthetic Release",
    airDate: "2026-05-15T18:00:00.000Z",
    providers: { tvmazeId: 992002, imdbId: "tt9810022" },
  },
  {
    sourceProvider: "tvmaze-web",
    providerShowId: "tvmaze:991003",
    title: "SC Synthetic Global Web Release",
    mediaType: "tv",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 8,
    name: "Global Web Synthetic Release",
    airDate: "2026-05-14T09:00:00.000Z",
    providers: { tvmazeId: 991003 },
  },
  {
    sourceProvider: "anilist",
    providerShowId: "anilist:981004",
    title: "SC Synthetic Future Anime",
    mediaType: "anime",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 11,
    name: "Episode 11",
    airDate: "2026-05-20T19:30:00.000Z",
    providers: { anilistId: 981004, malId: 971004 },
  },
  {
    sourceProvider: "tmdb",
    providerShowId: "tmdb:981010",
    title: "SC Synthetic Stale Future Signal Clear",
    mediaType: "tv",
    region: "JP",
    seasonNumber: 1,
    episodeNumber: 1202,
    name: "Break Week Return",
    airDate: "2026-05-30T09:00:00.000Z",
    providers: { tmdbId: 981010, tvmazeId: 991010, imdbId: "tt9810100" },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:991005",
    title: "SC Synthetic Completed Old Show Returns",
    mediaType: "tv",
    region: "global",
    seasonNumber: 1,
    episodeNumber: 13,
    name: "Decades Later",
    airDate: "2026-05-12T22:00:00.000Z",
    providers: { tvmazeId: 991005 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:991006",
    title: "SC Synthetic Stale Projection Repair",
    mediaType: "tv",
    region: "global",
    seasonNumber: 1,
    episodeNumber: 21,
    name: "Projection Repair Release",
    airDate: "2026-05-10T20:00:00.000Z",
    providers: { tvmazeId: 991006 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:992008",
    title: "SC Synthetic Title Fallback Only",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 3,
    name: "Title Fallback Synthetic Release",
    airDate: "2026-05-11T20:00:00.000Z",
    providers: { tvmazeId: 992008 },
  },
  {
    sourceProvider: "tvmaze",
    providerShowId: "tvmaze:992009",
    title: "SC Synthetic Conflicting Provider Audit",
    mediaType: "tv",
    region: "US",
    seasonNumber: 1,
    episodeNumber: 4,
    name: "Conflicting Provider Release",
    airDate: "2026-05-11T21:00:00.000Z",
    providers: { tmdbId: 981009, tvmazeId: 992009 },
  },
];

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--") {
      continue;
    }
    if (!value.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
      continue;
    }
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawKey, next);
      index += 1;
      continue;
    }
    flags.set(rawKey, true);
  }
  return { command, flags };
}

function getFlag(flags, key, fallback) {
  const value = flags.get(key);
  return value === undefined ? fallback : value;
}

function ensureDir(fileOrDirPath, isDir = false) {
  const dir = isDir ? fileOrDirPath : path.dirname(fileOrDirPath);
  mkdirSync(dir, { recursive: true });
}

function openDb(dbPath) {
  ensureDir(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function columnExists(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      show_id TEXT NOT NULL,
      projection_id TEXT,
      user_show_id TEXT,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      status TEXT NOT NULL,
      watched_episodes_count INTEGER NOT NULL DEFAULT 0,
      total_episodes INTEGER,
      released_episodes INTEGER,
      remaining_episodes INTEGER,
      new_episode_signal_at INTEGER,
      tmdb_id INTEGER,
      tvmaze_id INTEGER,
      anilist_id INTEGER,
      mal_id INTEGER,
      imdb_id TEXT,
      first_aired TEXT,
      last_watched_at INTEGER,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_events (
      id TEXT PRIMARY KEY,
      source_provider TEXT NOT NULL,
      provider_show_id TEXT NOT NULL,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      region TEXT,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      name TEXT,
      air_date TEXT NOT NULL,
      air_timestamp INTEGER NOT NULL,
      tmdb_id INTEGER,
      tvmaze_id INTEGER,
      anilist_id INTEGER,
      mal_id INTEGER,
      imdb_id TEXT,
      inserted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS release_facts (
      canonical_key TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      provider_ids_json TEXT NOT NULL,
      match_confidence TEXT NOT NULL,
      release_state TEXT NOT NULL,
      released_episodes INTEGER,
      total_episodes INTEGER,
      latest_released_json TEXT,
      next_scheduled_json TEXT,
      source_provider TEXT,
      reconciled_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS convex_deltas (
      canonical_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      applied_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit_issues (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      issue_key TEXT,
      canonical_key TEXT,
      show_id TEXT,
      title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_resolutions (
      issue_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      note TEXT,
      tmdb_id INTEGER,
      tvmaze_id INTEGER,
      anilist_id INTEGER,
      mal_id INTEGER,
      imdb_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manual_provider_links (
      show_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER,
      tvmaze_id INTEGER,
      anilist_id INTEGER,
      mal_id INTEGER,
      imdb_id TEXT,
      note TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      scanned_items INTEGER NOT NULL DEFAULT 0,
      changed_facts INTEGER NOT NULL DEFAULT 0,
      audit_issues INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_library_title ON library_items(media_type, normalized_title);
    CREATE INDEX IF NOT EXISTS idx_provider_title ON provider_events(media_type, normalized_title);
    CREATE INDEX IF NOT EXISTS idx_provider_tvmaze ON provider_events(tvmaze_id);
    CREATE INDEX IF NOT EXISTS idx_provider_anilist ON provider_events(anilist_id);
    CREATE INDEX IF NOT EXISTS idx_provider_mal ON provider_events(mal_id);
    CREATE INDEX IF NOT EXISTS idx_provider_tmdb ON provider_events(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_provider_imdb ON provider_events(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_issues(issue_type);
    CREATE INDEX IF NOT EXISTS idx_manual_provider_media_title ON manual_provider_links(media_type, title);
  `);
  addColumnIfMissing(db, "library_items", "last_watched_at", "INTEGER");
  addColumnIfMissing(db, "library_items", "remaining_episodes", "INTEGER");
  addColumnIfMissing(db, "library_items", "new_episode_signal_at", "INTEGER");
  addColumnIfMissing(db, "audit_issues", "run_id", "TEXT");
  addColumnIfMissing(db, "audit_issues", "issue_key", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_issues(run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_issue_key ON audit_issues(issue_key);
  `);
}

function normalizeTitle(title) {
  return String(title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function parseAirTimestamp(airDate) {
  const parsed = new Date(airDate);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid air date: ${airDate}`);
  }
  return parsed.getTime();
}

function providerIdsFromRecord(record) {
  return {
    tmdbId: numberOrNull(record.tmdbId ?? record.tmdb_id),
    tvmazeId: numberOrNull(record.tvmazeId ?? record.tvmaze_id),
    anilistId: numberOrNull(record.anilistId ?? record.anilist_id),
    malId: numberOrNull(record.malId ?? record.mal_id),
    imdbId: stringOrNull(record.imdbId ?? record.imdb_id),
  };
}

function compactProviderIds(providerIds) {
  return Object.fromEntries(
    Object.entries(providerIds).filter(([, value]) => value !== null && value !== undefined)
  );
}

function canonicalKeyForItem(item) {
  if (item.media_type === "anime") {
    if (item.anilist_id !== null && item.anilist_id !== undefined) {
      return `anilist:anime:${item.anilist_id}`;
    }
    if (item.mal_id !== null && item.mal_id !== undefined) {
      return `mal:anime:${item.mal_id}`;
    }
  }
  if (item.tmdb_id !== null && item.tmdb_id !== undefined) {
    return `tmdb:${item.media_type}:${item.tmdb_id}`;
  }
  if (item.tvmaze_id !== null && item.tvmaze_id !== undefined) {
    return `tvmaze:${item.media_type}:${item.tvmaze_id}`;
  }
  if (item.imdb_id) {
    return `imdb:${item.media_type}:${item.imdb_id}`;
  }
  return `local:${item.show_id}`;
}

function dateKeyFromValue(value) {
  if (!value) {
    return null;
  }
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct?.[1]) {
    return direct[1];
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function yearFromDateValue(value) {
  const dateKey = dateKeyFromValue(value);
  return dateKey ? Number(dateKey.slice(0, 4)) : null;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableIssueKey(issue) {
  return hashJson({
    canonicalKey: issue.canonicalKey ?? null,
    showId: issue.showId ?? null,
    title: normalizeTitle(issue.title),
    mediaType: issue.mediaType,
    issueType: issue.issueType,
  }).slice(0, 24);
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function clearFixtures(db) {
  db.exec(`
    DELETE FROM library_items WHERE id LIKE 'fixture-%';
    DELETE FROM provider_events WHERE id LIKE 'fixture-%';
    DELETE FROM release_facts;
    DELETE FROM convex_deltas;
    DELETE FROM audit_issues;
  `);
}

function upsertLibraryItem(db, item, importedAt = Date.now()) {
  const providerIds = providerIdsFromRecord(item);
  db.prepare(`
    INSERT INTO library_items (
      id, user_id, show_id, projection_id, user_show_id, title, normalized_title,
      media_type, status, watched_episodes_count, total_episodes, released_episodes,
      remaining_episodes, new_episode_signal_at, tmdb_id, tvmaze_id, anilist_id,
      mal_id, imdb_id, first_aired, last_watched_at, imported_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      show_id = excluded.show_id,
      projection_id = excluded.projection_id,
      user_show_id = excluded.user_show_id,
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      media_type = excluded.media_type,
      status = excluded.status,
      watched_episodes_count = excluded.watched_episodes_count,
      total_episodes = excluded.total_episodes,
      released_episodes = excluded.released_episodes,
      remaining_episodes = excluded.remaining_episodes,
      new_episode_signal_at = excluded.new_episode_signal_at,
      tmdb_id = excluded.tmdb_id,
      tvmaze_id = excluded.tvmaze_id,
      anilist_id = excluded.anilist_id,
      mal_id = excluded.mal_id,
      imdb_id = excluded.imdb_id,
      first_aired = excluded.first_aired,
      last_watched_at = excluded.last_watched_at,
      imported_at = excluded.imported_at
  `).run(
    item.id ?? `${item.showId}:${item.userId ?? "unknown"}`,
    stringOrNull(item.userId ?? item.user_id),
    String(item.showId ?? item.show_id),
    stringOrNull(item.projectionId ?? item.projection_id),
    stringOrNull(item.userShowId ?? item.user_show_id),
    item.title,
    normalizeTitle(item.title),
    item.mediaType ?? item.media_type,
    item.status,
    Math.max(0, Math.floor(numberOrNull(item.watchedEpisodesCount ?? item.watched_episodes_count) ?? 0)),
    numberOrNull(item.totalEpisodes ?? item.total_episodes),
    numberOrNull(item.releasedEpisodes ?? item.released_episodes),
    numberOrNull(item.remainingEpisodes ?? item.remaining_episodes),
    numberOrNull(item.newEpisodeSignalAt ?? item.new_episode_signal_at),
    providerIds.tmdbId,
    providerIds.tvmazeId,
    providerIds.anilistId,
    providerIds.malId,
    providerIds.imdbId,
    stringOrNull(item.firstAired ?? item.first_aired),
    numberOrNull(item.lastWatchedAt ?? item.last_watched_at),
    importedAt
  );
}

function getManualProviderLink(db, showId) {
  if (!showId) {
    return null;
  }
  return db
    .prepare("SELECT * FROM manual_provider_links WHERE show_id = ?")
    .get(String(showId));
}

function applyManualProviderLink(db, item) {
  const link = getManualProviderLink(db, item.show_id);
  if (!link) {
    return item;
  }
  return {
    ...item,
    tmdb_id: link.tmdb_id ?? item.tmdb_id,
    tvmaze_id: link.tvmaze_id ?? item.tvmaze_id,
    anilist_id: link.anilist_id ?? item.anilist_id,
    mal_id: link.mal_id ?? item.mal_id,
    imdb_id: link.imdb_id ?? item.imdb_id,
  };
}

function upsertManualProviderLink(db, link) {
  const providerIds = providerIdsFromRecord(link);
  const showId = stringOrNull(link.showId ?? link.show_id);
  if (!showId) {
    throw new Error("Manual provider link requires showId.");
  }
  const now = Date.now();
  db.prepare(`
    INSERT INTO manual_provider_links (
      show_id, title, media_type, tmdb_id, tvmaze_id, anilist_id, mal_id, imdb_id, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(show_id) DO UPDATE SET
      title = excluded.title,
      media_type = excluded.media_type,
      tmdb_id = excluded.tmdb_id,
      tvmaze_id = excluded.tvmaze_id,
      anilist_id = excluded.anilist_id,
      mal_id = excluded.mal_id,
      imdb_id = excluded.imdb_id,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(
    showId,
    String(link.title ?? ""),
    String(link.mediaType ?? link.media_type ?? ""),
    providerIds.tmdbId,
    providerIds.tvmazeId,
    providerIds.anilistId,
    providerIds.malId,
    providerIds.imdbId,
    stringOrNull(link.note),
    now
  );
  return { showId, updatedAt: now };
}

function upsertProviderEvent(db, event, insertedAt = Date.now()) {
  const providerIds = {
    ...providerIdsFromRecord(event),
    ...providerIdsFromRecord(event.providers ?? {}),
  };
  const eventId =
    event.id ??
    `${event.sourceProvider}:${event.providerShowId}:${event.seasonNumber}:${event.episodeNumber}:${event.airDate}`;
  db.prepare(`
    INSERT INTO provider_events (
      id, source_provider, provider_show_id, title, normalized_title, media_type,
      region, season_number, episode_number, name, air_date, air_timestamp,
      tmdb_id, tvmaze_id, anilist_id, mal_id, imdb_id, inserted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_provider = excluded.source_provider,
      provider_show_id = excluded.provider_show_id,
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      media_type = excluded.media_type,
      region = excluded.region,
      season_number = excluded.season_number,
      episode_number = excluded.episode_number,
      name = excluded.name,
      air_date = excluded.air_date,
      air_timestamp = excluded.air_timestamp,
      tmdb_id = excluded.tmdb_id,
      tvmaze_id = excluded.tvmaze_id,
      anilist_id = excluded.anilist_id,
      mal_id = excluded.mal_id,
      imdb_id = excluded.imdb_id,
      inserted_at = excluded.inserted_at
  `).run(
    eventId,
    event.sourceProvider,
    event.providerShowId,
    event.title,
    normalizeTitle(event.title),
    event.mediaType,
    stringOrNull(event.region),
    Number(event.seasonNumber),
    Number(event.episodeNumber),
    stringOrNull(event.name),
    event.airDate,
    parseAirTimestamp(event.airDate),
    providerIds.tmdbId,
    providerIds.tvmazeId,
    providerIds.anilistId,
    providerIds.malId,
    providerIds.imdbId,
    insertedAt
  );
}

function seedFixtures(db) {
  initDb(db);
  clearFixtures(db);
  for (const item of fixtureLibrary) {
    upsertLibraryItem(db, item, fixtureNowMs);
  }
  for (const event of fixtureProviderEvents) {
    upsertProviderEvent(db, { ...event, id: `fixture-${event.providerShowId}-${event.episodeNumber}` }, fixtureNowMs);
  }
  return {
    libraryItems: fixtureLibrary.length,
    providerEvents: fixtureProviderEvents.length,
  };
}

function seedSyntheticProviderEvents(db) {
  initDb(db);
  const insertedAt = Date.now();
  for (const event of syntheticProviderEvents) {
    upsertProviderEvent(db, {
      ...event,
      id: `synthetic-${event.providerShowId}-${event.episodeNumber}`,
    }, insertedAt);
  }
  return {
    providerEvents: syntheticProviderEvents.length,
  };
}

function getLibraryItems(db) {
  return db.prepare("SELECT * FROM library_items ORDER BY title").all();
}

function getProviderEvents(db) {
  return db.prepare("SELECT * FROM provider_events ORDER BY air_timestamp").all();
}

function findEventsForItem(db, item) {
  const directClauses = [];
  const directParams = [];
  for (const [column, value] of [
    ["tmdb_id", item.tmdb_id],
    ["tvmaze_id", item.tvmaze_id],
    ["anilist_id", item.anilist_id],
    ["mal_id", item.mal_id],
    ["imdb_id", item.imdb_id],
  ]) {
    if (value !== null && value !== undefined && value !== "") {
      directClauses.push(`${column} = ?`);
      directParams.push(value);
    }
  }

  if (directClauses.length) {
    const rows = db
      .prepare(
        `SELECT * FROM provider_events WHERE media_type = ? AND (${directClauses.join(" OR ")}) ORDER BY air_timestamp`
      )
      .all(item.media_type, ...directParams);
    if (rows.length) {
      const hasDirect = rows.some(
        (row) =>
          (item.tmdb_id !== null && row.tmdb_id === item.tmdb_id) ||
          (item.tvmaze_id !== null && row.tvmaze_id === item.tvmaze_id) ||
          (item.anilist_id !== null && row.anilist_id === item.anilist_id) ||
          (item.mal_id !== null && row.mal_id === item.mal_id)
      );
      return {
        rows,
        confidence: hasDirect ? "direct_id" : "bridged_id",
      };
    }
  }

  const titleRows = db
    .prepare(
      "SELECT * FROM provider_events WHERE media_type = ? AND normalized_title = ? ORDER BY air_timestamp"
    )
    .all(item.media_type, item.normalized_title);
  if (titleRows.length) {
    return {
      rows: titleRows,
      confidence: "title_fallback",
    };
  }

  return { rows: [], confidence: "missing_provider" };
}

function episodeFromEvent(row) {
  return {
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    ...(row.name ? { name: row.name } : {}),
    airDate: row.air_date,
    airTimestamp: row.air_timestamp,
  };
}

function isGenericEpisodeName(name) {
  const normalized = normalizeTitle(name ?? "");
  return !normalized || /^episode\d+$/.test(normalized);
}

function eventNumberDedupeKey(row) {
  return `${row.media_type}:${row.normalized_title}:number:${row.season_number}:${row.episode_number}`;
}

function eventNameDedupeKey(row) {
  const dateKey = dateKeyFromValue(row.air_date) ?? "";
  const episodeName = normalizeTitle(row.name ?? "");
  if (episodeName && !isGenericEpisodeName(row.name)) {
    return `${row.media_type}:${row.normalized_title}:${dateKey}:name:${episodeName}`;
  }
  return null;
}

function eventDateDedupeKey(row) {
  const dateKey = dateKeyFromValue(row.air_date);
  return dateKey ? `${row.media_type}:${row.normalized_title}:date:${dateKey}` : null;
}

function eventSourcePriority(row) {
  if (row.source_provider === "tvmaze") {
    return 3;
  }
  if (row.source_provider === "anilist") {
    return 2;
  }
  if (row.source_provider === "tmdb") {
    return 1;
  }
  return 0;
}

function isCrossProviderSameDayDuplicate(next, current) {
  if (next.source_provider === current.source_provider) {
    return false;
  }

  const nextDateKey = eventDateDedupeKey(next);
  if (!nextDateKey || nextDateKey !== eventDateDedupeKey(current)) {
    return false;
  }

  return (
    isGenericEpisodeName(next.name) ||
    isGenericEpisodeName(current.name) ||
    String(next.air_date).includes("T") !== String(current.air_date).includes("T")
  );
}

function preferEventCandidate(next, current, matchKind = "name") {
  if (matchKind === "number") {
    const nameDelta =
      Number(!isGenericEpisodeName(next.name)) - Number(!isGenericEpisodeName(current.name));
    if (nameDelta !== 0) {
      return nameDelta > 0;
    }
  }

  const sourceDelta = eventSourcePriority(next) - eventSourcePriority(current);
  if (sourceDelta !== 0) {
    return sourceDelta > 0;
  }
  const precisionDelta =
    Number(String(next.air_date).includes("T")) - Number(String(current.air_date).includes("T"));
  if (precisionDelta !== 0) {
    return precisionDelta > 0;
  }
  return next.air_timestamp < current.air_timestamp;
}

function dedupeProviderEventsForSchedule(rows) {
  const deduped = [];
  for (const row of rows) {
    const numberKey = eventNumberDedupeKey(row);
    const nameKey = eventNameDedupeKey(row);
    const existingIndex = deduped.findIndex((candidate) => {
      const sameNumber = eventNumberDedupeKey(candidate) === numberKey;
      const sameName = nameKey !== null && eventNameDedupeKey(candidate) === nameKey;
      return sameNumber || sameName || isCrossProviderSameDayDuplicate(row, candidate);
    });
    if (existingIndex === -1) {
      deduped.push(row);
      continue;
    }

    const existing = deduped[existingIndex];
    const matchKind = eventNumberDedupeKey(existing) === numberKey ? "number" : "date";
    if (preferEventCandidate(row, existing, matchKind)) {
      deduped[existingIndex] = row;
    }
  }
  return deduped.sort((a, b) => a.air_timestamp - b.air_timestamp);
}

function dedupeSingleShowEventsForSchedule(rows) {
  const deduped = [];
  for (const row of rows) {
    const dateKey = dateKeyFromValue(row.air_date);
    const nameKey = !isGenericEpisodeName(row.name)
      ? `${dateKey ?? ""}:name:${normalizeTitle(row.name ?? "")}`
      : null;
    const existingIndex = deduped.findIndex((candidate) => {
      const sameNumber =
        candidate.season_number === row.season_number &&
        candidate.episode_number === row.episode_number;
      const sameName =
        nameKey !== null &&
        dateKeyFromValue(candidate.air_date) === dateKey &&
        !isGenericEpisodeName(candidate.name) &&
        normalizeTitle(candidate.name ?? "") === normalizeTitle(row.name ?? "");
      return (
        sameNumber ||
        sameName ||
        isCrossProviderSameDayDuplicate(row, candidate)
      );
    });

    if (existingIndex === -1) {
      deduped.push(row);
      continue;
    }

    const existing = deduped[existingIndex];
    const matchKind =
      existing.season_number === row.season_number &&
      existing.episode_number === row.episode_number
        ? "number"
        : "date";
    if (preferEventCandidate(row, existing, matchKind)) {
      deduped[existingIndex] = row;
    }
  }

  return deduped.sort((a, b) => a.air_timestamp - b.air_timestamp);
}

function createAuditIssue(db, issue) {
  const issueKey = issue.issueKey ?? stableIssueKey(issue);
  db.prepare(`
    INSERT INTO audit_issues (
      id, run_id, issue_key, canonical_key, show_id, title, media_type, issue_type, severity, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    issue.runId ?? null,
    issueKey,
    issue.canonicalKey ?? null,
    issue.showId ?? null,
    issue.title,
    issue.mediaType,
    issue.issueType,
    issue.severity,
    JSON.stringify(issue.details ?? {}),
    issue.createdAt ?? Date.now()
  );
}

function findProviderConflicts(item, rows) {
  const conflicts = [];
  for (const row of rows) {
    for (const [column, label] of [
      ["tmdb_id", "tmdbId"],
      ["tvmaze_id", "tvmazeId"],
      ["anilist_id", "anilistId"],
      ["mal_id", "malId"],
      ["imdb_id", "imdbId"],
    ]) {
      if (
        item[column] !== null &&
        item[column] !== undefined &&
        row[column] !== null &&
        row[column] !== undefined &&
        item[column] !== row[column]
      ) {
        conflicts.push({
          provider: label,
          libraryValue: item[column],
          eventValue: row[column],
          eventId: row.id,
          providerShowId: row.provider_show_id,
        });
      }
    }
  }
  return conflicts;
}

function hasCompleteStaticReleaseMetadata(item) {
  return (
    typeof item.total_episodes === "number" &&
    item.total_episodes > 0 &&
    typeof item.released_episodes === "number" &&
    item.released_episodes >= item.total_episodes
  );
}

function needsMissingProviderAudit(item) {
  if (!hasCompleteStaticReleaseMetadata(item)) {
    return true;
  }

  if (item.status === "completed" || item.status === "dropped" || item.status === "plan_to_watch") {
    return false;
  }

  if (
    item.status === "watching" &&
    typeof item.released_episodes === "number" &&
    item.watched_episodes_count >= item.released_episodes
  ) {
    return false;
  }

  return true;
}

function buildReleaseFact(item, match, nowMs, reconciledAt) {
  const scheduleRows = dedupeProviderEventsForSchedule(match.rows);
  const releasedEvents = scheduleRows.filter((row) => row.air_timestamp <= nowMs);
  const allFutureEvents = dedupeSingleShowEventsForSchedule(
    scheduleRows.filter((row) => row.air_timestamp > nowMs)
  );
  const futureEvents = allFutureEvents.filter((row) => row.air_timestamp <= nowMs + scheduleLookaheadMs);
  const latestReleased = releasedEvents.at(-1);
  const nextScheduled = futureEvents[0];
  const providerIds = compactProviderIds({
    tmdbId: item.tmdb_id,
    tvmazeId: item.tvmaze_id ?? match.rows.find((row) => row.tvmaze_id !== null)?.tvmaze_id,
    anilistId: item.anilist_id,
    malId: item.mal_id,
    imdbId: item.imdb_id ?? match.rows.find((row) => row.imdb_id)?.imdb_id,
  });
  const hasKnownFutureEvents = allFutureEvents.length > 0;
  const latestReleaseIsAlreadyWatched =
    latestReleased &&
    typeof item.last_watched_at === "number" &&
    latestReleased.air_timestamp <= item.last_watched_at;
  const hasSparseOldReleaseHistory =
    !hasKnownFutureEvents &&
    releasedEvents.length <= 1 &&
    latestReleaseIsAlreadyWatched;
  const rawReleasedEpisodes = hasKnownFutureEvents
    ? Math.max(item.watched_episodes_count ?? 0, releasedEvents.length)
    : hasSparseOldReleaseHistory
      ? Math.max(item.watched_episodes_count ?? 0, releasedEvents.length)
    : Math.max(
        item.released_episodes ?? 0,
        item.watched_episodes_count ?? 0,
        item.total_episodes ?? 0,
        releasedEvents.length,
        ...releasedEvents.map((row) => row.episode_number)
      );
  const releasedEpisodes =
    latestReleaseIsAlreadyWatched &&
    (releasedEvents.length <= (item.watched_episodes_count ?? 0) ||
      rawReleasedEpisodes - (item.watched_episodes_count ?? 0) <= 1)
      ? item.watched_episodes_count ?? rawReleasedEpisodes
      : rawReleasedEpisodes;
  const totalEpisodes = Math.max(
    item.total_episodes ?? 0,
    releasedEpisodes,
    ...match.rows.map((row) => row.episode_number)
  );
  const releaseState =
    latestReleased && item.watched_episodes_count < releasedEpisodes
      ? "available_now"
      : nextScheduled
        ? "upcoming"
        : match.rows.length
          ? "caught_up"
          : "unknown";

  return {
    canonicalKey: canonicalKeyForItem(item),
    showId: item.show_id,
    title: item.title,
    mediaType: item.media_type,
    providerIds,
    matchConfidence: match.confidence,
    releaseState,
    releasedEpisodes,
    totalEpisodes,
    latestReleased: latestReleased ? episodeFromEvent(latestReleased) : undefined,
    nextScheduled: nextScheduled ? episodeFromEvent(nextScheduled) : undefined,
    upcomingEpisodes: futureEvents.map((event) => episodeFromEvent(event)),
    sourceProvider: latestReleased?.source_provider ?? nextScheduled?.source_provider,
    reconciledAt,
  };
}

function shouldClearStaleEpisodeSignal(item, fact) {
  if (item.status !== "watching" && item.status !== "completed") {
    return false;
  }
  const signalAt = numberOrNull(item.newEpisodeSignalAt ?? item.new_episode_signal_at);
  if (typeof signalAt !== "number") {
    return false;
  }
  const lastWatchedAt = numberOrNull(item.lastWatchedAt ?? item.last_watched_at) ?? 0;
  if (signalAt <= lastWatchedAt) {
    return false;
  }
  if (typeof fact.releasedEpisodes !== "number") {
    return false;
  }
  const watchedCount = Math.max(
    0,
    Math.floor(numberOrNull(item.watchedEpisodesCount ?? item.watched_episodes_count) ?? 0)
  );
  return watchedCount >= fact.releasedEpisodes;
}

function storeFactAndDelta(db, fact, item, createdAt) {
  const clearStaleEpisodeSignal = shouldClearStaleEpisodeSignal(item, fact);
  const payload = {
    canonicalKey: fact.canonicalKey,
    showId: item.show_id,
    title: fact.title,
    mediaType: fact.mediaType,
    providerIds: fact.providerIds,
    matchConfidence: fact.matchConfidence,
    releaseState: fact.releaseState,
    releasedEpisodes: fact.releasedEpisodes,
    totalEpisodes: fact.totalEpisodes,
    latestReleased: fact.latestReleased,
    nextScheduled: fact.nextScheduled,
    upcomingEpisodes: fact.upcomingEpisodes,
    sourceProvider: fact.sourceProvider,
    reconciledAt: fact.reconciledAt,
    simulatedProjection: {
      showId: item.show_id,
      status:
        item.status === "completed" && fact.releaseState === "available_now"
          ? item.watched_episodes_count > 0
            ? "watching"
            : "plan_to_watch"
          : item.status,
      remainingEpisodes:
        typeof fact.releasedEpisodes === "number"
          ? Math.max(fact.releasedEpisodes - item.watched_episodes_count, 0)
          : null,
      hasHomeAttention: fact.releaseState === "available_now",
      hasUpcomingSchedule: Boolean(fact.nextScheduled),
    },
  };
  if (clearStaleEpisodeSignal) {
    payload.clearStaleEpisodeSignal = true;
  }
  const stablePayload = {
    ...payload,
    reconciledAt: undefined,
    clearStaleEpisodeSignal: undefined,
  };
  delete stablePayload.reconciledAt;
  delete stablePayload.clearStaleEpisodeSignal;
  const checksum = hashJson(stablePayload);
  const deltaChecksum = clearStaleEpisodeSignal
    ? hashJson({ ...stablePayload, clearStaleEpisodeSignal: true })
    : checksum;
  const previousFact = db
    .prepare("SELECT checksum FROM release_facts WHERE canonical_key = ?")
    .get(fact.canonicalKey);
  const existingDelta = db
    .prepare("SELECT applied_at FROM convex_deltas WHERE canonical_key = ?")
    .get(fact.canonicalKey);
  const changed = previousFact?.checksum !== checksum;

  db.prepare(`
    INSERT INTO release_facts (
      canonical_key, show_id, title, media_type, provider_ids_json, match_confidence,
      release_state, released_episodes, total_episodes, latest_released_json,
      next_scheduled_json, source_provider, reconciled_at, checksum
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      show_id = excluded.show_id,
      title = excluded.title,
      media_type = excluded.media_type,
      provider_ids_json = excluded.provider_ids_json,
      match_confidence = excluded.match_confidence,
      release_state = excluded.release_state,
      released_episodes = excluded.released_episodes,
      total_episodes = excluded.total_episodes,
      latest_released_json = excluded.latest_released_json,
      next_scheduled_json = excluded.next_scheduled_json,
      source_provider = excluded.source_provider,
      reconciled_at = excluded.reconciled_at,
      checksum = excluded.checksum
  `).run(
    fact.canonicalKey,
    fact.showId,
    fact.title,
    fact.mediaType,
    JSON.stringify(fact.providerIds),
    fact.matchConfidence,
    fact.releaseState,
    fact.releasedEpisodes ?? null,
    fact.totalEpisodes ?? null,
    fact.latestReleased ? JSON.stringify(fact.latestReleased) : null,
    fact.nextScheduled ? JSON.stringify(fact.nextScheduled) : null,
    fact.sourceProvider ?? null,
    fact.reconciledAt,
    checksum
  );

  if (changed || clearStaleEpisodeSignal) {
    db.prepare(`
      INSERT INTO convex_deltas (canonical_key, payload_json, checksum, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(canonical_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        checksum = excluded.checksum,
        created_at = excluded.created_at,
        applied_at = NULL
    `).run(fact.canonicalKey, JSON.stringify(payload), deltaChecksum, createdAt);
  } else if (!existingDelta || existingDelta.applied_at !== null) {
    db.prepare("DELETE FROM convex_deltas WHERE canonical_key = ?").run(fact.canonicalKey);
  }

  return { payload, changed };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function getTmdbAuth() {
  const token = process.env.EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN?.trim();
  const key = process.env.EXPO_PUBLIC_TMDB_API_KEY?.trim();
  if (key && !key.startsWith("your_")) {
    return { headers: {}, apiKey: key };
  }
  if (token && !token.startsWith("your_")) {
    return { headers: { Authorization: `Bearer ${token}` }, apiKey: null };
  }
  return null;
}

async function fetchTmdbDetails(item) {
  if (!item.tmdb_id || item.media_type === "anime") {
    return [];
  }
  const auth = getTmdbAuth();
  if (!auth) {
    return [];
  }
  const base = process.env.EXPO_PUBLIC_TMDB_BASE_URL?.replace(/\/+$/, "") ?? "https://api.themoviedb.org/3";
  const url = new URL(`${base}/${item.media_type}/${item.tmdb_id}`);
  url.searchParams.set("append_to_response", "external_ids");
  if (auth.apiKey) {
    url.searchParams.set("api_key", auth.apiKey);
  }
  const details = await fetchJson(url, { headers: auth.headers });
  const externalIds = details.external_ids ?? {};
  const imdbId = externalIds.imdb_id ?? details.imdb_id ?? item.imdb_id;
  const events = [];
  const sources = [details.last_episode_to_air, details.next_episode_to_air];

  const nextSeasonNumber = details.next_episode_to_air?.season_number;
  if (Number.isFinite(nextSeasonNumber)) {
    const seasonUrl = new URL(`${base}/${item.media_type}/${item.tmdb_id}/season/${nextSeasonNumber}`);
    if (auth.apiKey) {
      seasonUrl.searchParams.set("api_key", auth.apiKey);
    }
    const seasonDetails = await fetchJson(seasonUrl, { headers: auth.headers });
    if (Array.isArray(seasonDetails.episodes)) {
      sources.push(...seasonDetails.episodes);
    }
  }

  for (const source of sources) {
    if (!source?.air_date || !source.season_number || !source.episode_number) {
      continue;
    }
    events.push({
      sourceProvider: "tmdb",
      providerShowId: `tmdb:${item.media_type}:${item.tmdb_id}`,
      title: details.name ?? details.title ?? item.title,
      mediaType: item.media_type,
      region: "global",
      seasonNumber: source.season_number,
      episodeNumber: source.episode_number,
      name: source.name,
      airDate: source.air_date,
      providers: {
        tmdbId: item.tmdb_id,
        imdbId,
      },
    });
  }
  return events;
}

async function resolveTvMazeShowForItem(item) {
  if (item.tvmaze_id) {
    return { id: item.tvmaze_id, name: item.title, externals: { imdb: item.imdb_id } };
  }
  if (item.media_type !== "tv" || !item.title) {
    return null;
  }

  const base = process.env.EXPO_PUBLIC_TVMAZE_BASE_URL?.replace(/\/+$/, "") ?? "https://api.tvmaze.com";
  const url = new URL(`${base}/search/shows`);
  url.searchParams.set("q", item.title);
  const results = await fetchJson(url);
  if (!Array.isArray(results)) {
    return null;
  }

  const normalizedTitle = normalizeTitle(item.title);
  const firstAiredYear = yearFromDateValue(item.first_aired);
  const exactTitleMatches = results
    .map((result) => result?.show)
    .filter((show) => show && normalizeTitle(show.name ?? "") === normalizedTitle);

  if (item.imdb_id) {
    const imdbMatch = exactTitleMatches.find((show) => show.externals?.imdb === item.imdb_id);
    if (imdbMatch) {
      return imdbMatch;
    }
  }

  if (typeof firstAiredYear === "number") {
    const yearMatch = exactTitleMatches.find((show) => {
      const premieredYear = yearFromDateValue(show.premiered);
      return typeof premieredYear === "number" && Math.abs(premieredYear - firstAiredYear) <= 1;
    });
    if (yearMatch) {
      return yearMatch;
    }
  }

  return exactTitleMatches[0] ?? null;
}

async function fetchTvMazeEpisodes(item) {
  const show = await resolveTvMazeShowForItem(item);
  if (!show?.id) {
    return [];
  }
  const base = process.env.EXPO_PUBLIC_TVMAZE_BASE_URL?.replace(/\/+$/, "") ?? "https://api.tvmaze.com";
  const episodes = await fetchJson(`${base}/shows/${show.id}/episodes`);
  return episodes
    .filter((episode) => episode.airdate && episode.season && episode.number)
    .map((episode) => ({
      sourceProvider: "tvmaze",
      providerShowId: `tvmaze:${show.id}`,
      title: item.title,
      mediaType: item.media_type,
      region: "global",
      seasonNumber: episode.season,
      episodeNumber: episode.number,
      name: episode.name,
      airDate: episode.airstamp ?? episode.airdate,
      providers: {
        tmdbId: item.tmdb_id,
        tvmazeId: show.id,
        imdbId: item.imdb_id ?? show.externals?.imdb,
      },
    }));
}

async function fetchAniListSchedule(item) {
  if (!item.anilist_id) {
    return [];
  }
  const url = process.env.EXPO_PUBLIC_ANILIST_URL ?? "https://graphql.anilist.co";
  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            idMal
            title { romaji english }
            episodes
            nextAiringEpisode { airingAt episode }
          }
        }
      `,
      variables: { id: item.anilist_id },
    }),
  });
  const media = data?.data?.Media;
  const next = media?.nextAiringEpisode;
  if (!media || !next?.airingAt || !next?.episode) {
    return [];
  }
  return [
    {
      sourceProvider: "anilist",
      providerShowId: `anilist:${media.id}`,
      title: media.title?.english ?? media.title?.romaji ?? item.title,
      mediaType: "anime",
      region: "JP",
      seasonNumber: 1,
      episodeNumber: next.episode,
      name: `Episode ${next.episode}`,
      airDate: new Date(next.airingAt * 1000).toISOString(),
      providers: {
        anilistId: media.id,
        malId: media.idMal ?? item.mal_id,
      },
    },
  ];
}

async function hydrateProviderEventsFromRealApis(db, item, insertedAt) {
  if (item.title.startsWith(syntheticPrefix)) {
    return [];
  }

  const errors = [];
  const upsertEvents = (events) => {
    for (const event of events) {
      upsertProviderEvent(db, event, insertedAt);
    }
  };

  try {
    const tmdbEvents = await fetchTmdbDetails(item);
    upsertEvents(tmdbEvents);
    const resolvedImdbId =
      item.imdb_id ??
      tmdbEvents.map((event) => event.providers?.imdbId).find((value) => typeof value === "string");
    const providerItem =
      resolvedImdbId && !item.imdb_id ? { ...item, imdb_id: resolvedImdbId } : item;
    const hasTmdbFuture = tmdbEvents.some((event) => parseAirTimestamp(event.airDate) > Date.now());
    const isIncomplete =
      typeof item.total_episodes === "number" &&
      typeof item.released_episodes === "number" &&
      item.released_episodes < item.total_episodes;
    const shouldFetchTvMaze =
      Boolean(providerItem.tvmaze_id) ||
      (item.media_type === "tv" && (hasTmdbFuture || isIncomplete));
    if (shouldFetchTvMaze) {
      upsertEvents(await fetchTvMazeEpisodes(providerItem));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    upsertEvents(await fetchAniListSchedule(item));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

async function reconcile(db, options = {}) {
  initDb(db);
  const nowMs = options.nowMs ?? Date.now();
  const runId = options.runId ?? randomUUID();
  const startedAt = Date.now();
  db.prepare("INSERT INTO runs (id, mode, started_at) VALUES (?, ?, ?)").run(
    runId,
    options.mode ?? "local",
    startedAt
  );
  db.exec(`
    DELETE FROM audit_issues;
    DELETE FROM convex_deltas WHERE applied_at IS NOT NULL;
  `);

  const items = getLibraryItems(db);
  let changedFacts = 0;
  let realProviderErrors = 0;
  let skippedStaticMissingProviders = 0;

  for (const item of items) {
    if (item.media_type === "movie") {
      continue;
    }
    const reconciledItem = applyManualProviderLink(db, item);
    if (options.fetchProviders) {
      const errors = await hydrateProviderEventsFromRealApis(db, reconciledItem, Date.now());
      realProviderErrors += errors.length;
      for (const message of errors) {
        createAuditIssue(db, {
          runId,
          canonicalKey: canonicalKeyForItem(item),
          showId: item.show_id,
          title: item.title,
          mediaType: item.media_type,
          issueType: "provider_fetch_failed",
          severity: "warning",
          details: { message },
          createdAt: Date.now(),
        });
      }
    }

    const match = findEventsForItem(db, reconciledItem);
    if (match.confidence === "missing_provider") {
      if (!needsMissingProviderAudit(reconciledItem)) {
        skippedStaticMissingProviders += 1;
        continue;
      }
      createAuditIssue(db, {
        runId,
        canonicalKey: canonicalKeyForItem(item),
        showId: item.show_id,
        title: item.title,
        mediaType: item.media_type,
        issueType: "missing_provider_link",
        severity: "error",
        details: {
          reason: "No provider-qualified ID or title match produced a release source.",
        },
        createdAt: Date.now(),
      });
      continue;
    }

    if (match.confidence === "title_fallback") {
      createAuditIssue(db, {
        runId,
        canonicalKey: canonicalKeyForItem(item),
        showId: item.show_id,
        title: item.title,
        mediaType: item.media_type,
        issueType: "title_fallback_match",
        severity: "warning",
        details: {
          reason: "Release source matched by normalized title only; delta is generated but Convex import skips title_fallback rows.",
          matchedProviderShowIds: [...new Set(match.rows.map((row) => row.provider_show_id))],
        },
        createdAt: Date.now(),
      });
    }

    const conflicts = findProviderConflicts(reconciledItem, match.rows);
    if (conflicts.length > 0) {
      createAuditIssue(db, {
        runId,
        canonicalKey: canonicalKeyForItem(item),
        showId: item.show_id,
        title: item.title,
        mediaType: item.media_type,
        issueType: "conflicting_provider_ids",
        severity: "error",
        details: { conflicts },
        createdAt: Date.now(),
      });
    }

    const fact = buildReleaseFact(reconciledItem, match, nowMs, Date.now());
    const stored = storeFactAndDelta(db, fact, reconciledItem, Date.now());
    if (stored.changed) {
      changedFacts += 1;
    }
  }

  const auditCount = db.prepare("SELECT COUNT(*) AS count FROM audit_issues").get().count;
  const deltaRows = db.prepare("SELECT payload_json FROM convex_deltas").all();
  const deltaPayloadBytes = deltaRows.reduce(
    (sum, row) => sum + Buffer.byteLength(row.payload_json, "utf8"),
    0
  );
  const summary = {
    runId,
    scannedItems: items.length,
    changedFacts,
    auditIssues: auditCount,
    realProviderErrors,
    skippedStaticMissingProviders,
    deltas: deltaRows.length,
    deltaPayloadBytes,
  };
  db.prepare(`
    UPDATE runs
    SET finished_at = ?, scanned_items = ?, changed_facts = ?, audit_issues = ?, summary_json = ?
    WHERE id = ?
  `).run(Date.now(), items.length, changedFacts, auditCount, JSON.stringify(summary), runId);
  return summary;
}

function exportDeltas(db, deltaPath = defaultDeltaPath) {
  const rows = db
    .prepare("SELECT payload_json FROM convex_deltas WHERE applied_at IS NULL ORDER BY canonical_key")
    .all();
  const payloadBytes = rows.reduce(
    (sum, row) => sum + Buffer.byteLength(row.payload_json, "utf8"),
    0
  );
  const payload = {
    generatedAt: Date.now(),
    metrics: {
      exportedItems: rows.length,
      changedDeltas: rows.length,
      payloadBytes,
    },
    deltas: rows.map((row) => {
      const {
        simulatedProjection: _simulatedProjection,
        showId: _showId,
        ...delta
      } = JSON.parse(row.payload_json);
      return delta;
    }),
  };
  writeJson(deltaPath, payload);
  return { path: deltaPath, deltas: payload.deltas.length, payloadBytes };
}

function auditReport(db, auditPath = defaultAuditPath) {
  const issues = db.prepare("SELECT * FROM audit_issues ORDER BY severity, issue_type, title").all();
  const facts = db.prepare("SELECT * FROM release_facts ORDER BY title").all();
  const report = {
    generatedAt: Date.now(),
    issueCount: issues.length,
    issues: issues.map((issue) => ({
      canonicalKey: issue.canonical_key,
      showId: issue.show_id,
      title: issue.title,
      mediaType: issue.media_type,
      issueType: issue.issue_type,
      severity: issue.severity,
      details: JSON.parse(issue.details_json),
    })),
    facts: facts.map((fact) => ({
      canonicalKey: fact.canonical_key,
      showId: fact.show_id,
      title: fact.title,
      mediaType: fact.media_type,
      matchConfidence: fact.match_confidence,
      releaseState: fact.release_state,
      releasedEpisodes: fact.released_episodes,
      totalEpisodes: fact.total_episodes,
      latestReleased: fact.latest_released_json ? JSON.parse(fact.latest_released_json) : null,
      nextScheduled: fact.next_scheduled_json ? JSON.parse(fact.next_scheduled_json) : null,
    })),
  };
  writeJson(auditPath, report);
  return { path: auditPath, issueCount: issues.length, facts: facts.length };
}

async function importConvex(db, options) {
  const convexUrl = options.convexUrl ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const importToken = options.importToken ?? process.env.SCHEDULE_CONFIDENCE_IMPORT_TOKEN;
  if (!convexUrl || !importToken) {
    throw new Error("Set EXPO_PUBLIC_CONVEX_URL and SCHEDULE_CONFIDENCE_IMPORT_TOKEN.");
  }
  const { ConvexHttpClient } = await import("convex/browser");
  const { makeFunctionReference } = await import("convex/server");
  const client = new ConvexHttpClient(convexUrl);
  const exportTrackedLibrary = makeFunctionReference("scheduleConfidence:exportTrackedLibrary");
  let cursor = null;
  let imported = 0;
  do {
    const page = await client.query(exportTrackedLibrary, {
      importToken,
      paginationOpts: { cursor, numItems: options.pageSize ?? 100 },
    });
    for (const item of page.page) {
      if (item.mediaType === "movie") {
        continue;
      }
      upsertLibraryItem(db, {
        id: `${item.userId}:${item.showId}`,
        userId: item.userId,
        showId: item.showId,
        projectionId: item.projectionId,
        userShowId: item.userShowId,
        title: item.title,
        mediaType: item.mediaType,
        status: item.status,
        watchedEpisodesCount: item.watchedEpisodesCount,
        totalEpisodes: item.totalEpisodes,
        releasedEpisodes:
          item.tmdbId || item.tvmazeId || item.anilistId || item.malId || item.imdbId
            ? null
            : Math.max(
                0,
                (item.watchedEpisodesCount ?? 0) + (item.remainingEpisodes ?? 0)
              ),
        remainingEpisodes: item.remainingEpisodes,
        newEpisodeSignalAt: item.newEpisodeSignalAt,
        tmdbId: item.tmdbId,
        tvmazeId: item.tvmazeId,
        anilistId: item.anilistId,
        malId: item.malId,
        imdbId: item.imdbId,
        firstAired: item.firstAired,
        lastWatchedAt: item.lastWatchedAt,
      });
      imported += 1;
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return { imported };
}

async function getConvexClient(options) {
  const convexUrl = options.convexUrl ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const importToken = options.importToken ?? process.env.SCHEDULE_CONFIDENCE_IMPORT_TOKEN;
  if (!convexUrl || !importToken) {
    throw new Error("Set EXPO_PUBLIC_CONVEX_URL and SCHEDULE_CONFIDENCE_IMPORT_TOKEN.");
  }
  const { ConvexHttpClient } = await import("convex/browser");
  const { makeFunctionReference } = await import("convex/server");
  return {
    client: new ConvexHttpClient(convexUrl),
    makeFunctionReference,
    importToken,
  };
}

async function seedDevCases(options) {
  const { client, makeFunctionReference, importToken } = await getConvexClient(options);
  return client.mutation(makeFunctionReference("scheduleConfidence:seedSyntheticDevCases"), {
    importToken,
    reset: options.reset ?? true,
  });
}

async function cleanupDevCases(options) {
  const { client, makeFunctionReference, importToken } = await getConvexClient(options);
  return client.mutation(makeFunctionReference("scheduleConfidence:cleanupSyntheticDevCases"), {
    importToken,
  });
}

async function snapshotDevCases(options) {
  const { client, makeFunctionReference, importToken } = await getConvexClient(options);
  return client.query(makeFunctionReference("scheduleConfidence:getSyntheticDevCaseState"), {
    importToken,
  });
}

async function applyConvex(deltaPath, options) {
  const convexUrl = options.convexUrl ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const importToken = options.importToken ?? process.env.SCHEDULE_CONFIDENCE_IMPORT_TOKEN;
  if (!convexUrl || !importToken) {
    throw new Error("Set EXPO_PUBLIC_CONVEX_URL and SCHEDULE_CONFIDENCE_IMPORT_TOKEN.");
  }
  const payload = readJson(deltaPath);
  const { ConvexHttpClient } = await import("convex/browser");
  const { makeFunctionReference } = await import("convex/server");
  const client = new ConvexHttpClient(convexUrl);
  const applyReleaseDeltas = makeFunctionReference("scheduleConfidence:applyReleaseDeltas");
  const batchSize = options.batchSize ?? 25;
  const results = [];
  for (let index = 0; index < payload.deltas.length; index += batchSize) {
    const deltas = payload.deltas.slice(index, index + batchSize);
    const result = await client.mutation(applyReleaseDeltas, {
      importToken,
      runId: options.runId ?? `local-${payload.generatedAt}`,
      generatedAt: payload.generatedAt,
      deltas,
    });
    results.push(result);
    if (options.db) {
      const appliedAt = Date.now();
      const markApplied = options.db.prepare(
        "UPDATE convex_deltas SET applied_at = ? WHERE canonical_key = ?"
      );
      for (const delta of deltas) {
        markApplied.run(appliedAt, delta.canonicalKey);
      }
    }
  }
  const totals = results.reduce(
    (sum, result) => {
      for (const key of [
        "scanned",
        "matchedShows",
        "missingShows",
        "patchedShows",
        "patchedUserShows",
        "patchedFeedProjections",
        "resumedCompletedShows",
        "clearedStaleEpisodeSignals",
        "scheduleCacheRowsUpdated",
        "scheduleCacheRowsSkipped",
        "skippedTitleFallback",
        "skippedUnchangedShows",
        "skippedUnchangedUserShows",
        "skippedUnchangedFeedProjections",
      ]) {
        sum[key] = (sum[key] ?? 0) + (result[key] ?? 0);
      }
      return sum;
    },
    {
      exportedItems: payload.deltas.length,
      changedDeltas: payload.metrics?.changedDeltas ?? payload.deltas.length,
      payloadBytes:
        payload.metrics?.payloadBytes ??
        Buffer.byteLength(JSON.stringify(payload.deltas), "utf8"),
    }
  );
  return {
    batches: results.length,
    totals,
    results,
  };
}

function parseJsonField(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function readDashboardData(db) {
  initDb(db);
  const latestRun =
    db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").get() ?? null;
  const issues = db
    .prepare(`
      SELECT
        audit_issues.*,
        issue_resolutions.status AS resolution_status,
        issue_resolutions.note AS resolution_note,
        issue_resolutions.tmdb_id AS resolution_tmdb_id,
        issue_resolutions.tvmaze_id AS resolution_tvmaze_id,
        issue_resolutions.anilist_id AS resolution_anilist_id,
        issue_resolutions.mal_id AS resolution_mal_id,
        issue_resolutions.imdb_id AS resolution_imdb_id,
        issue_resolutions.updated_at AS resolution_updated_at
      FROM audit_issues
      LEFT JOIN issue_resolutions ON issue_resolutions.issue_key = audit_issues.issue_key
      ORDER BY
        CASE audit_issues.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        audit_issues.issue_type,
        audit_issues.title
    `)
    .all()
    .map((issue) => ({
      id: issue.id,
      runId: issue.run_id,
      issueKey: issue.issue_key,
      canonicalKey: issue.canonical_key,
      showId: issue.show_id,
      title: issue.title,
      mediaType: issue.media_type,
      issueType: issue.issue_type,
      severity: issue.severity,
      details: parseJsonField(issue.details_json, {}),
      createdAt: issue.created_at,
      createdAtIso: toIso(issue.created_at),
      resolution: issue.resolution_status
        ? {
            status: issue.resolution_status,
            note: issue.resolution_note,
            updatedAt: issue.resolution_updated_at,
            updatedAtIso: toIso(issue.resolution_updated_at),
            providerIds: compactProviderIds({
              tmdbId: issue.resolution_tmdb_id,
              tvmazeId: issue.resolution_tvmaze_id,
              anilistId: issue.resolution_anilist_id,
              malId: issue.resolution_mal_id,
              imdbId: issue.resolution_imdb_id,
            }),
          }
        : null,
      candidateEvents: db
        .prepare(
          `SELECT * FROM provider_events
           WHERE media_type = ? AND normalized_title = ?
           ORDER BY air_timestamp DESC
           LIMIT 8`
        )
        .all(issue.media_type, normalizeTitle(issue.title))
        .map((event) => ({
          id: event.id,
          sourceProvider: event.source_provider,
          providerShowId: event.provider_show_id,
          title: event.title,
          region: event.region,
          seasonNumber: event.season_number,
          episodeNumber: event.episode_number,
          name: event.name,
          airDate: event.air_date,
          providerIds: compactProviderIds({
            tmdbId: event.tmdb_id,
            tvmazeId: event.tvmaze_id,
            anilistId: event.anilist_id,
            malId: event.mal_id,
            imdbId: event.imdb_id,
          }),
        })),
    }));

  const releaseFacts = db
    .prepare(
      `SELECT * FROM release_facts
       ORDER BY
         CASE match_confidence WHEN 'direct_id' THEN 2 WHEN 'bridged_id' THEN 1 ELSE 0 END,
         title`
    )
    .all()
    .map((fact) => ({
      canonicalKey: fact.canonical_key,
      showId: fact.show_id,
      title: fact.title,
      mediaType: fact.media_type,
      providerIds: parseJsonField(fact.provider_ids_json, {}),
      matchConfidence: fact.match_confidence,
      releaseState: fact.release_state,
      releasedEpisodes: fact.released_episodes,
      totalEpisodes: fact.total_episodes,
      latestReleased: parseJsonField(fact.latest_released_json),
      nextScheduled: parseJsonField(fact.next_scheduled_json),
      sourceProvider: fact.source_provider,
      reconciledAt: fact.reconciled_at,
      reconciledAtIso: toIso(fact.reconciled_at),
    }));

  const manualLinks = db
    .prepare("SELECT * FROM manual_provider_links ORDER BY updated_at DESC, title LIMIT 200")
    .all()
    .map((link) => ({
      showId: link.show_id,
      title: link.title,
      mediaType: link.media_type,
      providerIds: compactProviderIds({
        tmdbId: link.tmdb_id,
        tvmazeId: link.tvmaze_id,
        anilistId: link.anilist_id,
        malId: link.mal_id,
        imdbId: link.imdb_id,
      }),
      note: link.note,
      updatedAt: link.updated_at,
      updatedAtIso: toIso(link.updated_at),
    }));

  const runs = db
    .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 20")
    .all()
    .map((run) => ({
      id: run.id,
      mode: run.mode,
      startedAt: run.started_at,
      startedAtIso: toIso(run.started_at),
      finishedAt: run.finished_at,
      finishedAtIso: toIso(run.finished_at),
      scannedItems: run.scanned_items,
      changedFacts: run.changed_facts,
      auditIssues: run.audit_issues,
      summary: parseJsonField(run.summary_json, {}),
    }));

  const unresolvedIssues = issues.filter(
    (issue) => !["fixed", "ignored"].includes(issue.resolution?.status ?? "")
  );
  const issueCounts = unresolvedIssues.reduce(
    (counts, issue) => {
      counts.total += 1;
      counts.byType[issue.issueType] = (counts.byType[issue.issueType] ?? 0) + 1;
      counts.bySeverity[issue.severity] = (counts.bySeverity[issue.severity] ?? 0) + 1;
      return counts;
    },
    { total: 0, byType: {}, bySeverity: {} }
  );

  return {
    generatedAt: Date.now(),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          mode: latestRun.mode,
          startedAt: latestRun.started_at,
          startedAtIso: toIso(latestRun.started_at),
          finishedAt: latestRun.finished_at,
          finishedAtIso: toIso(latestRun.finished_at),
          scannedItems: latestRun.scanned_items,
          changedFacts: latestRun.changed_facts,
          auditIssues: latestRun.audit_issues,
          summary: parseJsonField(latestRun.summary_json, {}),
        }
      : null,
    issueCounts,
    issues,
    lowConfidenceFacts: releaseFacts.filter((fact) => fact.matchConfidence !== "direct_id"),
    releaseFacts,
    manualLinks,
    runs,
    totals: {
      releaseFacts: releaseFacts.length,
      deltas: db.prepare("SELECT COUNT(*) AS count FROM convex_deltas").get().count,
      providerEvents: db.prepare("SELECT COUNT(*) AS count FROM provider_events").get().count,
      libraryItems: db.prepare("SELECT COUNT(*) AS count FROM library_items").get().count,
    },
  };
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function upsertIssueResolution(db, issueKey, payload) {
  const providerIds = providerIdsFromRecord(payload.providerIds ?? payload);
  const hasManualProvider =
    providerIds.tmdbId !== null ||
    providerIds.tvmazeId !== null ||
    providerIds.anilistId !== null ||
    providerIds.malId !== null ||
    providerIds.imdbId !== null;
  let status = stringOrNull(payload.status) ?? "needs_provider";
  if (hasManualProvider && status === "needs_provider") {
    status = "manual_link";
  }
  const allowedStatuses = new Set(["open", "needs_provider", "manual_link", "fixed", "ignored"]);
  if (!allowedStatuses.has(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }
  const now = Date.now();
  db.prepare(`
    INSERT INTO issue_resolutions (
      issue_key, status, note, tmdb_id, tvmaze_id, anilist_id, mal_id, imdb_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_key) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      tmdb_id = excluded.tmdb_id,
      tvmaze_id = excluded.tvmaze_id,
      anilist_id = excluded.anilist_id,
      mal_id = excluded.mal_id,
      imdb_id = excluded.imdb_id,
      updated_at = excluded.updated_at
  `).run(
    issueKey,
    status,
    stringOrNull(payload.note),
    providerIds.tmdbId,
    providerIds.tvmazeId,
    providerIds.anilistId,
    providerIds.malId,
    providerIds.imdbId,
    now
  );

  let manualLink = null;
  if (hasManualProvider && payload.showId) {
    manualLink = upsertManualProviderLink(db, {
      showId: payload.showId,
      title: payload.title,
      mediaType: payload.mediaType,
      note: payload.note,
      ...providerIds,
    });
  }

  return { issueKey, status, updatedAt: now, manualLink };
}

async function startDashboard(dbPath, options = {}) {
  const host = String(options.host ?? "127.0.0.1");
  const port = Number(options.port ?? 8787);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        sendText(response, 200, readFileSync(dashboardHtmlPath, "utf8"), "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const db = openDb(dbPath);
        try {
          sendJson(response, 200, readDashboardData(db));
        } finally {
          db.close();
        }
        return;
      }
      const issueResolutionMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/resolution$/);
      if (request.method === "POST" && issueResolutionMatch) {
        const db = openDb(dbPath);
        try {
          const payload = await readRequestJson(request);
          const result = upsertIssueResolution(
            db,
            decodeURIComponent(issueResolutionMatch[1]),
            payload
          );
          sendJson(response, 200, { ok: true, result, dashboard: readDashboardData(db) });
        } finally {
          db.close();
        }
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`Schedule confidence dashboard: http://${host}:${port}`);
}

function resetReconciliationTables(db) {
  db.exec(`
    DELETE FROM library_items;
    DELETE FROM provider_events;
    DELETE FROM release_facts;
    DELETE FROM convex_deltas;
    DELETE FROM audit_issues;
    DELETE FROM runs;
  `);
}

function getSnapshotRow(snapshot, titleSuffix) {
  return snapshot.rows.find((row) => row.title === `${syntheticPrefix} ${titleSuffix}`);
}

function hasScheduleEntry(row, date, mediaType, episodeNumber) {
  return row?.scheduleCacheEntries?.some(
    (entry) =>
      entry.date === date &&
      entry.mediaType === mediaType &&
      entry.episodeNumber === episodeNumber
  );
}

function firstProjection(row) {
  return row?.projections?.[0] ?? null;
}

function firstUserShow(row) {
  return row?.userShows?.[0] ?? null;
}

function aggregateApplyResults(applyResult) {
  return applyResult.results.reduce(
    (totals, result) => {
      for (const key of Object.keys(totals)) {
        totals[key] += result[key] ?? 0;
      }
      return totals;
    },
    {
      scanned: 0,
      matchedShows: 0,
      missingShows: 0,
      patchedShows: 0,
      patchedUserShows: 0,
      patchedFeedProjections: 0,
      resumedCompletedShows: 0,
      clearedStaleEpisodeSignals: 0,
      scheduleCacheRowsUpdated: 0,
      scheduleCacheRowsSkipped: 0,
      skippedTitleFallback: 0,
      skippedUnchangedShows: 0,
      skippedUnchangedUserShows: 0,
      skippedUnchangedFeedProjections: 0,
    }
  );
}

function validateDevWorkflowResults({
  beforeSnapshot,
  afterSnapshot,
  auditPath,
  deltaPath,
  importResult,
  reconcileSummary,
  applyResult,
}) {
  const audit = readJson(auditPath);
  const exportedDeltas = readJson(deltaPath).deltas;
  const applyTotals = aggregateApplyResults(applyResult);

  const direct = getSnapshotRow(afterSnapshot, "Direct Provider Match");
  const bridged = getSnapshotRow(afterSnapshot, "Bridged Provider Match");
  const global = getSnapshotRow(afterSnapshot, "Global Web Release");
  const future = getSnapshotRow(afterSnapshot, "Future Anime");
  const staleFutureSignalBefore = getSnapshotRow(beforeSnapshot, "Stale Future Signal Clear");
  const staleFutureSignalAfter = getSnapshotRow(afterSnapshot, "Stale Future Signal Clear");
  const completed = getSnapshotRow(afterSnapshot, "Completed Old Show Returns");
  const missingProvider = getSnapshotRow(afterSnapshot, "Missing Provider Link");
  const titleFallback = getSnapshotRow(afterSnapshot, "Title Fallback Only");
  const conflict = getSnapshotRow(afterSnapshot, "Conflicting Provider Audit");
  const futureSeasonTotal = getSnapshotRow(afterSnapshot, "Future Season Total Trap");
  const sparseOldTotal = getSnapshotRow(afterSnapshot, "Sparse Old Total Trap");
  const postWatchCountDrift = getSnapshotRow(afterSnapshot, "Post Watch Count Drift");
  const staleProjectionBefore = getSnapshotRow(beforeSnapshot, "Stale Projection Repair");
  const staleProjectionAfter = getSnapshotRow(afterSnapshot, "Stale Projection Repair");

  assertValidation(beforeSnapshot.count === 10 && afterSnapshot.count === 10, "Synthetic dev snapshot count changed.", {
    before: beforeSnapshot.count,
    after: afterSnapshot.count,
  });
  assertValidation(importResult.imported >= 9, "Dev Convex import did not include synthetic rows.", importResult);
  assertValidation(
    reconcileSummary.scannedItems === importResult.imported &&
      reconcileSummary.changedFacts > 0 &&
      reconcileSummary.deltas > 0,
    "Dev reconciliation did not scan imported rows and emit compact deltas.",
    { importResult, reconcileSummary }
  );
  assertValidation(
    exportedDeltas.length === reconcileSummary.deltas &&
      exportedDeltas.every((delta) => !("simulatedProjection" in delta)),
    "Exported dev deltas are missing or include local-only simulated projection data.",
    { exportedDeltas: exportedDeltas.length, reconcileSummary }
  );

  assertValidation(
    direct?.releasedEpisodes === 5 &&
      direct.totalEpisodes === 5 &&
      firstProjection(direct)?.remainingEpisodes === 1 &&
      typeof firstUserShow(direct)?.newEpisodeSignalAt === "number",
    "Direct provider-ID dev case did not become available-now with one unwatched episode."
  );
  assertValidation(
    bridged?.providerIds?.tvmazeId === 992002 &&
      bridged.totalEpisodes === 3 &&
      hasScheduleEntry(bridged, "2026-05-15", "tv", 3),
    "Bridged provider-ID dev case did not bridge by IMDb and write the upcoming schedule row."
  );
  assertValidation(
    global?.releasedEpisodes === 8 &&
      firstProjection(global)?.remainingEpisodes === 1 &&
      typeof firstUserShow(global)?.newEpisodeSignalAt === "number",
    "Global non-US dev case did not surface as available-now."
  );
  assertValidation(
    future?.releasedEpisodes === 10 &&
      firstProjection(future)?.remainingEpisodes === 0 &&
      firstUserShow(future)?.newEpisodeSignalAt === null &&
      hasScheduleEntry(future, "2026-05-20", "anime", 11) &&
      !hasScheduleEntry(future, "2026-05-15", "anime", 11),
    "Future episode dev case did not move the schedule row without available-now attention."
  );
  assertValidation(
    firstProjection(staleFutureSignalBefore)?.remainingEpisodes === 0 &&
      typeof firstUserShow(staleFutureSignalBefore)?.newEpisodeSignalAt === "number" &&
      staleFutureSignalAfter?.releasedEpisodes === 1201 &&
      firstProjection(staleFutureSignalAfter)?.remainingEpisodes === 0 &&
      firstUserShow(staleFutureSignalAfter)?.newEpisodeSignalAt === null &&
      firstProjection(staleFutureSignalAfter)?.newEpisodeSignalAt === null &&
      hasScheduleEntry(staleFutureSignalAfter, "2026-05-30", "tv", 1202) &&
      applyTotals.clearedStaleEpisodeSignals >= 1,
    "Stale future signal dev case did not clear old Home attention while preserving the future schedule row."
  );
  assertValidation(
    firstUserShow(completed)?.status === "watching" &&
      firstUserShow(completed)?.completedAt === null &&
      firstProjection(completed)?.remainingEpisodes === 1 &&
      applyTotals.resumedCompletedShows >= 1,
    "Completed old show did not resurface through the compact delta apply."
  );
  assertValidation(
    missingProvider?.providerIds?.tmdbId === null &&
      audit.issues.some(
        (issue) =>
          issue.title === `${syntheticPrefix} Missing Provider Link` &&
          issue.issueType === "missing_provider_link"
      ),
    "Missing provider link was not preserved as an audit issue."
  );
  assertValidation(
    titleFallback?.releasedEpisodes === 2 &&
      applyTotals.skippedTitleFallback >= 1 &&
      audit.issues.some(
        (issue) =>
          issue.title === `${syntheticPrefix} Title Fallback Only` &&
          issue.issueType === "title_fallback_match"
      ),
    "Title-only fallback was not low-confidence/audited/skipped by Convex apply."
  );
  assertValidation(
    conflict?.releasedEpisodes === 4 &&
      audit.issues.some(
        (issue) =>
          issue.title === `${syntheticPrefix} Conflicting Provider Audit` &&
          issue.issueType === "conflicting_provider_ids"
      ),
    "Conflicting provider dev case did not emit an audit issue."
  );
  assertValidation(
    futureSeasonTotal?.releasedEpisodes === 18 &&
      futureSeasonTotal.totalEpisodes === 26 &&
      firstProjection(futureSeasonTotal)?.remainingEpisodes === 0 &&
      hasScheduleEntry(futureSeasonTotal, "2026-06-01", "tv", 1),
    "Future season total was incorrectly treated as released watchlist work."
  );
  assertValidation(
    sparseOldTotal?.releasedEpisodes === 220 &&
      sparseOldTotal.totalEpisodes === 378 &&
      firstProjection(sparseOldTotal)?.remainingEpisodes === 0,
    "Sparse old provider history incorrectly trusted a mismatched total episode count."
  );
  assertValidation(
    postWatchCountDrift?.releasedEpisodes === 2 &&
      postWatchCountDrift.totalEpisodes === 3 &&
      firstProjection(postWatchCountDrift)?.remainingEpisodes === 0,
    "Post-watch provider count drift incorrectly kept the watchlist row active."
  );
  assertValidation(
    firstProjection(staleProjectionBefore)?.remainingEpisodes === 0 &&
      firstProjection(staleProjectionAfter)?.remainingEpisodes === 1 &&
      typeof firstProjection(staleProjectionAfter)?.newEpisodeSignalAt === "number",
    "Stale Convex projection was not repaired by the delta workflow."
  );

  return {
    checks: 17,
    imported: importResult.imported,
    reconciled: reconcileSummary.scannedItems,
    deltas: reconcileSummary.deltas,
    auditIssues: audit.issueCount,
    applyTotals,
  };
}

async function runDevWorkflow(db, options) {
  const deltaPath = options.deltaPath ?? defaultDevDeltaPath;
  const auditPath = options.auditPath ?? defaultDevAuditPath;
  const beforePath = options.beforePath ?? defaultDevBeforePath;
  const afterPath = options.afterPath ?? defaultDevAfterPath;
  const reportPath = options.reportPath ?? defaultDevWorkflowReportPath;

  const seededDev = await seedDevCases(options);
  const beforeSnapshot = await snapshotDevCases(options);
  writeJson(beforePath, beforeSnapshot);

  resetReconciliationTables(db);
  const importResult = await importConvex(db, options);
  const seededProviderEvents = seedSyntheticProviderEvents(db);
  const reconcileSummary = await reconcile(db, {
    fetchProviders: options.fetchProviders ?? true,
    mode: options.fetchProviders === false ? "dev-local" : "dev-providers",
  });
  const exported = exportDeltas(db, deltaPath);
  const audited = auditReport(db, auditPath);
  const applyResult = await applyConvex(deltaPath, { ...options, db });
  const afterSnapshot = await snapshotDevCases(options);
  writeJson(afterPath, afterSnapshot);

  const validated = validateDevWorkflowResults({
    beforeSnapshot,
    afterSnapshot,
    auditPath,
    deltaPath,
    importResult,
    reconcileSummary,
    applyResult,
  });

  const report = {
    generatedAt: Date.now(),
    paths: {
      deltaPath,
      auditPath,
      beforePath,
      afterPath,
      reportPath,
    },
    seededDev,
    importResult,
    seededProviderEvents,
    reconcileSummary,
    exported,
    audited,
    applyResult: {
      batches: applyResult.batches,
      totals: validated.applyTotals,
    },
    validated,
  };
  writeJson(reportPath, report);
  return report;
}

function assertValidation(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function validateFixtureResults(db, summary, deltaPath = defaultDeltaPath) {
  const facts = new Map(
    db
      .prepare("SELECT * FROM release_facts")
      .all()
      .map((row) => [row.show_id, row])
  );
  const issues = db.prepare("SELECT * FROM audit_issues").all();
  const deltas = db
    .prepare("SELECT payload_json FROM convex_deltas")
    .all()
    .map((row) => JSON.parse(row.payload_json));
  const byShowId = new Map(deltas.map((delta) => [delta.simulatedProjection.showId, delta]));
  const exportedDeltas = readJson(deltaPath).deltas;

  assertValidation(
    facts.get("show-direct")?.match_confidence === "direct_id",
    "Direct provider-ID match did not reconcile as direct_id."
  );
  assertValidation(
    facts.get("show-bridged")?.match_confidence === "bridged_id",
    "Bridged provider-ID match did not reconcile as bridged_id."
  );
  assertValidation(
    facts.get("show-global")?.release_state === "available_now",
    "Global non-US release did not become available_now."
  );
  assertValidation(
    facts.get("show-future")?.release_state === "upcoming" &&
      Boolean(facts.get("show-future")?.next_scheduled_json),
    "Future scheduled anime was not represented as upcoming with a next episode."
  );
  assertValidation(
    byShowId.get("show-completed")?.simulatedProjection.status === "watching" &&
      byShowId.get("show-completed")?.simulatedProjection.hasHomeAttention === true,
    "Completed show with new released content did not re-enter Home attention."
  );
  assertValidation(
    issues.some((issue) => issue.show_id === "show-missing-provider" && issue.issue_type === "missing_provider_link"),
    "Missing provider link was not emitted as an audit issue."
  );
  assertValidation(
    !issues.some((issue) =>
      ["show-static-completed-missing-provider", "show-static-planned-finished-anime"].includes(issue.show_id)
    ) && summary.skippedStaticMissingProviders >= 2,
    "Static fully released library rows should not be missing-provider errors.",
    { issues, summary }
  );
  assertValidation(
    issues.some((issue) => issue.show_id === "show-title-fallback" && issue.issue_type === "title_fallback_match") &&
      facts.get("show-title-fallback")?.match_confidence === "title_fallback",
    "Title fallback was not marked low-confidence and auditable."
  );
  assertValidation(
    byShowId.get("show-future")?.simulatedProjection.hasUpcomingSchedule === true &&
      byShowId.get("show-future")?.simulatedProjection.hasHomeAttention === false,
    "Future scheduled episode was not distinguished from available-now attention."
  );
  assertValidation(
    byShowId.get("show-stale-signal-break")?.clearStaleEpisodeSignal === true &&
      byShowId.get("show-stale-signal-break")?.simulatedProjection.remainingEpisodes === 0 &&
      byShowId.get("show-stale-signal-break")?.simulatedProjection.hasUpcomingSchedule === true,
    "Stale episode signal break case did not emit a targeted stale-signal clearing delta."
  );
  assertValidation(
    summary.changedFacts >= 7 && summary.deltas >= 7,
    "Reconciliation did not produce the expected compact facts/deltas.",
    summary
  );
  assertValidation(
    exportedDeltas.every((delta) => !("simulatedProjection" in delta) && !("showId" in delta)),
    "Exported Convex deltas contain local-only metadata."
  );

  return {
    checks: 11,
    facts: facts.size,
    issues: issues.length,
    deltas: deltas.length,
  };
}

function printHelp() {
  console.log(`
Schedule confidence reconciler

Commands:
  init                         Create the local SQLite schema.
  reset-local                  Clear local SQLite reconciliation tables.
  import-convex                Import compact tracked library rows from Convex.
  seed-fixtures                Seed deterministic provider/library fixtures.
  seed-synthetic-events        Seed provider events for token-protected dev synthetic rows after import.
  reconcile                    Reconcile library rows against SQLite provider events.
  audit                        Write an audit report JSON.
  dashboard                    Start local internal audit dashboard.
  apply-convex                 Apply exported compact deltas to Convex.
  seed-dev-cases               Seed token-protected synthetic rows into dev Convex.
  snapshot-dev-cases           Print token-protected synthetic dev row state.
  cleanup-dev-cases            Delete token-protected synthetic dev rows.
  validate-fixtures            Reset a validation DB, seed, reconcile, audit, and assert behavior.
  validate-dev-workflow        Run the dev Convex -> SQLite -> Convex workflow and assert synthetic edge cases.

Common flags:
  --db <path>                  SQLite path. Default: ${defaultDbPath}
  --deltas <path>              Delta JSON path. Default: ${defaultDeltaPath}
  --audit <path>               Audit JSON path. Default: ${defaultAuditPath}
  --host <host>                 Dashboard host. Default: 127.0.0.1
  --port <port>                 Dashboard port. Default: 8787
  --fetch-providers            During reconcile, call real provider APIs for imported library rows.
  --no-fetch-providers         For validate-dev-workflow only, skip real provider API hydration.
  --now-ms <epoch-ms>           Override reconcile clock for deterministic verification.
`);
}

async function main() {
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const dbPath = path.resolve(String(getFlag(flags, "db", defaultDbPath)));
  const deltaPath = path.resolve(String(getFlag(flags, "deltas", defaultDeltaPath)));
  const auditPath = path.resolve(String(getFlag(flags, "audit", defaultAuditPath)));
  ensureDir(defaultWorkDir, true);

  if (command === "validate-fixtures") {
    const validationDbPath = path.resolve(
      String(getFlag(flags, "db", path.join(defaultWorkDir, "validation.sqlite")))
    );
    if (existsSync(validationDbPath)) {
      const db = openDb(validationDbPath);
      initDb(db);
      db.exec(`
        DELETE FROM library_items;
        DELETE FROM provider_events;
        DELETE FROM release_facts;
        DELETE FROM convex_deltas;
        DELETE FROM audit_issues;
        DELETE FROM runs;
      `);
      db.close();
    }
    const db = openDb(validationDbPath);
    const seeded = seedFixtures(db);
    const summary = await reconcile(db, {
      nowMs: fixtureNowMs,
      runId: "fixture-validation",
      mode: "fixtures",
    });
    const exported = exportDeltas(db, deltaPath);
    const audited = auditReport(db, auditPath);
    const validated = validateFixtureResults(db, summary, deltaPath);
    db.close();
    console.log(JSON.stringify({ seeded, summary, exported, audited, validated }, null, 2));
    return;
  }

  const db = openDb(dbPath);
  initDb(db);
  try {
    if (command === "validate-dev-workflow") {
      console.log(JSON.stringify(await runDevWorkflow(db, {
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
        pageSize: Number(getFlag(flags, "page-size", 100)),
        batchSize: Number(getFlag(flags, "batch-size", 25)),
        deltaPath,
        auditPath,
        beforePath: path.resolve(String(getFlag(flags, "before", defaultDevBeforePath))),
        afterPath: path.resolve(String(getFlag(flags, "after", defaultDevAfterPath))),
        reportPath: path.resolve(String(getFlag(flags, "report", defaultDevWorkflowReportPath))),
        fetchProviders: !flags.has("no-fetch-providers"),
      }), null, 2));
      return;
    }
    if (command === "init") {
      console.log(JSON.stringify({ dbPath, initialized: true }, null, 2));
      return;
    }
    if (command === "reset-local") {
      db.exec(`
        DELETE FROM library_items;
        DELETE FROM provider_events;
        DELETE FROM release_facts;
        DELETE FROM convex_deltas;
        DELETE FROM audit_issues;
        DELETE FROM runs;
      `);
      console.log(JSON.stringify({ dbPath, reset: true }, null, 2));
      return;
    }
    if (command === "seed-fixtures") {
      console.log(JSON.stringify(seedFixtures(db), null, 2));
      return;
    }
    if (command === "seed-synthetic-events") {
      console.log(JSON.stringify(seedSyntheticProviderEvents(db), null, 2));
      return;
    }
    if (command === "import-convex") {
      console.log(JSON.stringify(await importConvex(db, {
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
        pageSize: Number(getFlag(flags, "page-size", 100)),
      }), null, 2));
      return;
    }
    if (command === "reconcile") {
      const summary = await reconcile(db, {
        fetchProviders: flags.has("fetch-providers"),
        mode: flags.has("fetch-providers") ? "providers" : "local",
        nowMs: flags.has("now-ms") ? Number(getFlag(flags, "now-ms", Date.now())) : undefined,
      });
      const exported = exportDeltas(db, deltaPath);
      console.log(JSON.stringify({ summary, exported }, null, 2));
      return;
    }
    if (command === "audit") {
      console.log(JSON.stringify(auditReport(db, auditPath), null, 2));
      return;
    }
    if (command === "dashboard") {
      await startDashboard(dbPath, {
        host: getFlag(flags, "host", "127.0.0.1"),
        port: Number(getFlag(flags, "port", 8787)),
      });
      return;
    }
    if (command === "apply-convex") {
      console.log(JSON.stringify(await applyConvex(deltaPath, {
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
        batchSize: Number(getFlag(flags, "batch-size", 25)),
        runId: getFlag(flags, "run-id", undefined),
        db,
      }), null, 2));
      return;
    }
    if (command === "seed-dev-cases") {
      console.log(JSON.stringify(await seedDevCases({
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
        reset: !flags.has("no-reset"),
      }), null, 2));
      return;
    }
    if (command === "snapshot-dev-cases") {
      console.log(JSON.stringify(await snapshotDevCases({
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
      }), null, 2));
      return;
    }
    if (command === "cleanup-dev-cases") {
      console.log(JSON.stringify(await cleanupDevCases({
        convexUrl: getFlag(flags, "convex-url", undefined),
        importToken: getFlag(flags, "token", undefined),
      }), null, 2));
      return;
    }
    printHelp();
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error?.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exitCode = 1;
});
