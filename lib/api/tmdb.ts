import { getCached, setCached } from "@/lib/api/cache";
import type { NormalizedSeason, NormalizedShow } from "@/lib/api/types";
import {
  normalizeTmdbMedia,
  normalizeTmdbSeason,
  normalizeTmdbShowDetails,
} from "@/lib/api/normalize";

const tmdbBaseUrl =
  process.env.EXPO_PUBLIC_TMDB_BASE_URL ?? "https://api.themoviedb.org/3";
const tmdbApiKey = process.env.EXPO_PUBLIC_TMDB_API_KEY;

const cacheTtlMs = 15 * 60 * 1000;
const maxAttempts = 4;
const baseDelayMs = 500;

export type TmdbSearchResult = {
  page: number;
  results: TmdbMedia[];
  total_pages: number;
  total_results: number;
};

export type TmdbMedia = {
  id: number;
  media_type?: "tv" | "movie";
  name?: string;
  title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
};

export type TmdbShowDetails = {
  id: number;
  name?: string;
  title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: { id: number; name: string }[];
  status?: string;
  number_of_episodes?: number;
  number_of_seasons?: number;
  episode_run_time?: number[];
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  imdb_id?: string | null;
};

export type TmdbSeasonDetails = {
  id: number;
  name?: string;
  overview?: string;
  season_number: number;
  poster_path?: string | null;
  episodes?: TmdbEpisode[];
};

export type TmdbEpisode = {
  id: number;
  name?: string;
  overview?: string;
  episode_number: number;
  season_number: number;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
};

function assertApiKey() {
  if (!tmdbApiKey) {
    throw new Error("Missing EXPO_PUBLIC_TMDB_API_KEY");
  }
}

function buildUrl(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(path, tmdbBaseUrl);
  url.searchParams.set("api_key", tmdbApiKey ?? "");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url;
}

function getRetryDelayMs(retryAfter: string | null) {
  if (!retryAfter) {
    return null;
  }
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function request<T>(path: string, params?: Record<string, string | number>) {
  assertApiKey();
  const url = buildUrl(path, params);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url.toString());

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status !== 429) {
      const body = await response.text();
      throw new Error(
        `TMDB request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    if (attempt === maxAttempts - 1) {
      const body = await response.text();
      throw new Error(
        `TMDB request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    const retryAfterMs = getRetryDelayMs(response.headers.get("Retry-After"));
    const backoffMs = baseDelayMs * 2 ** attempt;
    const jitterMs = Math.random() * 200;
    await sleep((retryAfterMs ?? backoffMs) + jitterMs);
  }

  throw new Error("TMDB request failed: retry limit exceeded");
}

export async function searchTmdb(
  query: string,
  mediaType: "multi" | "tv" | "movie" = "multi",
  page = 1
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-search:${mediaType}:${query}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(`/search/${mediaType}`, {
    query,
    page,
    include_adult: "false",
  });
  const normalized = data.results.map(normalizeTmdbMedia);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getTrendingTmdb(
  mediaType: "all" | "tv" | "movie" = "all",
  timeWindow: "day" | "week" = "week"
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-trending:${mediaType}:${timeWindow}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/trending/${mediaType}/${timeWindow}`
  );
  const normalized = data.results.map(normalizeTmdbMedia);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getTmdbShowDetails(
  mediaType: "tv" | "movie",
  id: number
): Promise<NormalizedShow> {
  const details = await request<TmdbShowDetails>(`/${mediaType}/${id}`);
  return normalizeTmdbShowDetails(mediaType, details);
}

export async function getTmdbSeasonDetails(
  id: number,
  seasonNumber: number
): Promise<NormalizedSeason> {
  const season = await request<TmdbSeasonDetails>(
    `/tv/${id}/season/${seasonNumber}`
  );
  return normalizeTmdbSeason(season);
}
