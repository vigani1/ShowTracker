import type { MediaType, NormalizedShow } from "@/lib/api/types";

type ShowSource = "tmdb" | "anilist" | "jikan";

export type ShowRouteId = {
  source: ShowSource;
  mediaType: MediaType;
  externalId: number;
};

function parseNumericSuffix(value: string, prefix: string) {
  if (!value.startsWith(prefix)) {
    return null;
  }
  const numericPart = Number(value.slice(prefix.length));
  return Number.isFinite(numericPart) ? numericPart : null;
}

export function createShowRouteId(show: NormalizedShow): string {
  if (show.tmdbId && (show.mediaType === "tv" || show.mediaType === "movie")) {
    return `tmdb:${show.mediaType}:${show.tmdbId}`;
  }

  if (show.anilistId && show.mediaType === "anime") {
    return `anilist:anime:${show.anilistId}`;
  }

  const tmdbId = parseNumericSuffix(show.id, "tmdb:");
  if (tmdbId !== null && (show.mediaType === "tv" || show.mediaType === "movie")) {
    return `tmdb:${show.mediaType}:${tmdbId}`;
  }

  const anilistId = parseNumericSuffix(show.id, "anilist:");
  if (anilistId !== null) {
    return `anilist:anime:${anilistId}`;
  }

  const jikanId = parseNumericSuffix(show.id, "jikan:");
  if (jikanId !== null) {
    return `jikan:anime:${jikanId}`;
  }

  throw new Error(`Unsupported show id format: ${show.id}`);
}

export function parseShowRouteId(value: string | null | undefined): ShowRouteId | null {
  if (!value) {
    return null;
  }

  const [source, mediaType, externalId] = value.split(":");
  if (!source || !mediaType || !externalId) {
    return null;
  }

  if (source !== "tmdb" && source !== "anilist" && source !== "jikan") {
    return null;
  }

  if (mediaType !== "tv" && mediaType !== "anime" && mediaType !== "movie") {
    return null;
  }

  if (!/^\d+$/.test(externalId)) {
    return null;
  }

  const parsedId = Number.parseInt(externalId, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }

  return { source, mediaType, externalId: parsedId };
}
