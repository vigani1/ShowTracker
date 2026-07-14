import { normalizeTmdbSeason, normalizeTvMazeEpisode } from "@/lib/api/normalize";
import { getTmdbSeasonDetails, getTmdbShowDetails } from "@/lib/api/tmdb";
import { getTvMazeShowEpisodes, lookupTvMazeShowByTvdb } from "@/lib/api/tvmaze";
import type { NormalizedEpisode, NormalizedShow } from "@/lib/api/types";
import type { ParsedImportEpisode } from "@/lib/import/tv-time";

const CATALOGUE_FETCH_CONCURRENCY = 3;

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

function getSourceCoordinates(episode: ParsedImportEpisode) {
  return {
    season: episode.sourceSeason ?? episode.season,
    episode: episode.sourceEpisode ?? episode.episode,
  };
}

function sortEpisodes<T extends { seasonNumber: number; episodeNumber: number }>(episodes: T[]) {
  return [...episodes].sort(
    (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
  );
}

function isContiguousSourcePrefix(episodes: ParsedImportEpisode[]) {
  const regular = episodes
    .filter((entry) => getSourceCoordinates(entry).season > 0)
    .sort((a, b) => {
      const sourceA = getSourceCoordinates(a);
      const sourceB = getSourceCoordinates(b);
      return sourceA.season - sourceB.season || sourceA.episode - sourceB.episode;
    });
  if (regular.length === 0 || getSourceCoordinates(regular[0]).season !== 1) return false;

  const seasons = new Map<number, number[]>();
  for (const entry of regular) {
    const source = getSourceCoordinates(entry);
    const values = seasons.get(source.season) ?? [];
    values.push(source.episode);
    seasons.set(source.season, values);
  }
  const seasonNumbers = Array.from(seasons.keys()).sort((a, b) => a - b);
  for (let index = 0; index < seasonNumbers.length; index += 1) {
    if (seasonNumbers[index] !== index + 1) return false;
    const episodeNumbers = Array.from(new Set(seasons.get(seasonNumbers[index]) ?? [])).sort(
      (a, b) => a - b
    );
    if (episodeNumbers.some((value, episodeIndex) => value !== episodeIndex + 1)) return false;
  }
  return true;
}

function withProviderEpisode(
  source: ParsedImportEpisode,
  provider: NormalizedEpisode,
  method: "exact" | "ordinal",
  showRuntime?: number
): ParsedImportEpisode {
  const sourceCoordinates = getSourceCoordinates(source);
  return {
    ...source,
    season: provider.seasonNumber,
    episode: provider.episodeNumber,
    sourceSeason: sourceCoordinates.season,
    sourceEpisode: sourceCoordinates.episode,
    providerEpisodeId: provider.id,
    importMatchMethod: method,
    unmatched: false,
    runtime: provider.runtime ?? showRuntime ?? source.runtime,
  };
}

function asUnmatched(source: ParsedImportEpisode, showRuntime?: number): ParsedImportEpisode {
  const sourceCoordinates = getSourceCoordinates(source);
  return {
    ...source,
    season: sourceCoordinates.season,
    episode: sourceCoordinates.episode,
    sourceSeason: sourceCoordinates.season,
    sourceEpisode: sourceCoordinates.episode,
    providerEpisodeId: undefined,
    importMatchMethod: undefined,
    unmatched: true,
    runtime: showRuntime ?? source.runtime,
  };
}

export function reconcileEpisodesWithProviderCatalogue(
  episodes: ParsedImportEpisode[],
  providerEpisodes: NormalizedEpisode[],
  showRuntime?: number
) {
  const validProviderEpisodes = providerEpisodes.filter(
    (entry) =>
      Number.isInteger(entry.seasonNumber) &&
      Number.isInteger(entry.episodeNumber) &&
      entry.episodeNumber > 0
  );
  const providerByCoordinate = new Map(
    validProviderEpisodes.map((entry) => [
      episodeKey(entry.seasonNumber, entry.episodeNumber),
      entry,
    ])
  );
  const regularSource = episodes.filter(
    (entry) => getSourceCoordinates(entry).season > 0
  );
  const allRegularCoordinatesMatch =
    regularSource.length > 0 &&
    regularSource.every((entry) => {
      const source = getSourceCoordinates(entry);
      return providerByCoordinate.has(episodeKey(source.season, source.episode));
    });

  const ordinalProviderEpisodes = sortEpisodes(
    validProviderEpisodes.filter((entry) => entry.seasonNumber > 0)
  );
  const useOrdinal =
    !allRegularCoordinatesMatch &&
    isContiguousSourcePrefix(regularSource) &&
    regularSource.length <= ordinalProviderEpisodes.length;
  const ordinalSource = [...regularSource].sort((a, b) => {
    const sourceA = getSourceCoordinates(a);
    const sourceB = getSourceCoordinates(b);
    return sourceA.season - sourceB.season || sourceA.episode - sourceB.episode;
  });
  const ordinalIndex = new Map(ordinalSource.map((entry, index) => [entry, index]));

  return episodes.map((entry) => {
    const source = getSourceCoordinates(entry);
    const direct = providerByCoordinate.get(episodeKey(source.season, source.episode));
    if (source.season === 0) {
      return direct
        ? withProviderEpisode(entry, direct, "exact", showRuntime)
        : asUnmatched(entry, showRuntime);
    }
    if (allRegularCoordinatesMatch && direct) {
      return withProviderEpisode(entry, direct, "exact", showRuntime);
    }
    const index = ordinalIndex.get(entry);
    if (useOrdinal && typeof index === "number" && ordinalProviderEpisodes[index]) {
      return withProviderEpisode(entry, ordinalProviderEpisodes[index], "ordinal", showRuntime);
    }
    return asUnmatched(entry, showRuntime);
  });
}

async function getProviderEpisodeCatalogue(
  show: NormalizedShow,
  importedEpisodes: ParsedImportEpisode[],
  sourceTvdbId?: number
) {
  if (show.mediaType === "movie") return [];

  if (typeof show.tmdbId === "number") {
    const details = await getTmdbShowDetails("tv", show.tmdbId);
    const seasonEpisodeCounts = new Map(
      (details.seasons ?? []).map((season) => [
        season.season_number,
        season.episode_count ?? 0,
      ])
    );
    const regularCoordinatesFit = importedEpisodes
      .filter((episode) => getSourceCoordinates(episode).season > 0)
      .every((episode) => {
        const source = getSourceCoordinates(episode);
        return source.episode <= (seasonEpisodeCounts.get(source.season) ?? 0);
      });
    const seasonNumbers = regularCoordinatesFit
      ? Array.from(
          new Set(importedEpisodes.map((episode) => getSourceCoordinates(episode).season))
        )
      : Array.from(new Set((details.seasons ?? []).map((season) => season.season_number)));
    const seasons = await mapWithConcurrency(
      seasonNumbers,
      CATALOGUE_FETCH_CONCURRENCY,
      async (seasonNumber) =>
        getTmdbSeasonDetails(show.tmdbId!, seasonNumber)
          .then(normalizeTmdbSeason)
          .catch(() => null)
    );
    return seasons.flatMap((season) => season?.episodes ?? []);
  }

  let tvmazeId = show.tvmazeId;
  if (typeof tvmazeId !== "number" && typeof sourceTvdbId === "number") {
    const tvmazeShow = await lookupTvMazeShowByTvdb(sourceTvdbId).catch(() => null);
    tvmazeId = tvmazeShow?.id;
  }
  if (typeof tvmazeId === "number") {
    const episodes = await getTvMazeShowEpisodes(tvmazeId, true);
    return episodes.flatMap((entry) =>
      typeof entry.number === "number" && entry.number > 0
        ? [normalizeTvMazeEpisode(entry)]
        : []
    );
  }
  return [];
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
  show: NormalizedShow,
  options: { sourceTvdbId?: number; canonicalize?: boolean } = {}
) {
  if (episodes.length === 0) return episodes;
  if (show.mediaType === "movie") {
    return episodes.map((episode) => ({
      ...episode,
      sourceSeason: episode.sourceSeason ?? episode.season,
      sourceEpisode: episode.sourceEpisode ?? episode.episode,
      providerEpisodeId:
        typeof show.tmdbId === "number" ? `tmdb-movie:${show.tmdbId}` : show.id,
      importMatchMethod: "exact" as const,
      unmatched: false,
      runtime: show.episodeRuntime ?? episode.runtime,
    }));
  }

  const providerEpisodes = await getProviderEpisodeCatalogue(
    show,
    episodes,
    options.sourceTvdbId
  ).catch(() => []);
  if (options.canonicalize) {
    return reconcileEpisodesWithProviderCatalogue(
      episodes,
      providerEpisodes,
      show.episodeRuntime
    );
  }

  const providerRuntimes = new Map<string, number>();
  for (const episode of providerEpisodes) {
    if (typeof episode.runtime === "number" && episode.runtime > 0) {
      providerRuntimes.set(
        episodeKey(episode.seasonNumber, episode.episodeNumber),
        episode.runtime
      );
    }
  }
  return applyProviderEpisodeRuntimes(episodes, providerRuntimes, show.episodeRuntime);
}
