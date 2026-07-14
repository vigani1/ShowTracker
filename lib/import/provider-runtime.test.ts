import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProviderEpisodeRuntimes,
  reconcileEpisodesWithProviderCatalogue,
} from "./provider-runtime";

const providerEpisodes = [
  { id: "provider:1", seasonNumber: 1, episodeNumber: 1, runtime: 22 },
  { id: "provider:2", seasonNumber: 1, episodeNumber: 2, runtime: 23 },
  { id: "provider:3", seasonNumber: 1, episodeNumber: 3, runtime: 24 },
  { id: "provider:4", seasonNumber: 1, episodeNumber: 4, runtime: 25 },
];

test("prefers exact provider episode runtime over all fallbacks", () => {
  const result = applyProviderEpisodeRuntimes(
    [{ season: 1, episode: 1, runtime: 25 }],
    new Map([["1:1", 47]]),
    45
  );
  assert.equal(result[0].runtime, 47);
});

test("uses provider show runtime before archived runtime", () => {
  const result = applyProviderEpisodeRuntimes(
    [{ season: 1, episode: 1, runtime: 25 }],
    new Map(),
    24
  );
  assert.equal(result[0].runtime, 24);
});

test("retains archived runtime only when provider runtime is unavailable", () => {
  const result = applyProviderEpisodeRuntimes(
    [{ season: 1, episode: 1, runtime: 25 }],
    new Map()
  );
  assert.equal(result[0].runtime, 25);
});

test("canonicalizes compatible coordinates directly", () => {
  const [result] = reconcileEpisodesWithProviderCatalogue(
    [{ season: 1, episode: 2, sourceSeason: 1, sourceEpisode: 2, runtime: 45 }],
    providerEpisodes,
    30
  );
  assert.equal(result.providerEpisodeId, "provider:2");
  assert.equal(result.importMatchMethod, "exact");
  assert.equal(result.unmatched, false);
  assert.equal(result.runtime, 23);
});

test("maps contiguous source seasons by canonical provider order", () => {
  const result = reconcileEpisodesWithProviderCatalogue(
    [
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
      { season: 2, episode: 2 },
    ],
    providerEpisodes,
    30
  );
  assert.deepEqual(
    result.map((entry) => [entry.season, entry.episode, entry.importMatchMethod]),
    [
      [1, 1, "ordinal"],
      [1, 2, "ordinal"],
      [1, 3, "ordinal"],
      [1, 4, "ordinal"],
    ]
  );
  assert.deepEqual(
    result.map((entry) => [entry.sourceSeason, entry.sourceEpisode]),
    [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]
  );
});

test("flattens noncontiguous source season groups into provider order", () => {
  const result = reconcileEpisodesWithProviderCatalogue(
    [
      { season: 1, episode: 1 },
      { season: 3, episode: 4 },
    ],
    providerEpisodes,
    30
  );
  assert.deepEqual(
    result.map((entry) => [entry.season, entry.episode, entry.importMatchMethod]),
    [
      [1, 1, "ordinal"],
      [1, 2, "ordinal"],
    ]
  );
});

test("flattens up to provider capacity when the source has extra episodes", () => {
  const result = reconcileEpisodesWithProviderCatalogue(
    [
      { season: 1, episode: 1 },
      { season: 1, episode: 5 },
      { season: 1, episode: 6 },
      { season: 1, episode: 7 },
      { season: 1, episode: 8 },
    ],
    providerEpisodes,
    30
  );
  assert.equal(result[0].importMatchMethod, "ordinal");
  assert.equal(result[0].unmatched, false);
  assert.equal(result[3].unmatched, false);
  assert.equal(result[4].unmatched, true);
});

test("does not ordinal-map unmatched specials", () => {
  const [result] = reconcileEpisodesWithProviderCatalogue(
    [{ season: 0, episode: 7, isSpecial: true }],
    providerEpisodes,
    30
  );
  assert.equal(result.importMatchMethod, undefined);
  assert.equal(result.unmatched, true);
});

test("maps source specials across provider special ordering", () => {
  const result = reconcileEpisodesWithProviderCatalogue(
    [
      { season: 0, episode: 1, isSpecial: true },
      { season: 0, episode: 2, isSpecial: true },
    ],
    [
      ...providerEpisodes,
      { id: "special:1", seasonNumber: 0, episodeNumber: 1, runtime: 30 },
      { id: "special:2", seasonNumber: 0, episodeNumber: 2, runtime: 31 },
    ],
    30
  );
  assert.deepEqual(
    result.map((episode) => [episode.providerEpisodeId, episode.importMatchMethod]),
    [
      ["special:1", "exact"],
      ["special:2", "exact"],
    ]
  );
});
