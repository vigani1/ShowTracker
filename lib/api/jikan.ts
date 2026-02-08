import { getCached, setCached } from "@/lib/api/cache";

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

export type JikanSearchResult = {
  data: JikanAnime[];
  pagination?: { last_visible_page: number; current_page: number; items: { total: number } };
};

async function request<T>(path: string, params?: Record<string, string>) {
  const url = new URL(path, jikanBaseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Jikan request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function searchJikan(query: string, page = 1) {
  const cacheKey = `jikan-search:${query}:${page}`;
  const cached = getCached<JikanSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<JikanSearchResult>("/anime", {
    q: query,
    page: String(page),
  });
  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getJikanAnime(id: number) {
  const response = await request<{ data: JikanAnime }>(`/anime/${id}`);
  return response.data;
}
