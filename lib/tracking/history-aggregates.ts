export type WatchedHistoryEntry = {
  season: number;
  episode: number;
  runtime?: number;
  watchCount?: number;
};

export function computeWatchedHistoryAggregates(entries: WatchedHistoryEntry[]) {
  const episodeKeys = new Set<string>();
  let totalCount = 0;
  let runtimeMinutes = 0;

  for (const entry of entries) {
    episodeKeys.add(`${entry.season}:${entry.episode}`);
    const watchCount = entry.watchCount ?? 1;
    totalCount += watchCount;
    runtimeMinutes += (entry.runtime ?? 0) * watchCount;
  }

  return {
    episodesCount: episodeKeys.size,
    totalCount,
    runtimeMinutes,
  };
}
