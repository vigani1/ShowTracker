import assert from "node:assert/strict";
import test from "node:test";
import { computeWatchedHistoryAggregates } from "./history-aggregates";

test("counts all stored history independently of provider numbering", () => {
  const result = computeWatchedHistoryAggregates([
    { season: 1, episode: 1, runtime: 24, watchCount: 2 },
    { season: 17, episode: 366, runtime: 25, watchCount: 1 },
  ]);

  assert.deepEqual(result, {
    episodesCount: 2,
    totalCount: 3,
    runtimeMinutes: 73,
  });
});
