import { getCached, setCached } from "@/lib/api/cache";

const tmdbBaseUrl =
  process.env.EXPO_PUBLIC_TMDB_BASE_URL ?? "https://api.themoviedb.org/3";
const tmdbApiKey = process.env.EXPO_PUBLIC_TMDB_API_KEY;

const cacheTtlMs = 15 * 60 * 1000;

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

async function request<T>(path: string, params?: Record<string, string | number>) {
  assertApiKey();
  const url = buildUrl(path, params);
  const maxAttempts = 4;
  const baseDelayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url.toString());
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status !== 429) {
      throw new Error(`TMDB request failed: ${response.status}`);
    }
    if (attempt === maxAttempts) {
      throw new Error(`TMDB request failed: ${response.status}`);
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  throw new Error("TMDB request failed: exceeded retry attempts");
}

export async function searchTmdb(
  query: string,
  mediaType: "multi" | "tv" | "movie" = "multi",
  page = 1
) {
  const cacheKey = `tmdb-search:${mediaType}:${query}:${page}`;
  const cached = getCached<TmdbSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(`/search/${mediaType}`, {
    query,
    page,
    include_adult: "false",
  });
  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getTrendingTmdb(
  mediaType: "all" | "tv" | "movie" = "all",
  timeWindow: "day" | "week" = "week"
) {
  const cacheKey = `tmdb-trending:${mediaType}:${timeWindow}`;
  const cached = getCached<TmdbSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/trending/${mediaType}/${timeWindow}`
  );
  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getTmdbShowDetails(
  mediaType: "tv" | "movie",
  id: number
) {
  return request<TmdbShowDetails>(`/${mediaType}/${id}`);
}

export async function getTmdbSeasonDetails(id: number, seasonNumber: number) {
  return request<TmdbSeasonDetails>(`/tv/${id}/season/${seasonNumber}`);
}
