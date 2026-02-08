import { getCached, setCached } from "@/lib/api/cache";
import { normalizeJikanAnime } from "@/lib/api/normalize";
import type { NormalizedShow } from "@/lib/api/types";

const jikanBaseUrl =
  process.env.EXPO_PUBLIC_JIKAN_BASE_URL ?? "https://api.jikan.moe/v4";

const cacheTtlMs = 15 * 60 * 1000;
const maxAttempts = 4;
const baseDelayMs = 500;

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

export type JikanSearchResult = {
  data: JikanAnime[];
  pagination?: { last_visible_page: number; current_page: number; items: { total: number } };
};

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

async function request<T>(path: string, params?: Record<string, string>) {
  const url = new URL(path, jikanBaseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url.toString());

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status !== 429) {
      const body = await response.text();
      throw new Error(
        `Jikan request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    if (attempt === maxAttempts - 1) {
      const body = await response.text();
      throw new Error(
        `Jikan request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    const retryAfterMs = getRetryDelayMs(response.headers.get("Retry-After"));
    const backoffMs = baseDelayMs * 2 ** attempt;
    const jitterMs = Math.random() * 200;
    await sleep((retryAfterMs ?? backoffMs) + jitterMs);
  }

  throw new Error("Jikan request failed: retry limit exceeded");
}

export async function searchJikan(
  query: string,
  page = 1
): Promise<NormalizedShow[]> {
  const cacheKey = `jikan-search:${query}:${page}`;
  const cached = getCached<NormalizedShow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<JikanSearchResult>("/anime", {
    q: query,
    page: String(page),
  });
  const normalized = data.data.map(normalizeJikanAnime);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getJikanAnime(id: number): Promise<NormalizedShow> {
  const response = await request<{ data: JikanAnime }>(`/anime/${id}`);
  return normalizeJikanAnime(response.data);
}
