import { Platform, View } from "react-native";

interface ProgressBarProps {
  /** 0–1 progress value */
  progress: number;
  className?: string;
  /** Height of the bar in pixels */
  height?: number;
  animated?: boolean;
}

export function ProgressBar({
  progress,
  className,
  height = 4,
  animated = false,
}: ProgressBarProps) {
  const clampedProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  const widthPercent = `${Math.round(clampedProgress * 100)}%` as `${number}%`;

  return (
    <View
      className={`overflow-hidden bg-bg-hover/50 ${className ?? ""}`.trim()}
      style={{ height }}
    >
      <View
        className="h-full bg-primary"
        style={{
          width: widthPercent,
          ...(animated && Platform.OS === "web"
            ? { transition: "width 0.4s ease-out" as string }
            : {}),
        }}
      />
    </View>
  );
}
