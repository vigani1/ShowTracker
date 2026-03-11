import { getCached, setCached } from "@/lib/api/cache";
import type { NormalizedEpisode, NormalizedShow } from "@/lib/api/types";
import {
  normalizeJikanAnime,
  parseJikanDurationToMinutes,
} from "@/lib/api/normalize";

function resolveJikanBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_JIKAN_BASE_URL?.trim();
  const base = configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : "https://api.jikan.moe/v4";

  return base.endsWith("/v4") ? base : `${base}/v4`;
}

const jikanBaseUrl = resolveJikanBaseUrl();

const cacheTtlMs = 15 * 60 * 1000;
// Default to a short crawl unless a caller explicitly opts into more pages.
const DEFAULT_CONSERVATIVE_JIKAN_EPISODE_PAGES = 3;

export type JikanAnime = {
  mal_id: number;
  title: string;
  title_english?: string | null;
  synopsis?: string | null;
  images?: {
    jpg?: { image_url?: string; large_image_url?: string };
    webp?: { image_url?: string; large_image_url?: string };
  };
  genres?: { name: string }[];
  status?: string | null;
  episodes?: number | null;
  duration?: string | null;
  score?: number | null;
  aired?: { from?: string | null };
};

export type JikanAnimeEpisode = {
  mal_id: number;
  title?: string | null;
  title_romanji?: string | null;
  aired?: string | null;
  filler?: boolean;
  recap?: boolean;
  duration?: string | null;
};

export type JikanAnimeRelation = {
  relation: string;
  entry: {
    mal_id: number;
    type: string;
    name: string;
    url: string;
  }[];
};

type JikanSearchResponse = {
  data: JikanAnime[];
  pagination?: {
    last_visible_page: number;
    current_page: number;
    items: { total: number };
  };
};

type JikanAnimeEpisodesResponse = {
  data: JikanAnimeEpisode[];
  pagination?: {
    has_next_page?: boolean;
    last_visible_page?: number;
    current_page?: number;
  };
};

type JikanAnimeRelationsResponse = {
  data: JikanAnimeRelation[];
};

function normalizeDateString(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const directDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDate?.[1]) {
    return directDate[1];
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
}

async function request<T>(path: string, params?: Record<string, string>) {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, `${jikanBaseUrl}/`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  const maxAttempts = 4;
  const baseDelayMs = 700;
  const parseResponseBody = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  };

  type JikanError = {
    status: number;
    body: unknown;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url.toString());
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status !== 429) {
      const body = await parseResponseBody(response);
      const error: JikanError = { status: response.status, body };
      throw error;
    }
    if (attempt === maxAttempts) {
      const body = await parseResponseBody(response);
      const error: JikanError = { status: response.status, body };
      throw error;
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  const error: JikanError = {
    status: 429,
    body: "Jikan request failed: exceeded retry attempts",
  };
  throw error;
}

export async function searchJikan(query: string, page = 1) {
  const cacheKey = `jikan-search:${query}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<JikanSearchResponse>("/anime", {
    q: query,
    page: String(page),
  });
  const normalized = data.data.map((anime) => normalizeJikanAnime(anime));
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getJikanAnime(id: number): Promise<NormalizedShow> {
  const cacheKey = `jikan-anime:${id}`;
  const cached = getCached<NormalizedShow>(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await request<{ data: JikanAnime }>(`/anime/${id}`);
  const normalized = normalizeJikanAnime(response.data);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getJikanAnimeEpisodes(
  malId: number,
  maxPages?: number
): Promise<NormalizedEpisode[]> {
  const safeMaxPages = Number.isFinite(maxPages)
    ? Math.max(1, Math.floor(maxPages as number))
    : DEFAULT_CONSERVATIVE_JIKAN_EPISODE_PAGES;
  const cacheKey = `jikan-anime-episodes:${malId}:${safeMaxPages}`;
  const cached = getCached<NormalizedEpisode[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const episodes: NormalizedEpisode[] = [];
  let page = 1;

  while (page <= safeMaxPages) {
    const response = await request<JikanAnimeEpisodesResponse>(
      `/anime/${malId}/episodes`,
      { page: String(page) }
    );

    for (const episode of response.data) {
      const episodeNumber =
        typeof episode.mal_id === "number" && episode.mal_id > 0
          ? episode.mal_id
          : episodes.length + 1;
      episodes.push({
        id: `jikan-episode:${malId}:${episodeNumber}`,
        seasonNumber: 1,
        episodeNumber,
        name: episode.title ?? episode.title_romanji ?? `Episode ${episodeNumber}`,
        airDate: normalizeDateString(episode.aired),
        runtime: parseJikanDurationToMinutes(episode.duration),
      });
    }

    if (!response.pagination?.has_next_page) {
      break;
    }

    page += 1;
  }

  episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

  setCached(cacheKey, episodes, cacheTtlMs);
  return episodes;
}

export async function getJikanAnimeRelations(
  malId: number
): Promise<NormalizedShow[]> {
  const cacheKey = `jikan-anime-relations:${malId}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await request<JikanAnimeRelationsResponse>(
    `/anime/${malId}/relations`
  );

  // Map raw Jikan relation entries to NormalizedShow stubs
  const normalized: NormalizedShow[] = response.data.flatMap((relation) =>
    relation.entry.map((entry) => ({
      id: String(entry.mal_id),
      title: entry.name,
      malId: entry.mal_id,
      mediaType: "anime" as const,
    }))
  );

  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}
