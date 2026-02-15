import { getCached, setCached } from "@/lib/api/cache";

const cacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours for genres

export type TmdbGenre = {
  id: number;
  name: string;
};

export type GenreMap = Record<number, string>;

// TMDB Genre IDs
export const TMDB_TV_GENRES: GenreMap = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

export const TMDB_MOVIE_GENRES: GenreMap = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

// AniList genres (they don't use IDs, just strings)
export const ANILIST_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Hentai",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterConfig = {
  id: string;
  label: string;
  type: "single" | "multi" | "range";
  options?: FilterOption[];
  min?: number;
  max?: number;
};

export type ActiveFilters = {
  genres?: string[];
  year?: number;
  minRating?: number;
  status?: string;
};

// Get genres for a specific media type
export function getGenresForMediaType(
  mediaType: "tv" | "movie" | "anime"
): FilterOption[] {
  if (mediaType === "anime") {
    return ANILIST_GENRES.map((g) => ({ value: g, label: g }));
  }

  const genreMap = mediaType === "movie" ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
  return Object.entries(genreMap).map(([id, name]) => ({
    value: id,
    label: name,
  }));
}

// Get all unique genres across types (for "all" filter)
export function getAllGenres(): FilterOption[] {
  const allGenres = new Map<string, string>();

  // Add TV genres
  Object.entries(TMDB_TV_GENRES).forEach(([id, name]) => {
    allGenres.set(name, id);
  });

  // Add Movie genres
  Object.entries(TMDB_MOVIE_GENRES).forEach(([id, name]) => {
    if (!allGenres.has(name)) {
      allGenres.set(name, id);
    }
  });

  // Add Anime genres
  ANILIST_GENRES.forEach((genre) => {
    if (!allGenres.has(genre)) {
      allGenres.set(genre, genre);
    }
  });

  return Array.from(allGenres.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ value, label: name }));
}

// Year range options
export function getYearOptions(startYear = 1950): FilterOption[] {
  const currentYear = new Date().getFullYear();
  const years: FilterOption[] = [];

  for (let year = currentYear; year >= startYear; year--) {
    years.push({ value: String(year), label: String(year) });
  }

  return years;
}

// Rating options
export const RATING_OPTIONS: FilterOption[] = [
  { value: "8", label: "8+ ⭐" },
  { value: "7", label: "7+ ⭐" },
  { value: "6", label: "6+ ⭐" },
  { value: "5", label: "5+ ⭐" },
];

// Status options for anime
export const ANILIST_STATUS_OPTIONS: FilterOption[] = [
  { value: "RELEASING", label: "Airing" },
  { value: "FINISHED", label: "Finished" },
  { value: "NOT_YET_RELEASED", label: "Upcoming" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "HIATUS", label: "On Hiatus" },
];

// TMDB status options for TV
export const TMDB_TV_STATUS_OPTIONS: FilterOption[] = [
  { value: "Returning Series", label: "Returning" },
  { value: "Ended", label: "Ended" },
  { value: "Canceled", label: "Canceled" },
  { value: "Pilot", label: "Pilot" },
];

// Get appropriate filters for media type
export function getFiltersForMediaType(
  mediaType: "all" | "tv" | "movie" | "anime"
): FilterConfig[] {
  const baseFilters: FilterConfig[] = [
    {
      id: "genres",
      label: "Genres",
      type: "multi",
      options:
        mediaType === "all"
          ? getAllGenres()
          : getGenresForMediaType(
              mediaType as "tv" | "movie" | "anime"
            ),
    },
    {
      id: "year",
      label: "Year",
      type: "single",
      options: getYearOptions(),
    },
    {
      id: "minRating",
      label: "Min Rating",
      type: "single",
      options: RATING_OPTIONS,
    },
  ];

  // Add status filter for specific types
  if (mediaType === "anime") {
    baseFilters.push({
      id: "status",
      label: "Status",
      type: "single",
      options: ANILIST_STATUS_OPTIONS,
    });
  } else if (mediaType === "tv") {
    baseFilters.push({
      id: "status",
      label: "Status",
      type: "single",
      options: TMDB_TV_STATUS_OPTIONS,
    });
  }

  return baseFilters;
}

// Check if filters are active
export function hasActiveFilters(filters: ActiveFilters): boolean {
  return (
    (filters.genres && filters.genres.length > 0) ||
    filters.year !== undefined ||
    filters.minRating !== undefined ||
    filters.status !== undefined
  );
}

// Clear all filters
export function clearFilters(): ActiveFilters {
  return {};
}

// Get filter count for badge
export function getActiveFilterCount(filters: ActiveFilters): number {
  let count = 0;
  if (filters.genres?.length) count += filters.genres.length;
  if (filters.year !== undefined) count += 1;
  if (filters.minRating !== undefined) count += 1;
  if (filters.status !== undefined) count += 1;
  return count;
}
