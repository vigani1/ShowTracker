import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedShow } from "@/lib/api/types";
import type { ParsedImportItem } from "@/lib/import/tv-time";
import { selectMetadataOnlyCandidate } from "@/lib/import/gdpr-resolver";

function item(title: string, firstAiredYear?: number): ParsedImportItem {
  return {
    title,
    mediaType: "tv",
    status: "plan_to_watch",
    watchedEpisodes: [],
    firstAiredYear,
  };
}

function show(title: string, firstAired?: string): NormalizedShow {
  return {
    id: `tmdb-tv-${title}`,
    title,
    mediaType: "tv",
    status: "ended",
    firstAired,
  };
}

test("selects an exact metadata-only title and year", () => {
  const selected = selectMetadataOnlyCandidate(item("The Strain", 2014), [
    show("The Strain", "2014-07-13"),
    show("The Strain", "2022-01-01"),
  ]);
  assert.equal(selected?.firstAired, "2014-07-13");
});

test("does not select named extensions for metadata-only entries", () => {
  const selected = selectMetadataOnlyCandidate(item("Elite"), [
    show("Elite Short Stories: Patrick", "2021-12-23"),
  ]);
  assert.equal(selected, null);
});

test("rejects low-confidence metadata-only titles", () => {
  const selected = selectMetadataOnlyCandidate(item("Baki the Grappler"), [
    show("All Elite Wrestling: Dynamite", "2019-10-02"),
  ]);
  assert.equal(selected, null);
});
