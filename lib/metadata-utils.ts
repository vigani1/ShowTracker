import type { NormalizedEpisode, NormalizedSeason, NormalizedShow } from "@/lib/api/types";

// Default fallback values for missing metadata
export const DEFAULTS = {
  EPISODE_RUNTIME_MINUTES: 24, // Standard anime/TV episode length
  MOVIE_RUNTIME_MINUTES: 110,  // Average movie length
  TOTAL_EPISODES_FALLBACK: 12, // Standard season length
  TOTAL_SEASONS_FALLBACK: 1,
} as const;

// Status normalization map for consistent API responses
export const STATUS_NORMALIZATION: Record<string, string> = {
  // TMDB statuses
  "Returning Series": "returning",
  "Ended": "ended",
  "Canceled": "canceled",
  "In Production": "in_production",
  "Planned": "planned",
  "Pilot": "pilot",
  // AniList statuses
  "RELEASING": "airing",
  "FINISHED": "finished",
  "NOT_YET_RELEASED": "upcoming",
  "CANCELLED": "canceled",
  "HIATUS": "on_hiatus",
  // Jikan statuses
  "Currently Airing": "airing",
  "Finished Airing": "finished",
  "Not yet aired": "upcoming",
};

/**
 * Normalizes show status to a consistent format
 */
export function normalizeStatus(status?: string | null): string | undefined {
  if (!status) return undefined;
  const normalized = STATUS_NORMALIZATION[status] || status.toLowerCase().replace(/\s+/g, "_");
  return normalized;
}

/**
 * Calculates total estimated runtime for a show based on episodes and runtime per episode
 */
export function calculateTotalRuntime(
  totalEpisodes: number | undefined,
  episodeRuntime: number | undefined,
  mediaType: string
): number | undefined {
  const episodes = totalEpisodes ?? DEFAULTS.TOTAL_EPISODES_FALLBACK;
  const runtime = episodeRuntime ?? (mediaType === "movie" ? DEFAULTS.MOVIE_RUNTIME_MINUTES : DEFAULTS.EPISODE_RUNTIME_MINUTES);
  
  if (episodes > 0 && runtime > 0) {
    return episodes * runtime;
  }
  return undefined;
}

/**
 * Safely gets episode runtime with fallback chain:
 * 1. Episode's own runtime
 * 2. Show's episode runtime
 * 3. Default based on media type
 */
export function getEpisodeRuntime(
  episode: NormalizedEpisode,
  showRuntime?: number,
  mediaType: string = "tv"
): number | undefined {
  if (episode.runtime && episode.runtime > 0) {
    return episode.runtime;
  }
  if (showRuntime && showRuntime > 0) {
    return showRuntime;
  }
  return mediaType === "movie" ? DEFAULTS.MOVIE_RUNTIME_MINUTES : DEFAULTS.EPISODE_RUNTIME_MINUTES;
}

/**
 * Parses air date safely, returning null if invalid
 */
export function parseAirDate(dateString?: string | null): Date | null {
  if (!dateString) return null;
  
  const trimmed = dateString.trim();
  if (!trimmed) return null;
  
  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1; // 0-indexed
    const day = parseInt(isoMatch[3], 10);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Fallback to general parsing
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return null;
}

/**
 * Checks if an episode has aired based on its air date
 * Returns true if no air date is available (optimistic default)
 */
export function hasEpisodeAired(airDateString?: string | null): boolean {
  const airDate = parseAirDate(airDateString);
  if (!airDate) return true; // Optimistic default: assume released if no date
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const compareDate = new Date(airDate);
  compareDate.setHours(0, 0, 0, 0);
  
  return compareDate.getTime() <= today.getTime();
}

/**
 * Gets the count of released episodes from a list
 */
export function getReleasedEpisodeCount(episodes: NormalizedEpisode[]): number {
  return episodes.filter(ep => hasEpisodeAired(ep.airDate)).length;
}

/**
 * Calculates progress percentage with bounds checking
 */
export function calculateProgress(watched: number, total: number): number {
  if (total <= 0) return 0;
  if (watched <= 0) return 0;
  if (watched >= total) return 100;
  return Math.round((watched / total) * 100);
}

/**
 * Validates and fixes show metadata, ensuring all required fields have values
 */
export function validateShowMetadata(show: NormalizedShow): NormalizedShow {
  const validated = { ...show };
  
  // Ensure status is normalized
  if (validated.status) {
    validated.status = normalizeStatus(validated.status) || validated.status;
  }
  
  // Set reasonable defaults for missing numeric fields
  if (validated.totalEpisodes == null || validated.totalEpisodes <= 0) {
    // Try to infer from seasons if available
    validated.totalEpisodes = DEFAULTS.TOTAL_EPISODES_FALLBACK;
  }
  
  if (validated.totalSeasons == null || validated.totalSeasons <= 0) {
    validated.totalSeasons = DEFAULTS.TOTAL_SEASONS_FALLBACK;
  }
  
  // Ensure episode runtime has a value
  if (validated.episodeRuntime == null || validated.episodeRuntime <= 0) {
    validated.episodeRuntime = show.mediaType === "movie" 
      ? DEFAULTS.MOVIE_RUNTIME_MINUTES 
      : DEFAULTS.EPISODE_RUNTIME_MINUTES;
  }
  
  // Ensure rating is within valid range (0-10)
  if (validated.rating != null && (validated.rating < 0 || validated.rating > 10)) {
    validated.rating = Math.max(0, Math.min(10, validated.rating));
  }
  
  return validated;
}

/**
 * Validates season metadata
 */
export function validateSeasonMetadata(season: NormalizedSeason): NormalizedSeason {
  const validated = { ...season };
  
  // Ensure episode count is set
  if (validated.episodeCount == null || validated.episodeCount <= 0) {
    validated.episodeCount = validated.episodes?.length || DEFAULTS.TOTAL_EPISODES_FALLBACK;
  }
  
  // Ensure name is set
  if (!validated.name || validated.name.trim() === "") {
    validated.name = `Season ${validated.seasonNumber}`;
  }
  
  return validated;
}

/**
 * Validates episode metadata
 */
export function validateEpisodeMetadata(
  episode: NormalizedEpisode,
  showRuntime?: number,
  mediaType: string = "tv"
): NormalizedEpisode {
  const validated = { ...episode };
  
  // Ensure name is set
  if (!validated.name || validated.name.trim() === "") {
    validated.name = `Episode ${validated.episodeNumber}`;
  }
  
  // Ensure runtime is set
  if (validated.runtime == null || validated.runtime <= 0) {
    validated.runtime = getEpisodeRuntime(episode, showRuntime, mediaType);
  }
  
  return validated;
}

/**
 * Gets the best available episode image URL with fallback chain
 */
export function getEpisodeImageUrl(
  episode: NormalizedEpisode,
  showBackdropUrl?: string,
  showPosterUrl?: string
): string | undefined {
  // Primary: episode still
  if (episode.stillUrl) {
    return episode.stillUrl;
  }
  
  // Fallback: show backdrop
  if (showBackdropUrl) {
    return showBackdropUrl;
  }
  
  // Final fallback: show poster
  if (showPosterUrl) {
    return showPosterUrl;
  }
  
  return undefined;
}

/**
 * Formats air date for display
 */
export function formatAirDate(dateString?: string | null): string {
  const date = parseAirDate(dateString);
  if (!date) return "Air date TBA";
  
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Gets the availability status label for an episode
 */
export function getEpisodeAvailabilityStatus(
  airDateString?: string | null
): { isAvailable: boolean; label: string; colorClass: string } {
  const airDate = parseAirDate(airDateString);
  
  if (!airDate) {
    return { isAvailable: true, label: "Release unknown", colorClass: "text-text-muted" };
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const compareDate = new Date(airDate);
  compareDate.setHours(0, 0, 0, 0);
  
  if (compareDate.getTime() > today.getTime()) {
    const formatted = formatAirDate(airDateString);
    return { isAvailable: false, label: `Airs ${formatted}`, colorClass: "text-warning" };
  }
  
  if (compareDate.getTime() === today.getTime()) {
    return { isAvailable: true, label: "Out now", colorClass: "text-success" };
  }
  
  const formatted = formatAirDate(airDateString);
  return { isAvailable: true, label: `Aired ${formatted}`, colorClass: "text-success" };
}
