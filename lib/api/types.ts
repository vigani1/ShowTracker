export type MediaType = "tv" | "anime" | "movie";

export type NormalizedShow = {
  id: string;
  mediaType: MediaType;
  title: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  genres?: string[];
  status?: string;
  totalEpisodes?: number;
  releasedEpisodes?: number;
  totalSeasons?: number;
  episodeRuntime?: number;
  rating?: number;
  firstAired?: string;
  tmdbId?: number;
  tvdbId?: number;
  anilistId?: number;
  malId?: number;
  tvmazeId?: number;
  imdbId?: string;
  anilistFormat?: string;
  animeSeason?: string;
  animeSeasonYear?: number;
  rootAnilistId?: number;
  relatedAnilistIds?: number[];
  lastRelationSyncAt?: number;
};

export type NormalizedSeason = {
  seasonNumber: number;
  name?: string;
  overview?: string;
  posterUrl?: string;
  episodeCount?: number;
  episodes?: NormalizedEpisode[];
};

export type NormalizedEpisode = {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
  overview?: string;
  stillUrl?: string;
  airDate?: string;
  runtime?: number;
};

export type JikanAnimeEpisodesPage = {
  episodes: NormalizedEpisode[];
  hasNextPage: boolean;
};

export type NormalizedScheduleEntry = {
  showId: string;
  showTitle: string;
  mediaType: MediaType;
  episode: NormalizedEpisode;
  posterUrl?: string;
};
