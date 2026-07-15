export type ProgressTone = "active" | "complete" | "idle" | "paused" | "dropped";

export const PROGRESS_TONE_COLORS: Record<ProgressTone, string> = {
  active: "#c59a4a",
  complete: "#6f8f7a",
  idle: "#52525b",
  paused: "#64748b",
  dropped: "#8b627f",
};

export function getProgressTone({
  progress,
  status,
}: {
  progress: number;
  status?: string | null;
}): ProgressTone {
  const normalizedStatus = status?.trim().toLowerCase();

  if (normalizedStatus === "dropped" || normalizedStatus === "cancelled") {
    return "dropped";
  }
  if (normalizedStatus === "paused") {
    return "paused";
  }
  if (normalizedStatus === "plan_to_watch" || progress <= 0) {
    return "idle";
  }
  if (normalizedStatus === "completed" || normalizedStatus === "watched" || progress >= 1) {
    return "complete";
  }
  return "active";
}
