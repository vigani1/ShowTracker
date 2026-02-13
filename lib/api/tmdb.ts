import { getCached, setCached } from "@/lib/api/cache";
import { normalizeTmdbEpisode } from "@/lib/api/normalize";
import type { NormalizedEpisode } from "@/lib/api/types";
import {
  lookupTvMazeShowByImdb,
  searchTvMazeShows,
} from "@/lib/api/tvmaze";

function normalizeTmdbBaseUrl(input?: string) {
  const fallback = "https://api.themoviedb.org/3";
  if (!input?.trim()) {
    return fallback;
  }

  const trimmed = input.trim().replace(/\/+$/, "");

  try {
    const parsed = new URL(trimmed);
    const isTmdbHost = parsed.hostname === "api.themoviedb.org";
    const hasVersionPath = parsed.pathname === "/3";
    if (isTmdbHost && !hasVersionPath) {
      parsed.pathname = "/3";
      return parsed.toString().replace(/\/+$/, "");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function sanitizeCredential(value?: string) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("your_")) {
    return undefined;
  }
  return trimmed;
}

const tmdbBaseUrl = normalizeTmdbBaseUrl(process.env.EXPO_PUBLIC_TMDB_BASE_URL);
const tmdbApiKey = sanitizeCredential(process.env.EXPO_PUBLIC_TMDB_API_KEY);
const tmdbReadAccessToken = sanitizeCredential(
  process.env.EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN
);

const cacheTtlMs = 15 * 60 * 1000;

export type TmdbSearchResult = {
  page: number;
  results: TmdbMedia[];
  total_pages: number;
  total_results: number;
};

export type TmdbMedia = {
  id: number;
  media_type?: "tv" | "movie" | "person";
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
  runtime?: number | null;
  vote_average?: number;
  first_air_date?: string;
  release_date?: string;
  imdb_id?: string | null;
  seasons?: {
    season_number: number;
    name?: string;
    episode_count?: number;
  }[];
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

function assertTmdbCredentials() {
  if (!tmdbApiKey && !tmdbReadAccessToken) {
    throw new Error(
      "TMDB is not configured. Add EXPO_PUBLIC_TMDB_API_KEY or EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN to your env."
    );
  }
}

function buildUrl(path: string, params: Record<string, string | number> = {}) {
  const normalizedPath = path.replace(/^\/+/, "");
  const base = tmdbBaseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/${normalizedPath}`);
  if (tmdbApiKey) {
    url.searchParams.set("api_key", tmdbApiKey);
  }
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url;
}

async function request<T>(path: string, params?: Record<string, string | number>) {
  assertTmdbCredentials();
  const url = buildUrl(path, params);
  const maxAttempts = 4;
  const baseDelayMs = 500;
  // Prefer API key query auth when available to avoid browser preflight/CORS issues.
  const headers: HeadersInit = !tmdbApiKey && tmdbReadAccessToken
    ? {
        Authorization: `Bearer ${tmdbReadAccessToken}`,
      }
    : {};
  const parseResponseBody = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  };

  type TmdbError = {
    status: number;
    body: unknown;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url.toString(), { headers });
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status !== 429) {
      const body = await parseResponseBody(response);
      const error: TmdbError = { status: response.status, body };
      throw error;
    }
    if (attempt === maxAttempts) {
      const body = await parseResponseBody(response);
      const error: TmdbError = { status: response.status, body };
      throw error;
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  const error: TmdbError = {
    status: 429,
    body: "TMDB request failed: exceeded retry attempts",
  };
  throw error;
}

function pickPositiveRuntime(value?: number | null) {
  return typeof value === "number" && value > 0 ? value : undefined;
}

async function resolveTmdbTvRuntimeFallback(details: TmdbShowDetails) {
  const directRuntime =
    details.episode_run_time?.find((value) => pickPositiveRuntime(value)) ??
    pickPositiveRuntime(details.runtime);
  if (typeof directRuntime === "number") {
    return directRuntime;
  }

  const imdbId = details.imdb_id?.trim();
  if (imdbId) {
    try {
      const tvMazeShow = await lookupTvMazeShowByImdb(imdbId);
      const runtime = pickPositiveRuntime(tvMazeShow.runtime);
      if (typeof runtime === "number") {
        return runtime;
      }
    } catch {
      // Ignore lookup failures and continue with title-based fallback.
    }
  }

  const title = (details.name ?? details.title ?? "").trim();
  if (!title) {
    return undefined;
  }

  // Extract expected premiere year from TMDB data for validation
  const firstAirDate = details.first_air_date;
  const expectedYear = firstAirDate ? Number(firstAirDate.split("-")[0]) : undefined;

  try {
    const results = await searchTvMazeShows(title);
    for (const result of results) {
      const runtime = pickPositiveRuntime(result.show.runtime);
      if (typeof runtime !== "number") {
        continue;
      }

      // Validate match by premiere year when available
      const tvMazePremiered = result.show.premiered;
      const tvMazeYear = tvMazePremiered ? Number(tvMazePremiered.split("-")[0]) : undefined;

      if (expectedYear && tvMazeYear && expectedYear === tvMazeYear) {
        // Validated match by year
        return runtime;
      }

      // If no year match but runtime is valid, check if we have externals for additional validation
      const hasImdbMatch = result.show.externals?.imdb && imdbId && result.show.externals.imdb === imdbId;
      if (hasImdbMatch) {
        return runtime;
      }

      // If we have expected year but no match, continue to next candidate
      if (expectedYear && tvMazeYear && expectedYear !== tvMazeYear) {
        continue;
      }

      // Title-only fallback without verification - log warning for observability
      console.warn(
        `TVMaze runtime fallback: using unverified title-only match for "${title}" (expected year: ${expectedYear ?? "unknown"}, matched show premiered: ${tvMazePremiered ?? "unknown"})`
      );
      return runtime;
    }
  } catch {
    // Ignore fallback search failures.
  }

  return undefined;
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
  timeWindow: "day" | "week" = "week",
  page = 1
) {
  const cacheKey = `tmdb-trending:${mediaType}:${timeWindow}:${page}`;
  const cached = getCached<TmdbSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/trending/${mediaType}/${timeWindow}`,
    { page }
  );
  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getTmdbShowDetails(
  mediaType: "tv" | "movie",
  id: number
) {
  const details = await request<TmdbShowDetails>(`/${mediaType}/${id}`);

  if (mediaType === "tv") {
    const fallbackRuntime = await resolveTmdbTvRuntimeFallback(details);
    if (typeof fallbackRuntime === "number") {
      const existingRuntime =
        details.episode_run_time?.find((value) => pickPositiveRuntime(value)) ??
        pickPositiveRuntime(details.runtime);
      if (typeof existingRuntime !== "number") {
        details.episode_run_time = [fallbackRuntime];
      }
    }
  }

  return details;
}

export async function getTmdbSeasonDetails(id: number, seasonNumber: number) {
  return request<TmdbSeasonDetails>(`/tv/${id}/season/${seasonNumber}`);
}

export async function getTmdbEpisodeDetails(
  id: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<NormalizedEpisode> {
  const response = await request<TmdbEpisode>(
    `/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}`
  );
  return normalizeTmdbEpisode(response);
}
