import type { MediaType, NormalizedShow } from "@/lib/api/types";

type NumericShowSource = "tmdb" | "anilist" | "jikan" | "tvmaze";
type StringShowSource = "imdb";
type ShowSource = NumericShowSource | StringShowSource;

export type ShowRouteId =
  | {
      source: NumericShowSource;
      mediaType: MediaType;
      externalId: number;
    }
  | {
      source: StringShowSource;
      mediaType: MediaType;
      externalId: string;
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

  if (show.tvmazeId && show.mediaType === "tv") {
    return `tvmaze:tv:${show.tvmazeId}`;
  }

  if (show.imdbId?.trim()) {
    return `imdb:${show.mediaType}:${show.imdbId.trim().toLowerCase()}`;
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

  if (
    source !== "tmdb" &&
    source !== "anilist" &&
    source !== "jikan" &&
    source !== "tvmaze" &&
    source !== "imdb"
  ) {
    return null;
  }

  if (mediaType !== "tv" && mediaType !== "anime" && mediaType !== "movie") {
    return null;
  }

  if (source === "imdb") {
    const normalizedImdbId = externalId.trim();
    if (!/^tt\d+$/i.test(normalizedImdbId)) {
      return null;
    }

    return {
      source,
      mediaType,
      externalId: normalizedImdbId.toLowerCase(),
    };
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
