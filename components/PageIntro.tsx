import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

interface PageIntroProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  rightLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  className?: string;
  compact?: boolean;
}

export function PageIntro({
  title,
  subtitle,
  eyebrow,
  rightLabel,
  icon,
  className,
  compact = false,
}: PageIntroProps) {
  const isFabricEnabled =
    "NativeFabricUIManager" in globalThis || "__turboModuleProxy" in globalThis;
  const titleFitProps = isFabricEnabled
    ? {}
    : {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.82,
      };

  return (
    <View
      className={`relative overflow-hidden rounded-xl border border-border-default bg-bg-surface ${className ?? ""}`.trim()}
    >
      <View className={`relative px-4 ${compact ? "py-2.5" : "py-4"}`}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            {eyebrow || icon ? (
              <View className={`${compact ? "mb-1" : "mb-2"} flex-row items-center gap-2`}>
                {icon ? (
                  <View className={`${compact ? "h-5 w-5" : "h-7 w-7"} items-center justify-center rounded-md bg-bg-base/45`}>
                    <Ionicons name={icon} size={compact ? 12 : 14} color="#ef4444" />
                  </View>
                ) : null}
                {eyebrow ? (
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    {eyebrow}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text
              className={`font-mono ${compact ? "text-[23px]" : "text-[30px]"} font-black text-text-primary`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={isFabricEnabled ? { fontSize: compact ? 23 : 30, lineHeight: compact ? 28 : 36 } : undefined}
              {...titleFitProps}
            >
              {title}
            </Text>
            {!compact && subtitle ? (
              <Text className="mt-1 text-sm text-text-secondary">{subtitle}</Text>
            ) : null}
          </View>

          {rightLabel && !compact ? (
            <View className="rounded-md border border-border-default bg-bg-base/45 px-2 py-1">
              <Text className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                {rightLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
