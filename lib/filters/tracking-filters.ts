import type { MediaType } from "@/lib/api/types";

export type UserTrackingStatus =
  | "watching"
  | "paused"
  | "dropped"
  | "completed"
  | "plan_to_watch";

export type TrackingMediaFilter = "all" | MediaType;

export type TrackingStatusFilter =
  | "all"
  | "active"
  | "watching"
  | "plan_to_watch"
  | "paused"
  | "dropped"
  | "completed"
  | "watched"
  | "not_watched";

export type TrackingFilterableItem = {
  mediaType: MediaType;
  status?: string | null;
  watchedEpisodes?: number | null;
};

export function normalizeTrackingStatus(
  status: string | null | undefined
): UserTrackingStatus | null {
  if (!status) {
    return null;
  }

  const normalized = status.trim().toLowerCase();
  if (
    normalized === "watching" ||
    normalized === "paused" ||
    normalized === "dropped" ||
    normalized === "completed" ||
    normalized === "plan_to_watch"
  ) {
    return normalized;
  }

  return null;
}

export function matchesMediaFilter(
  mediaType: MediaType,
  filter: TrackingMediaFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  return mediaType === filter;
}

export function matchesStatusFilter(
  item: Pick<TrackingFilterableItem, "status" | "watchedEpisodes">,
  filter: TrackingStatusFilter
): boolean {
  if (filter === "all") {
    return true;
  }

  const status = normalizeTrackingStatus(item.status);
  if (filter === "active") {
    return status === "watching" || status === "plan_to_watch";
  }

  if (filter === "watched") {
    return status === "completed";
  }

  if (filter === "not_watched") {
    return status !== "completed";
  }

  return status === filter;
}

export function applyTrackingFilters<T extends TrackingFilterableItem>(
  items: T[],
  filters: {
    media: TrackingMediaFilter;
    status: TrackingStatusFilter;
  }
): T[] {
  return items.filter(
    (item) =>
      matchesMediaFilter(item.mediaType, filters.media) &&
      matchesStatusFilter(item, filters.status)
  );
}
