import process from "node:process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const TMDB_BASE_URL = (process.env.EXPO_PUBLIC_TMDB_BASE_URL || "https://api.themoviedb.org/3").replace(/\/+$/, "");
const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY?.trim();
const TMDB_BEARER = process.env.EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN?.trim();
const ANILIST_URL = process.env.EXPO_PUBLIC_ANILIST_URL || "https://graphql.anilist.co";
const TVMAZE_BASE_URL = process.env.EXPO_PUBLIC_TVMAZE_BASE_URL || "https://api.tvmaze.com";

const SAMPLE_PAGES = 2;
const TMDB_MOVIE_THRESHOLD = 98;
const TMDB_TV_THRESHOLD = 95;
const ANIME_THRESHOLD = 95;
const STRICT_MODE = process.env.AUDIT_STRICT === "true";

function pct(part, whole) {
  if (!whole) {
    return 0;
  }
  return Math.round((part / whole) * 10000) / 100;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}) ${url}\n${body.slice(0, 220)}`);
  }
  return response.json();
}

function buildTmdbHeaders() {
  if (!TMDB_BEARER) {
    return {};
  }
  return {
    Authorization: `Bearer ${TMDB_BEARER}`,
  };
}

function buildTmdbUrl(path, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}/${path.replace(/^\/+/, "")}`);
  if (TMDB_API_KEY) {
    url.searchParams.set("api_key", TMDB_API_KEY);
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function hasTmdbCredentials() {
  return Boolean(TMDB_API_KEY || TMDB_BEARER);
}

function pickPositiveRuntime(value) {
  return typeof value === "number" && value > 0 ? value : undefined;
}

async function resolveTvRuntimeFallback(details) {
  const imdbId = typeof details.imdb_id === "string" ? details.imdb_id.trim() : "";
  if (imdbId) {
    try {
      const lookupUrl = new URL(`${TVMAZE_BASE_URL.replace(/\/+$/, "")}/lookup/shows`);
      lookupUrl.searchParams.set("imdb", imdbId);
      const show = await fetchJson(lookupUrl.toString());
      const runtime = pickPositiveRuntime(show?.runtime);
      if (runtime) {
        return runtime;
      }
    } catch {
      // Continue with title-based fallback.
    }
  }

  const title = typeof details.name === "string" ? details.name.trim() : "";
  if (!title) {
    return undefined;
  }

  try {
    const searchUrl = new URL(`${TVMAZE_BASE_URL.replace(/\/+$/, "")}/search/shows`);
    searchUrl.searchParams.set("q", title);
    const results = await fetchJson(searchUrl.toString());
    for (const result of results || []) {
      const runtime = pickPositiveRuntime(result?.show?.runtime);
      if (runtime) {
        return runtime;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function getTmdbTrendingIds(mediaType) {
  const ids = [];
  for (let page = 1; page <= SAMPLE_PAGES; page += 1) {
    const data = await fetchJson(
      buildTmdbUrl(`trending/${mediaType}/week`, { page }),
      { headers: buildTmdbHeaders() }
    );
    for (const item of data.results || []) {
      if (typeof item?.id === "number") {
        ids.push(item.id);
      }
    }
  }
  return Array.from(new Set(ids));
}

async function auditTmdbMovies() {
  const ids = await getTmdbTrendingIds("movie");
  let runtimeCount = 0;
  let firstAiredCount = 0;

  for (const id of ids) {
    const details = await fetchJson(buildTmdbUrl(`movie/${id}`), {
      headers: buildTmdbHeaders(),
    });
    if (typeof details.runtime === "number" && details.runtime > 0) {
      runtimeCount += 1;
    }
    if (typeof details.release_date === "string" && details.release_date.trim()) {
      firstAiredCount += 1;
    }
  }

  const coverage = {
    sampleSize: ids.length,
    runtimeCoverage: pct(runtimeCount, ids.length),
    firstAiredCoverage: pct(firstAiredCount, ids.length),
  };

  return coverage;
}

async function auditTmdbTv() {
  const ids = await getTmdbTrendingIds("tv");
  let runtimeCount = 0;
  let firstAiredCount = 0;

  for (const id of ids) {
    const details = await fetchJson(buildTmdbUrl(`tv/${id}`), {
      headers: buildTmdbHeaders(),
    });
    let runtime = Array.isArray(details.episode_run_time)
      ? details.episode_run_time.find((value) => typeof value === "number" && value > 0)
      : undefined;

    if (typeof runtime !== "number") {
      runtime = await resolveTvRuntimeFallback(details);
    }

    if (typeof runtime === "number") {
      runtimeCount += 1;
    }
    if (typeof details.first_air_date === "string" && details.first_air_date.trim()) {
      firstAiredCount += 1;
    }
  }

  return {
    sampleSize: ids.length,
    runtimeCoverage: pct(runtimeCount, ids.length),
    firstAiredCoverage: pct(firstAiredCount, ids.length),
  };
}

async function auditAniListAnime() {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: TRENDING_DESC) {
          id
          idMal
          status
          episodes
          duration
          startDate { year month day }
        }
      }
    }
  `;

  const data = await fetchJson(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { page: 1, perPage: 50 },
    }),
  });

  const media = data?.data?.Page?.media || [];
  let firstAiredCount = 0;
  let runtimeCount = 0;
  let episodesCount = 0;
  let episodeEligibleCount = 0;
  let idCount = 0;

  for (const entry of media) {
    if (typeof entry?.id === "number") {
      idCount += 1;
    }
    const status = typeof entry?.status === "string" ? entry.status : "UNKNOWN";
    const isEpisodeEligible = !["RELEASING", "NOT_YET_RELEASED", "HIATUS"].includes(status);
    if (isEpisodeEligible) {
      episodeEligibleCount += 1;
      if (typeof entry?.episodes === "number" && entry.episodes > 0) {
        episodesCount += 1;
      }
    }
    if (typeof entry?.duration === "number" && entry.duration > 0) {
      runtimeCount += 1;
    }
    if (typeof entry?.startDate?.year === "number") {
      firstAiredCount += 1;
    }
  }

  return {
    sampleSize: media.length,
    idCoverage: pct(idCount, media.length),
    firstAiredCoverage: pct(firstAiredCount, media.length),
    runtimeCoverage: pct(runtimeCount, media.length),
    episodeCountCoverage: pct(episodesCount, Math.max(episodeEligibleCount, 1)),
    episodeEligibleCount,
  };
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  for (const row of rows) {
    console.log(`${row.label}: ${row.value}`);
  }
}

async function main() {
  let failed = false;

  const reportThreshold = (isPassing, message) => {
    if (isPassing) {
      return;
    }
    if (STRICT_MODE) {
      failed = true;
      console.error(message);
      return;
    }
    console.warn(`[warn] ${message}`);
  };

  if (hasTmdbCredentials()) {
    const [movieCoverage, tvCoverage] = await Promise.all([
      auditTmdbMovies(),
      auditTmdbTv(),
    ]);

    printSection("TMDB Movies", [
      { label: "Sample size", value: movieCoverage.sampleSize },
      { label: "Runtime coverage", value: `${movieCoverage.runtimeCoverage}%` },
      { label: "Release date coverage", value: `${movieCoverage.firstAiredCoverage}%` },
    ]);

    printSection("TMDB TV", [
      { label: "Sample size", value: tvCoverage.sampleSize },
      { label: "Runtime coverage", value: `${tvCoverage.runtimeCoverage}%` },
      { label: "First air date coverage", value: `${tvCoverage.firstAiredCoverage}%` },
    ]);

    reportThreshold(
      movieCoverage.runtimeCoverage >= TMDB_MOVIE_THRESHOLD,
      `Movie runtime coverage below threshold (${movieCoverage.runtimeCoverage}% < ${TMDB_MOVIE_THRESHOLD}%)`
    );

    reportThreshold(
      tvCoverage.runtimeCoverage >= TMDB_TV_THRESHOLD,
      `TV runtime coverage below threshold (${tvCoverage.runtimeCoverage}% < ${TMDB_TV_THRESHOLD}%)`
    );
  } else {
    console.warn("TMDB credentials not configured. Skipping TMDB audit.");
  }

  const animeCoverage = await auditAniListAnime();
  printSection("AniList Anime", [
    { label: "Sample size", value: animeCoverage.sampleSize },
    { label: "ID coverage", value: `${animeCoverage.idCoverage}%` },
    { label: "First air date coverage", value: `${animeCoverage.firstAiredCoverage}%` },
    { label: "Runtime coverage", value: `${animeCoverage.runtimeCoverage}%` },
    {
      label: "Episode count coverage",
      value: `${animeCoverage.episodeCountCoverage}% (${animeCoverage.episodeEligibleCount} eligible)`,
    },
  ]);

  const animeComposite = Math.min(
    animeCoverage.idCoverage,
    animeCoverage.firstAiredCoverage,
    animeCoverage.runtimeCoverage,
    animeCoverage.episodeCountCoverage
  );

  reportThreshold(
    animeComposite >= ANIME_THRESHOLD,
    `Anime metadata coverage below threshold (${animeComposite}% < ${ANIME_THRESHOLD}%)`
  );

  if (failed) {
    process.exit(1);
  }

  console.log("\nData quality audit passed.");
}

main().catch((error) => {
  console.error("Data quality audit failed", error);
  process.exit(1);
});
