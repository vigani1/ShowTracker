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
import type {
  TvMazeEpisode,
  TvMazeScheduleEntry,
  TvMazeShow,
} from "@/lib/api/tvmaze";
import type { JikanAnime, JikanAnimeEpisode } from "@/lib/api/jikan";
import {
  normalizeStatus,
  getEpisodeRuntime,
  formatAirDate,
  parseAirDate,
  DEFAULTS,
} from "@/lib/metadata-utils";

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

function stripHtml(value?: string | null) {
  return value
    ?.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getTmdbReleasedTvEpisodeCount(details: TmdbShowDetails) {
  const lastEpisode = details.last_episode_to_air;
  if (
    typeof lastEpisode?.season_number !== "number" ||
    typeof lastEpisode.episode_number !== "number" ||
    lastEpisode.season_number < 1 ||
    lastEpisode.episode_number < 1
  ) {
    return undefined;
  }

  const lastSeasonNumber = lastEpisode.season_number;
  const lastEpisodeNumber = lastEpisode.episode_number;

  const previousSeasonEpisodes =
    details.seasons
      ?.filter(
        (season) =>
          season.season_number > 0 &&
          season.season_number < lastSeasonNumber &&
          typeof season.episode_count === "number" &&
          season.episode_count > 0
      )
      .reduce((sum, season) => sum + (season.episode_count ?? 0), 0) ?? 0;

  return previousSeasonEpisodes + lastEpisodeNumber;
}

function getAniListReleasedEpisodeCount(
  status: string | undefined,
  totalEpisodes: number | undefined,
  nextAiringEpisodeNumber: number | undefined | null
) {
  if (typeof nextAiringEpisodeNumber === "number" && nextAiringEpisodeNumber > 1) {
    return nextAiringEpisodeNumber - 1;
  }

  if (
    (status === "finished" || status === "canceled") &&
    typeof totalEpisodes === "number" &&
    totalEpisodes > 0
  ) {
    return totalEpisodes;
  }

  return undefined;
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
    // TMDB search results don't include status, episode/season counts, or runtime
    // These will be populated from details endpoint
    status: undefined,
    totalEpisodes: undefined,
    totalSeasons: undefined,
    episodeRuntime: undefined,
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
    typeof runtimeMinutes === "number" && runtimeMinutes > 0
      ? runtimeMinutes
      : mediaType === "movie"
        ? DEFAULTS.MOVIE_RUNTIME_MINUTES
        : DEFAULTS.EPISODE_RUNTIME_MINUTES;

  const normalizedStatus = normalizeStatus(details.status);
  
  // Keep planned totals separate from released episode counts for TV.
  const reportedTotalEpisodes =
    details.number_of_episodes && details.number_of_episodes > 0
      ? details.number_of_episodes
      : undefined;
  const releasedTvEpisodeCount =
    mediaType === "tv" ? getTmdbReleasedTvEpisodeCount(details) : undefined;
  const totalEpisodes =
    mediaType === "tv"
      ? reportedTotalEpisodes
      : (reportedTotalEpisodes ?? 1); // Movies count as 1 episode

  const totalSeasons = details.number_of_seasons && details.number_of_seasons > 0
    ? details.number_of_seasons
    : mediaType === "tv" ? 1 : 0;

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
    status: normalizedStatus,
    totalEpisodes,
    releasedEpisodes: mediaType === "tv" ? releasedTvEpisodeCount : totalEpisodes,
    totalSeasons,
    episodeRuntime: normalizedRuntime,
    rating: details.vote_average,
    firstAired: details.first_air_date ?? details.release_date,
    tmdbId: details.id,
    imdbId: details.imdb_id ?? undefined,
  };
}

export function normalizeTmdbSeason(season: TmdbSeasonDetails): NormalizedSeason {
  const episodeCount = season.episodes?.length && season.episodes.length > 0
    ? season.episodes.length
    : undefined;

  return {
    seasonNumber: season.season_number,
    name: season.name?.trim() || `Season ${season.season_number}`,
    overview: season.overview,
    posterUrl: season.poster_path
      ? `${tmdbPosterBase}${season.poster_path}`
      : undefined,
    episodeCount,
    episodes: season.episodes?.map(normalizeTmdbEpisode),
  };
}

export function normalizeTmdbEpisode(episode: TmdbEpisode): NormalizedEpisode {
  const normalizedRuntime = episode.runtime && episode.runtime > 0
    ? episode.runtime
    : undefined;

  return {
    id: `tmdb-episode:${episode.id}`,
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    name: episode.name?.trim() || `Episode ${episode.episode_number}`,
    overview: episode.overview ?? undefined,
    stillUrl: episode.still_path
      ? `${tmdbImageBase}${episode.still_path}`
      : undefined,
    airDate: episode.air_date ?? undefined,
    runtime: normalizedRuntime,
  };
}

export function normalizeTvMazeShow(
  show: TvMazeShow,
  episodes: TvMazeEpisode[] = []
): NormalizedShow {
  const realEpisodes = episodes.filter(
    (episode) =>
      Number.isFinite(episode.season) &&
      episode.season > 0 &&
      Number.isFinite(episode.number) &&
      episode.number > 0
  );
  const nowMs = Date.now();
  const releasedEpisodes = realEpisodes.filter((episode) => {
    const airDate = episode.airstamp ?? episode.airdate;
    if (!airDate) {
      return false;
    }
    const parsed = Date.parse(airDate);
    return Number.isFinite(parsed) && parsed <= nowMs;
  });
  const maxSeason = realEpisodes.reduce(
    (max, episode) => Math.max(max, episode.season),
    0
  );

  return {
    id: `tvmaze:${show.id}`,
    mediaType: "tv",
    title: show.name,
    overview: stripHtml(show.summary),
    posterUrl: show.image?.original ?? show.image?.medium ?? undefined,
    backdropUrl: show.image?.original ?? show.image?.medium ?? undefined,
    genres: show.genres,
    status: normalizeStatus(show.status),
    totalEpisodes: realEpisodes.length || undefined,
    releasedEpisodes: releasedEpisodes.length || undefined,
    totalSeasons: maxSeason || undefined,
    episodeRuntime:
      typeof show.runtime === "number" && show.runtime > 0
        ? show.runtime
        : DEFAULTS.EPISODE_RUNTIME_MINUTES,
    firstAired: normalizeDateString(show.premiered),
    tvdbId: show.externals?.thetvdb ?? undefined,
    tvmazeId: show.id,
    imdbId: show.externals?.imdb ?? undefined,
  };
}

export function normalizeTvMazeEpisode(episode: TvMazeEpisode): NormalizedEpisode {
  return {
    id: `tvmaze-episode:${episode.id}`,
    seasonNumber: episode.season,
    episodeNumber: episode.number,
    name: episode.name?.trim() || `Episode ${episode.number}`,
    overview: stripHtml(episode.summary),
    stillUrl: episode.image?.original ?? episode.image?.medium ?? undefined,
    airDate: episode.airstamp ?? episode.airdate ?? undefined,
    runtime:
      typeof episode.runtime === "number" && episode.runtime > 0
        ? episode.runtime
        : undefined,
  };
}

export function normalizeTvMazeSeasons(
  episodes: TvMazeEpisode[],
  fallbackPosterUrl?: string
): NormalizedSeason[] {
  const bySeason = new Map<number, NormalizedEpisode[]>();

  for (const episode of episodes) {
    if (
      !Number.isFinite(episode.season) ||
      episode.season <= 0 ||
      !Number.isFinite(episode.number) ||
      episode.number <= 0
    ) {
      continue;
    }

    const seasonEpisodes = bySeason.get(episode.season) ?? [];
    seasonEpisodes.push(normalizeTvMazeEpisode(episode));
    bySeason.set(episode.season, seasonEpisodes);
  }

  return Array.from(bySeason.entries())
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, seasonEpisodes]) => ({
      seasonNumber,
      name: `Season ${seasonNumber}`,
      posterUrl: fallbackPosterUrl,
      episodeCount: seasonEpisodes.length,
      episodes: seasonEpisodes.sort(
        (a, b) => a.episodeNumber - b.episodeNumber
      ),
    }));
}

export function normalizeAniListMedia(media: AniListMedia): NormalizedShow {
  const normalizedStatus = normalizeStatus(media.status);
  
  // AniList duration is per episode in minutes
  const episodeRuntime = media.duration && media.duration > 0
    ? media.duration
    : DEFAULTS.EPISODE_RUNTIME_MINUTES;

  // Ensure episodes count has a value
  const totalEpisodes = media.episodes && media.episodes > 0
    ? media.episodes
    : undefined; // Will be populated from Jikan fallback if available
  const releasedEpisodes = getAniListReleasedEpisodeCount(
    normalizedStatus,
    totalEpisodes,
    media.nextAiringEpisode?.episode
  );

  return {
    id: `anilist:${media.id}`,
    mediaType: "anime",
    title: media.title.english ?? media.title.romaji ?? "Untitled",
    overview: media.description ?? undefined,
    posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large,
    backdropUrl: media.bannerImage ?? undefined,
    genres: media.genres,
    status: normalizedStatus,
    totalEpisodes,
    releasedEpisodes,
    episodeRuntime,
    rating: media.averageScore ? media.averageScore / 10 : undefined,
    firstAired: formatAniListDate(media.startDate),
    anilistId: media.id,
    malId: media.idMal ?? undefined,
    anilistFormat: media.format ?? undefined,
    animeSeason: media.season ?? undefined,
    animeSeasonYear: media.seasonYear ?? undefined,
    // Anime typically has 1 season per show entry
    totalSeasons: 1,
  };
}

export function normalizeAniListScheduleEntry(
  entry: AniListAiringSchedule
): NormalizedScheduleEntry {
  const airDate = new Date(entry.airingAt * 1000);
  const airDateString = airDate.toISOString();
  
  return {
    showId: `anilist:${entry.media.id}`,
    showTitle:
      entry.media.title.english ?? entry.media.title.romaji ?? "Untitled",
    mediaType: "anime",
    episode: {
      id: `anilist-episode:${entry.id}`,
      seasonNumber: 1,
      episodeNumber: entry.episode,
      name: `Episode ${entry.episode}`,
      overview: undefined,
      stillUrl: entry.media.coverImage?.large ?? entry.media.bannerImage ?? undefined,
      airDate: airDateString,
      runtime: entry.media.duration && entry.media.duration > 0
        ? entry.media.duration
        : DEFAULTS.EPISODE_RUNTIME_MINUTES,
    },
    posterUrl: entry.media.coverImage?.large ?? undefined,
  };
}

export function normalizeTvMazeScheduleEntry(
  entry: TvMazeScheduleEntry
): NormalizedScheduleEntry {
  const normalizedRuntime = entry.runtime && entry.runtime > 0
    ? entry.runtime
    : DEFAULTS.EPISODE_RUNTIME_MINUTES;
  const normalizedAirDate =
    entry.airstamp?.trim() || (entry.airdate ?? undefined);

  return {
    showId: `tvmaze:${entry.show.id}`,
    showTitle: entry.show.name,
    mediaType: "tv",
    episode: {
      id: `tvmaze-episode:${entry.id}`,
      seasonNumber: entry.season,
      episodeNumber: entry.number,
      name: entry.name?.trim() || `Episode ${entry.number}`,
      overview: entry.show.summary ?? undefined,
      stillUrl: entry.image?.original ?? entry.image?.medium ?? undefined,
      airDate: normalizedAirDate,
      runtime: normalizedRuntime,
    },
    posterUrl: entry.show.image?.original ?? entry.show.image?.medium ?? undefined,
  };
}

export function normalizeJikanAnime(anime: JikanAnime): NormalizedShow {
  const normalizedStatus = normalizeStatus(anime.status);
  const parsedRuntime = parseJikanDurationToMinutes(anime.duration);
  const episodeRuntime = parsedRuntime && parsedRuntime > 0
    ? parsedRuntime
    : DEFAULTS.EPISODE_RUNTIME_MINUTES;

  const totalEpisodes = anime.episodes && anime.episodes > 0
    ? anime.episodes
    : undefined;
  const releasedEpisodes = getAniListReleasedEpisodeCount(
    normalizedStatus,
    totalEpisodes,
    undefined
  );

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
    status: normalizedStatus,
    totalEpisodes,
    releasedEpisodes,
    episodeRuntime,
    rating: anime.score ?? undefined,
    firstAired: normalizeDateString(anime.aired?.from),
    anilistId: undefined,
    malId: anime.mal_id,
    // Anime typically has 1 season per show entry
    totalSeasons: 1,
  };
}

export function normalizeJikanEpisode(
  episode: JikanAnimeEpisode,
  malId: number,
  episodeNumber: number
): NormalizedEpisode {
  const parsedRuntime = parseJikanDurationToMinutes(episode.duration);
  const runtime = parsedRuntime && parsedRuntime > 0
    ? parsedRuntime
    : undefined; // Will use show-level fallback

  return {
    id: `jikan-episode:${malId}:${episodeNumber}`,
    seasonNumber: 1,
    episodeNumber,
    name: episode.title?.trim() || episode.title_romanji?.trim() || `Episode ${episodeNumber}`,
    overview: undefined, // Jikan doesn't provide episode descriptions
    stillUrl: undefined, // Jikan doesn't provide episode images - will use show poster fallback
    airDate: normalizeDateString(episode.aired),
    runtime,
  };
}
