import { getCached, setCached } from "@/lib/api/cache";
import { normalizeTmdbEpisode, normalizeTmdbMedia } from "@/lib/api/normalize";
import type { NormalizedEpisode, NormalizedShow } from "@/lib/api/types";
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

export type TmdbNormalizedResult = {
  page: number;
  totalPages: number;
  totalResults: number;
  items: NormalizedShow[];
};

function normalizeTmdbSearchResult(data: TmdbSearchResult): TmdbNormalizedResult {
  return {
    page: data.page,
    totalPages: data.total_pages,
    totalResults: data.total_results,
    items: data.results
      .filter((item) => item.media_type !== "person")
      .map((item) => normalizeTmdbMedia(item)),
  };
}

export type TmdbFilterParams = {
  with_genres?: string;
  first_air_date_year?: number;
  primary_release_year?: number;
  vote_average_gte?: number;
  with_status?: string;
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

type TmdbFindResponse = {
  movie_results: TmdbMedia[];
  tv_results: TmdbMedia[];
  person_results: TmdbMedia[];
};

export type TmdbFindNormalizedResult = {
  items: NormalizedShow[];
};

function normalizeTmdbFindResponse(data: TmdbFindResponse): TmdbFindNormalizedResult {
  const items = [
    ...data.movie_results.map((entry) =>
      normalizeTmdbMedia({ ...entry, media_type: "movie" })
    ),
    ...data.tv_results.map((entry) => normalizeTmdbMedia({ ...entry, media_type: "tv" })),
  ];

  const deduped = new Map<string, NormalizedShow>();
  for (const item of items) {
    const key = `${item.mediaType}:${item.tmdbId ?? item.id}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return {
    items: Array.from(deduped.values()),
  };
}

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

type RequestOptions = {
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  params?: Record<string, string | number>,
  options?: RequestOptions
) {
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
    const response = await fetch(url.toString(), {
      headers,
      signal: options?.signal,
    });
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
  page = 1,
  filters?: TmdbFilterParams
) {
  const filterKey = filters
    ? Object.entries(filters)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")
    : "";
  const cacheKey = `tmdb-search:${mediaType}:${query}:${page}:${filterKey}`;
  const cached = getCached<TmdbNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const params: Record<string, string | number> = {
    query,
    page,
    include_adult: "false",
  };

  if (filters) {
    if (mediaType === "tv" && filters.first_air_date_year) {
      params.first_air_date_year = filters.first_air_date_year;
    }
    if (mediaType === "movie" && filters.primary_release_year) {
      params.primary_release_year = filters.primary_release_year;
    }
  }

  const data = await request<TmdbSearchResult>(`/search/${mediaType}`, params);
  const normalized = normalizeTmdbSearchResult(data);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

// Discover endpoint for filtered browsing (better for filters than search)
export async function discoverTmdb(
  mediaType: "tv" | "movie",
  page = 1,
  filters?: TmdbFilterParams
) {
  const filterKey = filters
    ? Object.entries(filters)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")
    : "";
  const cacheKey = `tmdb-discover:${mediaType}:${page}:${filterKey}`;
  const cached = getCached<TmdbNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const params: Record<string, string | number> = {
    page,
    include_adult: "false",
    sort_by: "popularity.desc",
  };

  if (filters) {
    if (filters.with_genres) {
      params.with_genres = filters.with_genres;
    }
    if (filters.first_air_date_year) {
      params.first_air_date_year = filters.first_air_date_year;
    }
    if (filters.primary_release_year) {
      params.primary_release_year = filters.primary_release_year;
    }
    if (filters.vote_average_gte) {
      params["vote_average.gte"] = filters.vote_average_gte;
    }
    if (filters.with_status) {
      params.with_status = filters.with_status;
    }
  }

  const data = await request<TmdbSearchResult>(`/discover/${mediaType}`, params);
  const normalized = normalizeTmdbSearchResult(data);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getTrendingTmdb(
  mediaType: "all" | "tv" | "movie" = "all",
  timeWindow: "day" | "week" = "week",
  page = 1
) {
  const cacheKey = `tmdb-trending:${mediaType}:${timeWindow}:${page}`;
  const cached = getCached<TmdbNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/trending/${mediaType}/${timeWindow}`,
    { page }
  );
  const normalized = normalizeTmdbSearchResult(data);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function findTmdbByImdbId(imdbId: string) {
  const normalized = imdbId.trim();
  if (!normalized) {
    return null;
  }

  const cacheKey = `tmdb-find:imdb:${normalized}`;
  const cached = getCached<TmdbFindNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<TmdbFindResponse>(`/find/${encodeURIComponent(normalized)}`, {
    external_source: "imdb_id",
  });

  const normalizedResult = normalizeTmdbFindResponse(data);
  setCached(cacheKey, normalizedResult, cacheTtlMs);
  return normalizedResult;
}

export async function findTmdbByTvdbId(tvdbId: number | string) {
  const normalized = String(tvdbId).trim();
  if (!normalized || normalized === "-1" || normalized === "0") {
    return null;
  }

  const cacheKey = `tmdb-find:tvdb:${normalized}`;
  const cached = getCached<TmdbFindNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<TmdbFindResponse>(`/find/${encodeURIComponent(normalized)}`, {
    external_source: "tvdb_id",
  });

  const normalizedResult = normalizeTmdbFindResponse(data);
  setCached(cacheKey, normalizedResult, cacheTtlMs);
  return normalizedResult;
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

// Get recommendations based on a movie
export async function getMovieRecommendations(
  movieId: number,
  page = 1,
  options?: RequestOptions
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-movie-recommendations:${movieId}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/movie/${movieId}/recommendations`,
    { page },
    options
  );
  const normalized = data.results
    .filter((item) => item.media_type !== "person")
    .map((item) => normalizeTmdbMedia(item));
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

// Get recommendations based on a TV show
export async function getTvRecommendations(
  tvId: number,
  page = 1,
  options?: RequestOptions
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-tv-recommendations:${tvId}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/tv/${tvId}/recommendations`,
    { page },
    options
  );
  const normalized = data.results
    .filter((item) => item.media_type !== "person")
    .map((item) => normalizeTmdbMedia(item));
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

// Get similar movies
export async function getSimilarMovies(
  movieId: number,
  page = 1,
  options?: RequestOptions
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-similar-movies:${movieId}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/movie/${movieId}/similar`,
    { page },
    options
  );
  const normalized = data.results
    .filter((item) => item.media_type !== "person")
    .map((item) => normalizeTmdbMedia(item));
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

// Get similar TV shows
export async function getSimilarTv(
  tvId: number,
  page = 1,
  options?: RequestOptions
): Promise<NormalizedShow[]> {
  const cacheKey = `tmdb-similar-tv:${tvId}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TmdbSearchResult>(
    `/tv/${tvId}/similar`,
    { page },
    options
  );
  const normalized = data.results
    .filter((item) => item.media_type !== "person")
    .map((item) => normalizeTmdbMedia(item));
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}
