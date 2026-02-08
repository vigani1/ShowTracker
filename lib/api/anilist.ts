import { getCached, setCached } from "@/lib/api/cache";

const anilistUrl =
  process.env.EXPO_PUBLIC_ANILIST_URL ?? "https://graphql.anilist.co";

const cacheTtlMs = 15 * 60 * 1000;

export type AniListMedia = {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  description?: string | null;
  coverImage?: { large?: string; extraLarge?: string };
  bannerImage?: string | null;
  genres?: string[];
  status?: string;
  episodes?: number;
  duration?: number;
  averageScore?: number;
  startDate?: { year?: number; month?: number; day?: number };
};

export type AniListSearchResult = {
  data: {
    Page: {
      pageInfo: { total: number; currentPage: number; lastPage: number };
      media: AniListMedia[];
    };
  };
};

export type AniListScheduleResult = {
  data: {
    Page: {
      airingSchedules: AniListAiringSchedule[];
    };
  };
};

export type AniListAiringSchedule = {
  id: number;
  airingAt: number;
  episode: number;
  media: AniListMedia;
};

async function request<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(anilistUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`AniList request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function searchAniList(query: string, page = 1, perPage = 20) {
  const cacheKey = `anilist-search:${query}:${page}:${perPage}`;
  const cached = getCached<AniListSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListSearchResult>(
    `query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage }
        media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
          id
          title { romaji english native }
          description
          coverImage { large extraLarge }
          bannerImage
          genres
          status
          episodes
          duration
          averageScore
          startDate { year month day }
        }
      }
    }`,
    { search: query, page, perPage }
  );

  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getTrendingAniList(page = 1, perPage = 20) {
  const cacheKey = `anilist-trending:${page}:${perPage}`;
  const cached = getCached<AniListSearchResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListSearchResult>(
    `query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage }
        media(type: ANIME, sort: TRENDING_DESC) {
          id
          title { romaji english native }
          description
          coverImage { large extraLarge }
          bannerImage
          genres
          status
          episodes
          duration
          averageScore
          startDate { year month day }
        }
      }
    }`,
    { page, perPage }
  );

  setCached(cacheKey, data, cacheTtlMs);
  return data;
}

export async function getAniListAiringSchedule(
  page = 1,
  perPage = 50,
  fromTimestamp?: number,
  toTimestamp?: number
) {
  const cacheKey = `anilist-schedule:${page}:${perPage}:${fromTimestamp}:${toTimestamp}`;
  const cached = getCached<AniListScheduleResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListScheduleResult>(
    `query ($page: Int, $perPage: Int, $airingAt_greater: Int, $airingAt_lesser: Int) {
      Page(page: $page, perPage: $perPage) {
        airingSchedules(
          notYetAired: true
          airingAt_greater: $airingAt_greater
          airingAt_lesser: $airingAt_lesser
        ) {
          id
          airingAt
          episode
          media {
            id
            title { romaji english native }
            description
            coverImage { large extraLarge }
            bannerImage
            genres
            status
            episodes
            duration
            averageScore
            startDate { year month day }
          }
        }
      }
    }`,
    {
      page,
      perPage,
      airingAt_greater: fromTimestamp,
      airingAt_lesser: toTimestamp,
    }
  );

  setCached(cacheKey, data, cacheTtlMs);
  return data;
}
