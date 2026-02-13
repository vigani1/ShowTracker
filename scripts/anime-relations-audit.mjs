import process from "node:process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const ANILIST_URL = process.env.EXPO_PUBLIC_ANILIST_URL || "https://graphql.anilist.co";
const RELATION_TYPES = new Set(["PREQUEL", "SEQUEL"]);
const DEFAULT_ANILIST_IDS = [16498, 15125, 11061, 11757];

function parseIdList(raw) {
  if (!raw) {
    return DEFAULT_ANILIST_IDS;
  }

  const parsed = raw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  return parsed.length > 0 ? parsed : DEFAULT_ANILIST_IDS;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}) ${url}\n${body.slice(0, 220)}`);
  }
  return response.json();
}

async function fetchAniListRelations(anilistId) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        idMal
        title { romaji english }
        relations {
          edges {
            relationType
            node {
              id
              type
              title { romaji english }
            }
          }
        }
      }
    }
  `;

  const data = await fetchJson(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { id: anilistId },
    }),
  });

  return data?.data?.Media ?? null;
}

async function fetchJikanAnimeRelations(malId) {
  const data = await fetchJson(`https://api.jikan.moe/v4/anime/${malId}/relations`);
  return data?.data || [];
}

function resolveTitle(title) {
  return title?.english || title?.romaji || "Untitled";
}

async function main() {
  const sampleIds = parseIdList(process.env.ANIME_RELATION_IDS);
  let totalIncluded = 0;

  console.log(`Auditing AniList relation graph for IDs: ${sampleIds.join(", ")}`);

  for (const anilistId of sampleIds) {
    const media = await fetchAniListRelations(anilistId);
    if (!media) {
      console.warn(`- ${anilistId}: not found`);
      continue;
    }

    const title = resolveTitle(media.title);
    const animeRelations = (media.relations?.edges || [])
      .filter((edge) => edge?.node?.type === "ANIME")
      .map((edge) => ({
        relationType: edge.relationType || "UNKNOWN",
        anilistId: edge.node.id,
        title: resolveTitle(edge.node.title),
      }));

    const included = animeRelations.filter((entry) =>
      RELATION_TYPES.has(entry.relationType)
    );

    totalIncluded += included.length;

    console.log(`\n${title} (AniList ${anilistId})`);
    console.log(`- Anime relations: ${animeRelations.length}`);
    console.log(`- Included PREQUEL/SEQUEL: ${included.length}`);

    if (included.length > 0) {
      for (const entry of included) {
        console.log(`  - ${entry.relationType}: ${entry.title} [${entry.anilistId}]`);
      }
    }

    if (typeof media.idMal === "number") {
      try {
        const jikanRelations = await fetchJikanAnimeRelations(media.idMal);
        const animeCount = jikanRelations.reduce((count, relation) => {
          const entries = relation?.entry || [];
          const animeEntries = entries.filter((entry) => entry.type === "anime");
          return count + animeEntries.length;
        }, 0);
        console.log(`- Jikan anime relation entries: ${animeCount}`);
      } catch (error) {
        console.warn(`- Jikan relation fetch failed for MAL ${media.idMal}: ${String(error)}`);
      }
    }
  }

  if (totalIncluded === 0) {
    console.error("No PREQUEL/SEQUEL anime relations found in sample set.");
    process.exit(1);
  }

  console.log("\nAnime relation audit passed.");
}

main().catch((error) => {
  console.error("Anime relation audit failed", error);
  process.exit(1);
});
