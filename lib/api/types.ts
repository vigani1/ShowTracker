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
  totalSeasons?: number;
  episodeRuntime?: number;
  rating?: number;
  firstAired?: string;
  tmdbId?: number;
  anilistId?: number;
  tvmazeId?: number;
  imdbId?: string;
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

export type NormalizedScheduleEntry = {
  showId: string;
  showTitle: string;
  mediaType: MediaType;
  episode: NormalizedEpisode;
  posterUrl?: string;
};
