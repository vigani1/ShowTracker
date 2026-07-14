import { normalizeTmdbShowDetails, normalizeTvMazeShow } from "@/lib/api/normalize";
import {
  findTmdbByTvdbId,
  getTmdbShowDetails,
  searchTmdb,
} from "@/lib/api/tmdb";
import {
  getTvMazeShowEpisodes,
  lookupTvMazeShowByTvdb,
} from "@/lib/api/tvmaze";
import type { NormalizedShow } from "@/lib/api/types";
import type { ParsedImportItem } from "@/lib/import/tv-time";
import { enrichImportedEpisodeRuntimes } from "@/lib/import/provider-runtime";

export type GdprImportPlan = {
  parsed: ParsedImportItem;
  show: NormalizedShow;
};

function normalizeTitle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(value?: string | null) {
  const match = value?.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function scoreTitle(a: string, b: string) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shortestWordCount = Math.min(left.split(" ").length, right.split(" ").length);
  if (shortestWordCount >= 2 && (left.includes(right) || right.includes(left))) return 0.88;
  const leftWords = new Set(left.split(" ").filter(Boolean));
  const rightWords = new Set(right.split(" ").filter(Boolean));
  let overlap = 0;
  for (const word of leftWords) if (rightWords.has(word)) overlap += 1;
  return overlap / Math.max(leftWords.size, rightWords.size);
}

function scoreCandidate(item: ParsedImportItem, show: NormalizedShow) {
  const title = scoreTitle(item.title, show.title);
  const candidateYear = extractYear(show.firstAired);
  const year =
    !item.firstAiredYear || !candidateYear
      ? 0.5
      : Math.abs(item.firstAiredYear - candidateYear) === 0
        ? 1
        : Math.abs(item.firstAiredYear - candidateYear) === 1
          ? 0.8
          : 0.2;
  return title * 0.8 + year * 0.2;
}

function isNamedExtensionTitle(source: string, candidate: string) {
  const sourceTitle = normalizeTitle(source);
  const candidateTitle = normalizeTitle(candidate);
  const yearQualifiedSource = /\((19|20)\d{2}\)/.test(source);
  const sourceWithoutYear = sourceTitle.replace(/\s+(19|20)\d{2}$/, "");
  const anthologyContinuation =
    yearQualifiedSource &&
    candidateTitle.startsWith(`${sourceWithoutYear.replace(/s$/, "")}s `);
  return (
    candidateTitle !== sourceTitle &&
    (anthologyContinuation ||
      (candidateTitle.startsWith(sourceTitle) &&
        /\b(unlimited|short stories|specials?|ova|season|part|chapter|book|case|movie|film|inspector)\b/.test(
          candidateTitle.slice(sourceTitle.length)
        )))
  );
}

function isContinuationCandidate(
  item: ParsedImportItem,
  firstShow: NormalizedShow,
  candidate: NormalizedShow
) {
  const titleContinuesSource =
    normalizeTitle(candidate.title) !== normalizeTitle(firstShow.title) &&
    isNamedExtensionTitle(item.title, candidate.title);
  const firstYear = extractYear(firstShow.firstAired);
  const candidateYear = extractYear(candidate.firstAired);
  return (
    titleContinuesSource &&
    candidate.mediaType === firstShow.mediaType &&
    (!firstYear || !candidateYear || candidateYear >= firstYear)
  );
}

function candidateKey(show: NormalizedShow) {
  if (show.tmdbId) return `tmdb:${show.tmdbId}`;
  if (show.tvmazeId) return `tvmaze:${show.tvmazeId}`;
  return show.id;
}

async function hydrateTmdb(show: NormalizedShow) {
  if (typeof show.tmdbId !== "number") return null;
  const mediaType = show.mediaType === "movie" ? "movie" : "tv";
  const details = await getTmdbShowDetails(mediaType, show.tmdbId).catch(() => null);
  return details ? normalizeTmdbShowDetails(mediaType, details) : null;
}

async function collectCandidates(item: ParsedImportItem) {
  const candidates: NormalizedShow[] = [];
  if (typeof item.tvdbId === "number") {
    const [tmdbFind, tvmazeShow] = await Promise.all([
      findTmdbByTvdbId(item.tvdbId).catch(() => null),
      lookupTvMazeShowByTvdb(item.tvdbId).catch(() => null),
    ]);
    const tmdbCandidates = await Promise.all(
      (tmdbFind?.items ?? []).filter((show) => show.mediaType === "tv").map(hydrateTmdb)
    );
    candidates.push(
      ...tmdbCandidates
        .filter((show): show is NormalizedShow => show !== null)
        .map((show) => ({ ...show, tvdbId: item.tvdbId }))
    );
    if (tvmazeShow) {
      const episodes = await getTvMazeShowEpisodes(tvmazeShow.id, true).catch(() => []);
      candidates.push(normalizeTvMazeShow(tvmazeShow, episodes));
    }
  }

  const hasSpecials = item.watchedEpisodes.some(
    (episode) => (episode.sourceSeason ?? episode.season) === 0
  );
  const searches = await Promise.all([
    searchTmdb(item.title, "tv", 1).catch(() => null),
    hasSpecials
      ? searchTmdb(`${item.title} short stories`, "tv", 1).catch(() => null)
      : Promise.resolve(null),
    hasSpecials
      ? searchTmdb(`${item.title} ova`, "tv", 1).catch(() => null)
      : Promise.resolve(null),
    item.mediaType === "movie" || item.watchedEpisodes.length <= 10
      ? searchTmdb(item.title, "movie", 1).catch(() => null)
      : Promise.resolve(null),
    /\((19|20)\d{2}\)/.test(item.title)
      ? searchTmdb(
          `${item.title.replace(/\s*\((19|20)\d{2}\)\s*$/, "").replace(/s$/i, "")}s`,
          "tv",
          1
        ).catch(() => null)
      : Promise.resolve(null),
  ]);
  const rankedTmdb = Array.from(
    new Map(
      searches
        .flatMap((result) => result?.items ?? [])
        .filter((show) => typeof show.tmdbId === "number")
        .map((show) => [show.tmdbId!, show])
    ).values()
  )
    .filter(
      (show) =>
        scoreCandidate(item, show) >= 0.68 || isNamedExtensionTitle(item.title, show.title)
    )
    .slice(0, 24);
  const hydratedSearch = await Promise.all(rankedTmdb.map(hydrateTmdb));
  candidates.push(...hydratedSearch.filter((show): show is NormalizedShow => show !== null));

  const unique = new Map<string, NormalizedShow>();
  for (const show of candidates) {
    const key = candidateKey(show);
    if (!unique.has(key)) unique.set(key, show);
  }
  return Array.from(unique.values());
}

export async function auditGdprImportCandidates(item: ParsedImportItem) {
  const candidates = await collectCandidates(item);
  const results = [];
  for (const show of candidates) {
    const resolved = await enrichImportedEpisodeRuntimes(item.watchedEpisodes, show, {
      sourceTvdbId: item.tvdbId,
      canonicalize: true,
    });
    results.push({
      title: show.title,
      tmdbId: show.tmdbId,
      tvmazeId: show.tvmazeId,
      score: scoreCandidate(item, show),
      canonical: resolved.filter((episode) => episode.unmatched !== true).length,
    });
  }
  return results.sort((a, b) => b.canonical - a.canonical || b.score - a.score);
}

function sourceEpisodeKey(episode: ParsedImportItem["watchedEpisodes"][number]) {
  return episode.sourceEpisodeId ??
    `${episode.sourceSeason ?? episode.season}:${episode.sourceEpisode ?? episode.episode}`;
}

export async function resolveGdprImportPlans(item: ParsedImportItem) {
  const candidates = await collectCandidates(item);
  const plans: GdprImportPlan[] = [];
  let remaining = item.watchedEpisodes;
  const unused = [...candidates];

  while (remaining.length > 0 && unused.length > 0) {
    const baseCandidates = unused.filter(
      (show) => !isNamedExtensionTitle(item.title, show.title)
    );
    const eligible = plans[0]
      ? unused.filter((show) => isContinuationCandidate(item, plans[0].show, show))
      : baseCandidates.length > 0
        ? baseCandidates
        : unused;
    if (plans[0]) {
      eligible.sort(
        (a, b) =>
          (Date.parse(a.firstAired ?? "") || Number.MAX_SAFE_INTEGER) -
          (Date.parse(b.firstAired ?? "") || Number.MAX_SAFE_INTEGER)
      );
    }
    const evaluated: Array<{
      show: NormalizedShow;
      canonical: ParsedImportItem["watchedEpisodes"];
      score: number;
    }> = [];
    for (const show of eligible) {
      const continuationSource = plans[0]
        ? remaining.map((episode, index) =>
            ({
              ...episode,
              season: 1,
              episode: index + 1,
              sourceSeason: 1,
              sourceEpisode: index + 1,
            })
          )
        : remaining;
      const candidateSource =
        show.mediaType === "movie" ? continuationSource.slice(0, 1) : continuationSource;
      const resolved = await enrichImportedEpisodeRuntimes(candidateSource, show, {
        sourceTvdbId: item.tvdbId,
        canonicalize: true,
      });
      const originalById = new Map(
        remaining
          .filter((episode) => episode.sourceEpisodeId)
          .map((episode) => [episode.sourceEpisodeId!, episode])
      );
      evaluated.push({
        show,
        canonical: resolved
          .filter((episode) => episode.unmatched !== true)
          .map((episode) => {
            const original = episode.sourceEpisodeId
              ? originalById.get(episode.sourceEpisodeId)
              : undefined;
            return original
              ? {
                  ...episode,
                  sourceSeason: original.sourceSeason ?? original.season,
                  sourceEpisode: original.sourceEpisode ?? original.episode,
                  isSpecial: original.isSpecial,
                }
              : episode;
          }),
        score: scoreCandidate(item, show),
      });
    }
    evaluated.sort(
      (a, b) => b.canonical.length - a.canonical.length || b.score - a.score
    );
    const best = evaluated[0];
    if (!best || best.canonical.length === 0) break;
    plans.push({ parsed: { ...item, watchedEpisodes: best.canonical }, show: best.show });
    const matched = new Set(best.canonical.map(sourceEpisodeKey));
    remaining = remaining.filter((episode) => !matched.has(sourceEpisodeKey(episode)));
    unused.splice(unused.findIndex((show) => candidateKey(show) === candidateKey(best.show)), 1);
  }

  if (remaining.length > 0 && plans[0]) {
    plans[0].parsed.watchedEpisodes.push(
      ...remaining.map((episode) => ({ ...episode, unmatched: true }))
    );
  }
  return { plans, unmatched: remaining };
}
