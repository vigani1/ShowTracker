import { normalizeTmdbSeason, normalizeTvMazeEpisode } from "@/lib/api/normalize";
import { getTmdbSeasonDetails } from "@/lib/api/tmdb";
import { getTvMazeShowEpisodes } from "@/lib/api/tvmaze";
import type { NormalizedShow } from "@/lib/api/types";
import type { ParsedImportEpisode } from "@/lib/import/tv-time";

const RUNTIME_FETCH_CONCURRENCY = 3;

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export function applyProviderEpisodeRuntimes(
  episodes: ParsedImportEpisode[],
  providerRuntimes: Map<string, number>,
  showRuntime?: number
) {
  return episodes.map((episode) => ({
    ...episode,
    runtime:
      providerRuntimes.get(episodeKey(episode.season, episode.episode)) ??
      (typeof showRuntime === "number" && showRuntime > 0 ? showRuntime : episode.runtime),
  }));
}

export async function enrichImportedEpisodeRuntimes(
  episodes: ParsedImportEpisode[],
  show: NormalizedShow
) {
  if (episodes.length === 0) return episodes;

  const providerRuntimes = new Map<string, number>();

  if (show.mediaType !== "movie" && typeof show.tmdbId === "number") {
    const seasons = Array.from(new Set(episodes.map((episode) => episode.season)));
    const seasonResults = await mapWithConcurrency(
      seasons,
      RUNTIME_FETCH_CONCURRENCY,
      async (seasonNumber) =>
        getTmdbSeasonDetails(show.tmdbId!, seasonNumber)
          .then(normalizeTmdbSeason)
          .catch(() => null)
    );

    for (const season of seasonResults) {
      for (const episode of season?.episodes ?? []) {
        if (typeof episode.runtime === "number" && episode.runtime > 0) {
          providerRuntimes.set(
            episodeKey(episode.seasonNumber, episode.episodeNumber),
            episode.runtime
          );
        }
      }
    }
  } else if (show.mediaType !== "movie" && typeof show.tvmazeId === "number") {
    const providerEpisodes = await getTvMazeShowEpisodes(show.tvmazeId).catch(() => []);
    for (const rawEpisode of providerEpisodes) {
      const episode = normalizeTvMazeEpisode(rawEpisode);
      if (typeof episode.runtime === "number" && episode.runtime > 0) {
        providerRuntimes.set(
          episodeKey(episode.seasonNumber, episode.episodeNumber),
          episode.runtime
        );
      }
    }
  }

  return applyProviderEpisodeRuntimes(episodes, providerRuntimes, show.episodeRuntime);
}
