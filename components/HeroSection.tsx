import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";
import { toHttpsImageUrl } from "@/lib/image-url";

interface HeroSectionProps {
  imageUrl?: string | null;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  mobileHeight?: number;
  className?: string;
}

export function HeroSection({
  imageUrl,
  title,
  subtitle,
  children,
  mobileHeight = 250,
  className,
}: HeroSectionProps) {
  const isWeb = Platform.OS === "web";
  const { width } = useWindowDimensions();
  const heroHeight = isWeb ? Math.max(280, Math.round(width * 0.25)) : mobileHeight;
  const heroImageUrl = toHttpsImageUrl(imageUrl);

  return (
    <View
      className={`relative w-full overflow-hidden ${className ?? ""}`.trim()}
      style={{ height: heroHeight }}
    >
      {/* Backdrop image */}
      {heroImageUrl ? (
        <Image
          source={{ uri: heroImageUrl }}
          className="absolute inset-0"
          resizeMode="cover"
        />
      ) : (
        <View className="absolute inset-0 bg-gray-800" />
      )}

      {/* Content overlay */}
      <View className="absolute left-0 right-0 bottom-0 p-6 justify-end">
        {title ? (
          <Text className="text-white text-[28px] font-extrabold tracking-[-0.5px]" numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text className="text-gray-300 text-sm mt-1.5 leading-5" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {children ? <View className="mt-3">{children}</View> : null}
      </View>
    </View>
  );
}
