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
  if (!date?.year || !date?.month || !date?.day) {
    return undefined;
  }
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

export function normalizeTmdbMedia(media: TmdbMedia): NormalizedShow {
  const inferredMediaType =
    media.media_type ??
    (media.release_date ? "movie" : media.first_air_date ? "tv" : "tv");
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
    episodeRuntime: details.episode_run_time?.[0],
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
    rating: anime.score ?? undefined,
    firstAired: anime.aired?.from ?? undefined,
    anilistId: undefined,
  };
}
