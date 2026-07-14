import fs from "node:fs";
import path from "node:path";
import {
  TV_TIME_GDPR_FILES,
  parseTvTimeGdprFiles,
} from "../lib/import/tv-time-gdpr";
import { resolveGdprImportPlans } from "../lib/import/gdpr-resolver";

const archiveDirectory = process.argv[2];
if (!archiveDirectory) {
  throw new Error("Usage: tsx scripts/tv-time-import-audit.mts <gdpr-directory>");
}

const files: Partial<Record<(typeof TV_TIME_GDPR_FILES)[keyof typeof TV_TIME_GDPR_FILES], string>> = {};
for (const name of Object.values(TV_TIME_GDPR_FILES)) {
  const filePath = path.join(archiveDirectory, name);
  if (fs.existsSync(filePath)) files[name] = fs.readFileSync(filePath, "utf8");
}

const parsed = parseTvTimeGdprFiles(files);
const onlyTitles = new Set(process.argv.slice(3));
const items =
  onlyTitles.size > 0 ? parsed.items.filter((item) => onlyTitles.has(item.title)) : parsed.items;
const results = [];

for (const item of items) {
  const resolved = await resolveGdprImportPlans(item);
  results.push({
    sourceTitle: item.title,
    sourceEpisodes: item.watchedEpisodes.length,
    canonicalEpisodes: resolved.plans.reduce(
      (total, plan) => total + plan.parsed.watchedEpisodes.filter((episode) => !episode.unmatched).length,
      0
    ),
    unmatchedEpisodes: resolved.unmatched.length,
    destinations: resolved.plans.map((plan) => ({
      title: plan.show.title,
      mediaType: plan.show.mediaType,
      tmdbId: plan.show.tmdbId,
      tvmazeId: plan.show.tvmazeId,
      anilistId: plan.show.anilistId,
      episodes: plan.parsed.watchedEpisodes.filter((episode) => !episode.unmatched).length,
    })),
  });
}

console.log(
  JSON.stringify(
    {
      sourceEpisodes: results.reduce((total, result) => total + result.sourceEpisodes, 0),
      canonicalEpisodes: results.reduce((total, result) => total + result.canonicalEpisodes, 0),
      unmatchedEpisodes: results.reduce((total, result) => total + result.unmatchedEpisodes, 0),
      results,
    },
    null,
    2
  )
);
