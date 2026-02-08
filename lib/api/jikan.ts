import { getCached, setCached } from "@/lib/api/cache";
import type { NormalizedShow } from "@/lib/api/types";
import { normalizeJikanAnime } from "@/lib/api/normalize";

const jikanBaseUrl =
  process.env.EXPO_PUBLIC_JIKAN_BASE_URL ?? "https://api.jikan.moe/v4";

const cacheTtlMs = 15 * 60 * 1000;

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

type JikanSearchResponse = {
  data: JikanAnime[];
  pagination?: {
    last_visible_page: number;
    current_page: number;
    items: { total: number };
  };
};

async function request<T>(path: string, params?: Record<string, string>) {
  const url = new URL(path, jikanBaseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  const maxAttempts = 4;
  const baseDelayMs = 700;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url.toString());
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status !== 429) {
      throw new Error(`Jikan request failed: ${response.status}`);
    }
    if (attempt === maxAttempts) {
      throw new Error(`Jikan request failed: ${response.status}`);
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  throw new Error("Jikan request failed: exceeded retry attempts");
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
  const response = await request<{ data: JikanAnime }>(`/anime/${id}`);
  return normalizeJikanAnime(response.data);
}
