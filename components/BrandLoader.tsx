import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

export function BrandLoader({
  compact = false,
  micro = false,
  onPrimary = false,
}: {
  compact?: boolean;
  micro?: boolean;
  onPrimary?: boolean;
}) {
  const pulses = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.stagger(
          140,
          pulses.map((pulse) =>
            Animated.sequence([
              Animated.timing(pulse, {
                toValue: 1,
                duration: 190,
                useNativeDriver: true,
              }),
              Animated.timing(pulse, {
                toValue: 0,
                duration: 190,
                useNativeDriver: true,
              }),
            ])
          )
        ),
        Animated.delay(180),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulses]);

  const width = micro ? 14 : compact ? 22 : 34;
  const height = micro ? 3 : compact ? 4 : 6;
  const gap = micro ? 2 : compact ? 3 : 4;

  return (
    <View accessibilityRole="progressbar" style={{ gap, width: width + 8 }}>
      {[0, 1, 2].map((index) => (
        <Animated.View
          key={index}
          style={{
            alignSelf: index === 2 ? "flex-end" : "flex-start",
            backgroundColor: onPrimary
              ? index === 2
                ? "#18181b"
                : "#ffffff"
              : index === 2
                ? "#f4f4f5"
                : "#ef4444",
            borderBottomLeftRadius: index === 2 ? 0 : height,
            borderBottomRightRadius: index === 2 ? height : 0,
            borderTopLeftRadius: index === 2 ? 0 : height,
            borderTopRightRadius: index === 2 ? height : 0,
            height,
            opacity: pulses[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0.35, 1],
            }),
            transform: [
              {
                translateX: pulses[index].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 4],
                }),
              },
            ],
            width,
          }}
        />
      ))}
    </View>
  );
}
