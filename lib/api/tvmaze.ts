import { getCached, setCached } from "@/lib/api/cache";

const tvmazeBaseUrl =
  process.env.EXPO_PUBLIC_TVMAZE_BASE_URL ?? "https://api.tvmaze.com";

const cacheTtlMs = 15 * 60 * 1000;
const maxAttempts = 4;
const baseDelayMs = 500;

export type TvMazeShow = {
  id: number;
  name: string;
  summary?: string | null;
  image?: { medium?: string; original?: string } | null;
  genres?: string[];
  status?: string;
  premiered?: string | null;
  runtime?: number | null;
  externals?: { imdb?: string | null };
};

export type TvMazeEpisode = {
  id: number;
  name?: string | null;
  season: number;
  number: number;
  summary?: string | null;
  airdate?: string | null;
  runtime?: number | null;
  image?: { medium?: string; original?: string } | null;
};

export type TvMazeScheduleEntry = {
  id: number;
  name: string;
  airdate?: string | null;
  season: number;
  number: number;
  runtime?: number | null;
  show: TvMazeShow;
  image?: { medium?: string; original?: string } | null;
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
  const url = new URL(path, tvmazeBaseUrl);
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
        `TVMaze request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    if (attempt === maxAttempts - 1) {
      const body = await response.text();
      throw new Error(
        `TVMaze request failed: ${response.status}${body ? ` ${body}` : ""}`
      );
    }

    const retryAfterMs = getRetryDelayMs(response.headers.get("Retry-After"));
    const backoffMs = baseDelayMs * 2 ** attempt;
    const jitterMs = Math.random() * 200;
    await sleep((retryAfterMs ?? backoffMs) + jitterMs);
  }

  throw new Error("TVMaze request failed: retry limit exceeded");
}

export async function getTvMazeScheduleByDate(
  date: string,
  country = "US"
) {
  const cacheKey = `tvmaze-schedule:${date}:${country}`;
  const cached = getCached<TvMazeScheduleEntry[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const data = await request<TvMazeScheduleEntry[]>("/schedule", {
    date,
    country,
  });
  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getTvMazeShow(id: number) {
  return request<TvMazeShow>(`/shows/${id}`);
}

export async function getTvMazeEpisode(id: number) {
  return request<TvMazeEpisode>(`/episodes/${id}`);
}
