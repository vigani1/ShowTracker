import { getCached, setCached } from "@/lib/api/cache";
import { normalizeAniListMedia } from "@/lib/api/normalize";
import { getJikanAnime } from "@/lib/api/jikan";
import type { NormalizedShow } from "@/lib/api/types";

const anilistUrl =
  process.env.EXPO_PUBLIC_ANILIST_URL ?? "https://graphql.anilist.co";

const anilistScheduleCacheVersion = "v3";
const anilistRelationsCacheVersion = "v1";

const cacheTtlMs = 15 * 60 * 1000;

const anilistMediaSelection = `
  id
  idMal
  type
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
  format
  season
  seasonYear
`;

type AniListMediaType = "ANIME" | "MANGA";

export type AniListRelationEdge = {
  relationType?: string | null;
  node?: AniListMedia | null;
};

export type AniListMedia = {
  id: number;
  idMal?: number | null;
  type?: AniListMediaType;
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
  format?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  relations?: {
    edges?: AniListRelationEdge[] | null;
  } | null;
};

export type AniListSearchResult = {
  data: {
    Page: {
      pageInfo: { total: number; currentPage: number; lastPage: number };
      media: AniListMedia[];
    };
  };
};

export type AniListNormalizedResult = {
  items: NormalizedShow[];
  pageInfo: {
    total: number;
    currentPage: number;
    lastPage: number;
  };
};

export type AniListScheduleResult = {
  data: {
    Page: {
      pageInfo?: {
        currentPage?: number;
        hasNextPage?: boolean;
      };
      airingSchedules: AniListAiringSchedule[];
    };
  };
};

export type AniListMediaByIdResult = {
  data: {
    Media: AniListMedia | null;
  };
};

export type AniListMediaByMalIdResult = {
  data: {
    Media: AniListMedia | null;
  };
};

export type AniListMediaRelationsResult = {
  data: {
    Media: AniListMedia | null;
  };
};

export type AniListAiringSchedule = {
  id: number;
  airingAt: number;
  episode: number;
  media: AniListMedia;
};

export type AniListRelatedShow = {
  relationType: string;
  anilistId: number;
  show: NormalizedShow;
};

export type AniListAnimeRelations = {
  root: NormalizedShow;
  relations: AniListRelatedShow[];
};

function hasRequiredAnimeFields(show: NormalizedShow) {
  return (
    !!show.firstAired &&
    typeof show.totalEpisodes === "number" &&
    typeof show.episodeRuntime === "number"
  );
}

async function patchAniListWithJikanFallback(
  show: NormalizedShow,
  malId?: number
) {
  const resolvedMalId = show.malId ?? malId;
  if (!resolvedMalId || hasRequiredAnimeFields(show)) {
    return show;
  }

  try {
    const jikanShow = await getJikanAnime(resolvedMalId);
    return {
      ...show,
      malId: show.malId ?? jikanShow.malId,
      firstAired: show.firstAired ?? jikanShow.firstAired,
      totalEpisodes: show.totalEpisodes ?? jikanShow.totalEpisodes,
      episodeRuntime: show.episodeRuntime ?? jikanShow.episodeRuntime,
      status: show.status ?? jikanShow.status,
    };
  } catch {
    return show;
  }
}

async function normalizeAniListMediaWithFallback(media: AniListMedia) {
  const normalized = normalizeAniListMedia(media);
  return patchAniListWithJikanFallback(normalized, media.idMal ?? undefined);
}

async function request<T>(query: string, variables: Record<string, unknown>) {
  const maxAttempts = 4;
  const baseDelayMs = 750;

  const parseResponseBody = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  };

  type AniListError = {
    status: number;
    body: unknown;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(anilistUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (response.ok) {
      return (await response.json()) as T;
    }
    if (response.status !== 429) {
      const body = await parseResponseBody(response);
      const error: AniListError = { status: response.status, body };
      throw error;
    }
    if (attempt === maxAttempts) {
      const body = await parseResponseBody(response);
      const error: AniListError = { status: response.status, body };
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

  throw new Error("AniList request failed: exceeded retry attempts");
}

export type AniListFilterParams = {
  genres?: string[];
  seasonYear?: number;
  minScore?: number;
  status?: string;
};

export async function searchAniList(
  query: string,
  page = 1,
  perPage = 20,
  filters?: AniListFilterParams
) {
  const normalizedQuery = query.trim();
  const hasSearch = normalizedQuery.length > 0;
  const filterKey = filters
    ? Object.entries(filters)
        .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
        .join(",")
    : "";
  const cacheKey = `anilist-search:${normalizedQuery}:${page}:${perPage}:${filterKey}`;
  const cached = getCached<AniListNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const conditions: string[] = ["type: ANIME"];
  const variableDefinitions: string[] = ["$page: Int", "$perPage: Int"];
  const variables: Record<string, unknown> = {
    page,
    perPage,
  };

  if (hasSearch) {
    conditions.push(`search: $search`);
    variableDefinitions.unshift("$search: String");
    variables.search = normalizedQuery;
  }
  if (filters?.genres?.length) {
    conditions.push(`genre_in: $genres`);
    variableDefinitions.push("$genres: [String]");
    variables.genres = filters.genres;
  }
  if (filters?.seasonYear) {
    conditions.push(`seasonYear: $seasonYear`);
    variableDefinitions.push("$seasonYear: Int");
    variables.seasonYear = filters.seasonYear;
  }
  if (filters?.minScore) {
    conditions.push(`averageScore_greater: $minScore`);
    variableDefinitions.push("$minScore: Int");
    variables.minScore = filters.minScore;
  }
  if (filters?.status) {
    conditions.push(`status: $status`);
    variableDefinitions.push("$status: MediaStatus");
    variables.status = filters.status;
  }

  const data = await request<AniListSearchResult>(
    `query (${variableDefinitions.join(", ")}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage }
        media(${conditions.join(", ")}, sort: POPULARITY_DESC) {
          ${anilistMediaSelection}
        }
      }
    }`,
    variables
  );

  const normalized: AniListNormalizedResult = {
    items: data.data.Page.media.map((media) => normalizeAniListMedia(media)),
    pageInfo: data.data.Page.pageInfo,
  };

  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getTrendingAniList(
  page = 1,
  perPage = 20,
  filters?: AniListFilterParams
) {
  const filterKey = filters
    ? Object.entries(filters)
        .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
        .join(",")
    : "";
  const cacheKey = `anilist-trending:${page}:${perPage}:${filterKey}`;
  const cached = getCached<AniListNormalizedResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const conditions: string[] = ["type: ANIME"];
  const variableDefinitions: string[] = ["$page: Int", "$perPage: Int"];
  const variables: Record<string, unknown> = {
    page,
    perPage,
  };

  if (filters?.genres?.length) {
    conditions.push(`genre_in: $genres`);
    variableDefinitions.push("$genres: [String]");
    variables.genres = filters.genres;
  }
  if (filters?.seasonYear) {
    conditions.push(`seasonYear: $seasonYear`);
    variableDefinitions.push("$seasonYear: Int");
    variables.seasonYear = filters.seasonYear;
  }
  if (filters?.minScore) {
    conditions.push(`averageScore_greater: $minScore`);
    variableDefinitions.push("$minScore: Int");
    variables.minScore = filters.minScore;
  }
  if (filters?.status) {
    conditions.push(`status: $status`);
    variableDefinitions.push("$status: MediaStatus");
    variables.status = filters.status;
  }

  const data = await request<AniListSearchResult>(
    `query (${variableDefinitions.join(", ")}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage }
        media(${conditions.join(", ")}, sort: TRENDING_DESC) {
          ${anilistMediaSelection}
        }
      }
    }`,
    variables
  );

  const normalized: AniListNormalizedResult = {
    items: data.data.Page.media.map((media) => normalizeAniListMedia(media)),
    pageInfo: data.data.Page.pageInfo,
  };

  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getAniListAiringSchedule(
  page = 1,
  perPage = 50,
  fromTimestamp?: number,
  toTimestamp?: number
) {
  const cacheKey = `anilist-schedule:${anilistScheduleCacheVersion}:${page}:${perPage}:${fromTimestamp}:${toTimestamp}`;
  const cached = getCached<AniListScheduleResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListScheduleResult>(
    `query ($page: Int, $perPage: Int, $airingAt_greater: Int, $airingAt_lesser: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { currentPage hasNextPage }
        airingSchedules(
          airingAt_greater: $airingAt_greater
          airingAt_lesser: $airingAt_lesser
        ) {
          id
          airingAt
          episode
          media {
            ${anilistMediaSelection}
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

export async function getAniListMediaById(
  id: number
): Promise<NormalizedShow | null> {
  const cacheKey = `anilist-media:${id}`;
  const cached = getCached<NormalizedShow>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListMediaByIdResult>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${anilistMediaSelection}
      }
    }`,
    { id }
  );

  const media = data.data.Media;
  if (!media) {
    return null;
  }

  const normalized = await normalizeAniListMediaWithFallback(media);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getAniListMediaByMalId(
  malId: number
): Promise<NormalizedShow | null> {
  const cacheKey = `anilist-media-by-mal:${malId}`;
  const cached = getCached<NormalizedShow>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListMediaByMalIdResult>(
    `query ($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        ${anilistMediaSelection}
      }
    }`,
    { idMal: malId }
  );

  const media = data.data.Media;
  if (!media) {
    return null;
  }

  const normalized = await normalizeAniListMediaWithFallback(media);
  setCached(cacheKey, normalized, cacheTtlMs);
  return normalized;
}

export async function getAniListAnimeRelations(
  anilistId: number
): Promise<AniListAnimeRelations | null> {
  const cacheKey = `anilist-relations:${anilistRelationsCacheVersion}:${anilistId}`;
  const cached = getCached<AniListAnimeRelations>(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await request<AniListMediaRelationsResult>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${anilistMediaSelection}
        relations {
          edges {
            relationType
            node {
              ${anilistMediaSelection}
            }
          }
        }
      }
    }`,
    { id: anilistId }
  );

  const media = data.data.Media;
  if (!media) {
    return null;
  }

  const rootShowBase = await normalizeAniListMediaWithFallback(media);
  const relatedShows: AniListRelatedShow[] = [];
  const seen = new Set<number>();

  for (const edge of media.relations?.edges ?? []) {
    const node = edge?.node;
    const relationType = edge?.relationType ?? "UNKNOWN";
    if (!node || node.type !== "ANIME") {
      continue;
    }

    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);

    const normalizedNode = await normalizeAniListMediaWithFallback(node);
    relatedShows.push({
      relationType,
      anilistId: node.id,
      show: normalizedNode,
    });
  }

  const rootShow: NormalizedShow = {
    ...rootShowBase,
    rootAnilistId: rootShowBase.anilistId ?? media.id,
    relatedAnilistIds: relatedShows.map((entry) => entry.anilistId),
  };

  const result: AniListAnimeRelations = {
    root: rootShow,
    relations: relatedShows,
  };

  setCached(cacheKey, result, cacheTtlMs);
  return result;
}
