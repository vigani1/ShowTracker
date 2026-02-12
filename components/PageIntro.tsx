import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "react-native";

interface PageIntroProps {
  title: string;
  subtitle: string;
  eyebrow?: string;
  rightLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  className?: string;
}

export function PageIntro({
  title,
  subtitle,
  eyebrow,
  icon,
  className,
}: PageIntroProps) {
  return (
    <View
      className={`relative overflow-hidden rounded-2xl border border-border-default bg-bg-surface ${className ?? ""}`.trim()}
    >
      <LinearGradient
        colors={["rgba(239,68,68,0.16)", "rgba(56,189,248,0.08)", "rgba(24,24,27,0.7)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View className="absolute -right-10 -top-8 h-28 w-28 rounded-full bg-primary/15" />
      <View className="absolute -bottom-12 -left-10 h-28 w-28 rounded-full bg-accent/10" />

      <View className="relative px-4 py-4">
        <View>
          {eyebrow || icon ? (
            <View className="mb-2 flex-row items-center gap-2">
              {icon ? (
                <View className="h-7 w-7 items-center justify-center rounded-lg bg-bg-base/40">
                  <Ionicons name={icon} size={14} color="#ef4444" />
                </View>
              ) : null}
              {eyebrow ? (
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  {eyebrow}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text className="text-[30px] font-black tracking-tight text-text-primary">
            {title}
          </Text>
          <Text className="mt-1 text-sm text-text-secondary">{subtitle}</Text>
        </View>
      </View>
    </View>
  );
}
