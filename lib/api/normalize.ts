import type {
  NormalizedEpisode,
  NormalizedSeason,
  NormalizedShow,
  NormalizedScheduleEntry,
} from "@/lib/api/types";
import type {
  TmdbEpisode,
  TmdbMedia,
  TmdbSeasonDetails,
  TmdbShowDetails,
} from "@/lib/api/tmdb";
import type { AniListAiringSchedule, AniListMedia } from "@/lib/api/anilist";
import type { TvMazeScheduleEntry } from "@/lib/api/tvmaze";
import type { JikanAnime } from "@/lib/api/jikan";

const tmdbImageBase = "https://image.tmdb.org/t/p/w780";
const tmdbPosterBase = "https://image.tmdb.org/t/p/w342";

function formatAniListDate(date?: {
  year?: number;
  month?: number;
  day?: number;
}) {
  if (!date?.year) {
    return undefined;
  }
  const month = String(date.month ?? 1).padStart(2, "0");
  const day = String(date.day ?? 1).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

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

export function parseJikanDurationToMinutes(duration?: string | null) {
  if (!duration) {
    return undefined;
  }

  const normalized = duration.toLowerCase().replace(/\./g, " ");
  if (!normalized.trim() || normalized.includes("unknown")) {
    return undefined;
  }

  const hoursMatch = normalized.match(/(\d+)\s*h(?:r|our)?s?/);
  const minutesMatch = normalized.match(/(\d+)\s*m(?:in|inute)?s?/);

  const hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? Number.parseInt(minutesMatch[1], 10) : 0;

  if (hours > 0 || minutes > 0) {
    return hours * 60 + minutes;
  }

  const plainNumberMatch = normalized.match(/(\d+)/);
  if (plainNumberMatch) {
    const numeric = Number.parseInt(plainNumberMatch[1], 10);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
}

export function normalizeTmdbMedia(media: TmdbMedia): NormalizedShow {
  const inferredMediaType: NormalizedShow["mediaType"] =
    media.media_type === "movie"
      ? "movie"
      : media.media_type === "tv"
        ? "tv"
        : media.release_date
          ? "movie"
          : "tv";
  return {
    id: `tmdb:${media.id}`,
    mediaType: inferredMediaType,
    title: media.title ?? media.name ?? "Untitled",
    overview: media.overview,
    posterUrl: media.poster_path
      ? `${tmdbPosterBase}${media.poster_path}`
      : undefined,
    backdropUrl: media.backdrop_path
      ? `${tmdbImageBase}${media.backdrop_path}`
      : undefined,
    rating: media.vote_average,
    firstAired: media.first_air_date ?? media.release_date,
    tmdbId: media.id,
  };
}

export function normalizeTmdbShowDetails(
  mediaType: "tv" | "movie",
  details: TmdbShowDetails
): NormalizedShow {
  const runtimeMinutes =
    mediaType === "movie"
      ? details.runtime ?? details.episode_run_time?.[0]
      : details.episode_run_time?.[0] ?? details.runtime;
  const normalizedRuntime =
    typeof runtimeMinutes === "number" ? runtimeMinutes : undefined;

  return {
    id: `tmdb:${details.id}`,
    mediaType,
    title: details.title ?? details.name ?? "Untitled",
    overview: details.overview,
    posterUrl: details.poster_path
      ? `${tmdbPosterBase}${details.poster_path}`
      : undefined,
    backdropUrl: details.backdrop_path
      ? `${tmdbImageBase}${details.backdrop_path}`
      : undefined,
    genres: details.genres?.map((genre) => genre.name),
    status: details.status,
    totalEpisodes: details.number_of_episodes,
    totalSeasons: details.number_of_seasons,
    episodeRuntime: normalizedRuntime,
    rating: details.vote_average,
    firstAired: details.first_air_date ?? details.release_date,
    tmdbId: details.id,
    imdbId: details.imdb_id ?? undefined,
  };
}

export function normalizeTmdbSeason(season: TmdbSeasonDetails): NormalizedSeason {
  return {
    seasonNumber: season.season_number,
    name: season.name,
    overview: season.overview,
    posterUrl: season.poster_path
      ? `${tmdbPosterBase}${season.poster_path}`
      : undefined,
    episodeCount: season.episodes?.length,
    episodes: season.episodes?.map(normalizeTmdbEpisode),
  };
}

export function normalizeTmdbEpisode(episode: TmdbEpisode): NormalizedEpisode {
  return {
    id: `tmdb-episode:${episode.id}`,
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    name: episode.name ?? undefined,
    overview: episode.overview ?? undefined,
    stillUrl: episode.still_path
      ? `${tmdbImageBase}${episode.still_path}`
      : undefined,
    airDate: episode.air_date ?? undefined,
    runtime: episode.runtime ?? undefined,
  };
}

export function normalizeAniListMedia(media: AniListMedia): NormalizedShow {
  return {
    id: `anilist:${media.id}`,
    mediaType: "anime",
    title: media.title.english ?? media.title.romaji ?? "Untitled",
    overview: media.description ?? undefined,
    posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large,
    backdropUrl: media.bannerImage ?? undefined,
    genres: media.genres,
    status: media.status,
    totalEpisodes: media.episodes ?? undefined,
    episodeRuntime: media.duration ?? undefined,
    rating: media.averageScore ? media.averageScore / 10 : undefined,
    firstAired: formatAniListDate(media.startDate),
    anilistId: media.id,
    malId: media.idMal ?? undefined,
    anilistFormat: media.format ?? undefined,
    animeSeason: media.season ?? undefined,
    animeSeasonYear: media.seasonYear ?? undefined,
  };
}

export function normalizeAniListScheduleEntry(
  entry: AniListAiringSchedule
): NormalizedScheduleEntry {
  return {
    showId: `anilist:${entry.media.id}`,
    showTitle:
      entry.media.title.english ?? entry.media.title.romaji ?? "Untitled",
    mediaType: "anime",
    episode: {
      id: `anilist-episode:${entry.id}`,
      seasonNumber: 1,
      episodeNumber: entry.episode,
      name: entry.media.title.english ?? entry.media.title.romaji ?? undefined,
      overview: entry.media.description ?? undefined,
      stillUrl: entry.media.coverImage?.large ?? undefined,
      airDate: new Date(entry.airingAt * 1000).toISOString(),
    },
    posterUrl: entry.media.coverImage?.large ?? undefined,
  };
}

export function normalizeTvMazeScheduleEntry(
  entry: TvMazeScheduleEntry
): NormalizedScheduleEntry {
  return {
    showId: `tvmaze:${entry.show.id}`,
    showTitle: entry.show.name,
    mediaType: "tv",
    episode: {
      id: `tvmaze-episode:${entry.id}`,
      seasonNumber: entry.season,
      episodeNumber: entry.number,
      name: entry.name,
      overview: entry.show.summary ?? undefined,
      stillUrl: entry.image?.original ?? entry.image?.medium ?? undefined,
      airDate: entry.airdate ?? undefined,
      runtime: entry.runtime ?? undefined,
    },
    posterUrl: entry.show.image?.original ?? entry.show.image?.medium ?? undefined,
  };
}

export function normalizeJikanAnime(anime: JikanAnime): NormalizedShow {
  return {
    id: `jikan:${anime.mal_id}`,
    mediaType: "anime",
    title: anime.title_english ?? anime.title,
    overview: anime.synopsis ?? undefined,
    posterUrl:
      anime.images?.webp?.large_image_url ??
      anime.images?.jpg?.large_image_url ??
      anime.images?.jpg?.image_url,
    genres: anime.genres?.map((genre) => genre.name),
    status: anime.status ?? undefined,
    totalEpisodes: anime.episodes ?? undefined,
    episodeRuntime: parseJikanDurationToMinutes(anime.duration),
    rating: anime.score ?? undefined,
    firstAired: normalizeDateString(anime.aired?.from),
    anilistId: undefined,
    malId: anime.mal_id,
  };
}
