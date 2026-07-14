import assert from "node:assert/strict";
import test from "node:test";
import { applyProviderEpisodeRuntimes } from "./provider-runtime";

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
