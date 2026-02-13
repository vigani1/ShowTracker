/**
 * Anime Episode Image Coverage Documentation
 * 
 * ## Current State
 * 
 * Anime episodes do NOT have episode-specific images available from any of the APIs:
 * 
 * 1. **AniList**: Provides show-level images (poster, banner) but no episode images
 * 2. **Jikan (MAL)**: Provides episode titles and air dates, but no episode images
 * 3. **TMDB**: Some anime have episode images, but this is rare and inconsistent
 * 
 * ## Fallback Strategy
 * 
 * When episode-specific images are not available, the system falls back to:
 * 1. Show backdrop image (banner)
 * 2. Show poster image
 * 3. Generic placeholder with episode number
 * 
 * ## Implementation Details
 * 
 * - EpisodeCard.tsx handles missing stillUrl by showing a placeholder with "E01", "E02", etc.
 * - When fallbackStillUrl is provided (show banner/poster), it's used for all episodes
 * - The EpisodeCard displays episode number badge overlay to distinguish episodes
 * - This is consistent with industry standard (Netflix, Crunchyroll, etc. use show art for episodes)
 * 
 * ## Validation Results
 * 
 * ✅ Episode cards never render blank - always have either:
 *    - Episode-specific image (rare, only from TMDB for some shows)
 *    - Show banner/poster as fallback
 *    - Generic placeholder with large episode number
 * 
 * ✅ Visual distinction maintained via:
 *    - S01E01 style badges on each episode
 *    - Episode titles displayed below image
 *    - Runtime badges when available
 * 
 * ## Future Improvements
 * 
 * - Could scrape episode thumbnails from streaming services (legal/technical challenges)
 * - Could generate placeholder gradients unique to each episode number
 * - Community-contributed episode images (user uploads)
 */

export const ANIME_EPISODE_IMAGE_LIMITATIONS = {
  hasEpisodeImages: false,
  fallbackStrategy: "show_banner_then_poster",
  placeholderStrategy: "episode_number_badge",
  apisWithoutEpisodeImages: ["AniList", "Jikan/MAL"],
  occasionalSupport: "TMDB (rare, inconsistent)",
} as const;

/**
 * Determines if a media type typically has episode-specific images
 */
export function hasEpisodeImages(mediaType: string, source: string): boolean {
  if (mediaType === "tv") {
    // TV shows from TMDB often have episode images
    return source === "tmdb";
  }
  
  if (mediaType === "anime") {
    // Anime almost never has episode images from any source
    return false;
  }
  
  if (mediaType === "movie") {
    // Movies are single items, no episodes
    return false;
  }
  
  return false;
}

/**
 * Gets the appropriate episode image strategy based on media type and available data
 */
export function getEpisodeImageStrategy(
  mediaType: string,
  hasEpisodeStill: boolean,
  showBackdropUrl?: string,
  showPosterUrl?: string
): {
  imageUrl: string | undefined;
  usePlaceholder: boolean;
  placeholderText: string;
} {
  // If we have an episode-specific image, use it
  if (hasEpisodeStill) {
    return {
      imageUrl: undefined, // Will be provided by episode data
      usePlaceholder: false,
      placeholderText: "",
    };
  }
  
  // For anime, use show backdrop/poster as episode fallback
  if (mediaType === "anime") {
    return {
      imageUrl: showBackdropUrl ?? showPosterUrl,
      usePlaceholder: !showBackdropUrl && !showPosterUrl,
      placeholderText: "Anime",
    };
  }
  
  // For TV, prefer placeholder over generic fallback
  if (mediaType === "tv") {
    return {
      imageUrl: undefined,
      usePlaceholder: true,
      placeholderText: "TV",
    };
  }
  
  return {
    imageUrl: undefined,
    usePlaceholder: true,
    placeholderText: "",
  };
}
