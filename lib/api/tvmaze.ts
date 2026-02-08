import { getCached, setCached } from "@/lib/api/cache";

const tvmazeBaseUrl =
  process.env.EXPO_PUBLIC_TVMAZE_BASE_URL ?? "https://api.tvmaze.com";

const cacheTtlMs = 15 * 60 * 1000;

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

async function request<T>(path: string, params?: Record<string, string>) {
  const url = new URL(path, tvmazeBaseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`TVMaze request failed: ${response.status}`);
  }
  return (await response.json()) as T;
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
