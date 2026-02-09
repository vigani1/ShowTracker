import { type Href, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import { useColorScheme } from "nativewind";

type RemoteItem = {
  key: "home" | "discover" | "search" | "profile" | "more";
  label: string;
  href: Href;
  channel: string;
  isActive: (pathname: string) => boolean;
};

const TOP_REMOTE_ITEMS: RemoteItem[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    channel: "CH 1",
    isActive: (pathname) => pathname === "/",
  },
  {
    key: "discover",
    label: "Discover",
    href: "/discover",
    channel: "CH 2",
    isActive: (pathname) => pathname.startsWith("/discover"),
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    channel: "CH 3",
    isActive: (pathname) => pathname.startsWith("/search"),
  },
  {
    key: "more",
    label: "More",
    href: "/Extra",
    channel: "CH 4",
    isActive: (pathname) => pathname.startsWith("/Extra"),
  },
];

const BOTTOM_REMOTE_ITEMS: RemoteItem[] = [
  {
    key: "profile",
    label: "Profile",
    href: "/profile",
    channel: "USER",
    isActive: (pathname) => pathname.startsWith("/profile"),
  },
];

interface ControlButtonProps {
  item: RemoteItem;
  focused: boolean;
  isDark: boolean;
  onPress: () => void;
}

function ControlButton({ item, focused, isDark, onPress }: ControlButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interaction = useRef(new Animated.Value(0)).current;
  const ledIntensity = useRef(new Animated.Value(focused ? 1 : 0.56)).current;
  const activeGlow = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const target = pressed ? -1 : hovered ? 1 : 0;
    Animated.timing(interaction, {
      toValue: target,
      duration: pressed ? 90 : 170,
      easing: pressed ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hovered, interaction, pressed]);

  useEffect(() => {
    let ledAnimation: Animated.CompositeAnimation | null = null;

    if (focused) {
      ledIntensity.setValue(0.68);
      ledAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(ledIntensity, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(ledIntensity, {
            toValue: 0.68,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      ledAnimation.start();
    } else {
      Animated.timing(ledIntensity, {
        toValue: hovered ? 0.72 : 0.56,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }

    return () => {
      ledAnimation?.stop();
    };
  }, [focused, hovered, ledIntensity]);

  useEffect(() => {
    let glowAnimation: Animated.CompositeAnimation | null = null;

    if (focused) {
      activeGlow.setValue(0.45);
      glowAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(activeGlow, {
            toValue: 1,
            duration: 920,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(activeGlow, {
            toValue: 0.45,
            duration: 920,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      glowAnimation.start();
    } else {
      Animated.timing(activeGlow, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }

    return () => {
      glowAnimation?.stop();
    };
  }, [activeGlow, focused]);

  let buttonClass = isDark
    ? "border-[#6b4f3f] bg-[#33241b]"
    : "border-[#ab9985] bg-[#f1e6d7]";

  if (focused) {
    buttonClass = isDark
      ? "border-[#81614d] bg-[#31241b]"
      : "border-[#9f8068] bg-[#dcc8b4]";
  } else if (pressed) {
    buttonClass = isDark
      ? "border-[#5f4536] bg-[#2b1d15]"
      : "border-[#9f8d79] bg-[#e6d9c8]";
  } else if (hovered) {
    buttonClass = isDark
      ? "border-[#7d5f4b] bg-[#3a2a20]"
      : "border-[#a8937c] bg-[#f7ecdd]";
  }

  const socketClass = isDark
    ? pressed
      ? "border-[#4f3a2d] bg-[#2b1e16]"
      : "border-[#6a4f3f] bg-[#3a2a21]"
    : pressed
      ? "border-[#b4a08c] bg-[#ded2c0]"
      : "border-[#c9b7a2] bg-[#ece2d2]";

  const socketWebStyle =
    Platform.OS === "web"
      ? ({
          boxShadow: pressed
            ? isDark
              ? "inset 0px 2px 4px rgba(8,4,2,0.74), inset 0px 1px 0 rgba(255,232,212,0.07)"
              : "inset 0px 2px 4px rgba(99,74,53,0.26), inset 0px 1px 0 rgba(255,255,255,0.16)"
            : isDark
              ? "inset 0px 1px 0 rgba(255,237,220,0.12), 0px 1px 0 rgba(20,9,5,0.9)"
              : "inset 0px 1px 0 rgba(255,255,255,0.3), 0px 1px 0 rgba(98,74,54,0.22)",
        } as never)
      : undefined;

  const buttonWebStyle =
    Platform.OS === "web"
      ? ({
          boxShadow: pressed
            ? isDark
              ? "inset 0px 2px 0 rgba(9,4,2,0.84)"
              : "inset 0px 2px 0 rgba(91,67,49,0.27)"
            : focused
              ? isDark
                ? "0px 5px 12px rgba(9,4,2,0.45), 0px 0px 0px 1px rgba(209,96,66,0.2)"
                : "0px 5px 12px rgba(91,67,49,0.18), 0px 0px 0px 1px rgba(209,96,66,0.2)"
              : hovered
                ? isDark
                  ? "0px 4px 10px rgba(12,6,3,0.35)"
                  : "0px 4px 10px rgba(93,68,49,0.16)"
                : undefined,
          filter: pressed ? "brightness(0.95)" : hovered ? "brightness(1.03)" : "none",
        } as never)
      : undefined;

  const channelChipClass = focused
    ? isDark
      ? "border-[#c57f61] bg-[#543527]"
      : "border-[#9b6d52] bg-[#e4cab3]"
    : isDark
      ? "border-[#725646] bg-[#3f2e24]"
      : "border-[#b9a590] bg-[#ece3d5]";

  const channelTextClass = focused
    ? isDark
      ? "text-[#ffe6d7]"
      : "text-[#5f3f2e]"
    : isDark
      ? "text-[#efd9c5]"
      : "text-[#5d4b3d]";

  const labelTextClass = focused
    ? isDark
      ? "text-[#fff6ed]"
      : "text-[#2f2217]"
    : isDark
      ? "text-[#f0dbc7]"
      : "text-[#42352b]";

  const ledWebStyle =
    Platform.OS === "web" && focused
      ? ({ boxShadow: "0px 0px 10px rgba(255,93,66,0.55)" } as never)
      : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      onHoverIn={Platform.OS === "web" ? () => setHovered(true) : undefined}
      onHoverOut={
        Platform.OS === "web"
          ? () => {
              setHovered(false);
              setPressed(false);
            }
          : undefined
      }
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={Platform.OS === "web" ? ({ cursor: "pointer", userSelect: "none" } as never) : undefined}
    >
      <View className={`rounded-xl border p-[1.5px] ${socketClass}`} style={socketWebStyle}>
        <Animated.View
          className={`relative min-h-[66px] overflow-hidden rounded-[10px] border px-3 pb-2.5 pt-2 ${buttonClass}`}
          style={[
            {
              transform: [
                {
                  scale: interaction.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [0.972, 1, 1.014],
                  }),
                },
                {
                  translateY: interaction.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [2.4, 0, -0.8],
                  }),
                },
              ],
            },
            buttonWebStyle,
          ]}
        >
          {focused ? (
            <Animated.View
              pointerEvents="none"
              className="absolute inset-0 rounded-[10px]"
              style={{
                opacity: activeGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.08, 0.2],
                }),
                backgroundColor: isDark ? "rgba(209,96,66,0.1)" : "rgba(209,96,66,0.08)",
              }}
            />
          ) : null}

          <View className="flex-row items-center justify-between">
            <Animated.View
              className={`h-[9px] w-[9px] rounded-full border ${
                focused
                  ? "border-[#8f190f] bg-[#ff503f]"
                  : "border-[#8a7d72] bg-[#b6ab9d] dark:border-[#a18168] dark:bg-[#8b6e5a]"
              }`}
              style={[
                {
                  opacity: ledIntensity.interpolate({
                    inputRange: [0.5, 1],
                    outputRange: [0.55, 1],
                  }),
                  transform: [
                    {
                      scale: ledIntensity.interpolate({
                        inputRange: [0.5, 1],
                        outputRange: [0.9, 1.08],
                      }),
                    },
                  ],
                },
                ledWebStyle,
              ]}
            />
            <View className={`rounded-full border px-2 py-[1px] ${channelChipClass}`}>
              <Text
                className={`text-[7px] font-bold uppercase tracking-[1.2px] ${channelTextClass}`}
                numberOfLines={1}
              >
                {item.channel}
              </Text>
            </View>
          </View>

          <Text
            className={`mt-2 text-center text-[12px] font-black uppercase tracking-[1.25px] ${labelTextClass}`}
            numberOfLines={1}
          >
            {item.label}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

export function TvSideRemotePanel() {
  const pathname = usePathname();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const shellClass = isDark
    ? "border-[#6b5241] bg-[#4a362b]"
    : "border-[#ab9a86] bg-[#cbc1b1]";
  const shellInnerClass = isDark
    ? "border-[#846452] bg-[#3a2b23]"
    : "border-[#b2a18f] bg-[#dbd0c1]";
  const topCapsuleClass = isDark
    ? "border-[#8f6f5b] bg-[#3d2d23]"
    : "border-[#b9a48d] bg-[#ebe1d0]";
  const helperTextClass = isDark ? "text-[#e7d3bf]" : "text-[#54463b]";

  const renderItem = (item: RemoteItem) => {
    const focused = item.isActive(pathname);

    return (
      <ControlButton
        key={item.key}
        item={item}
        focused={focused}
        isDark={isDark}
        onPress={() => router.replace(item.href)}
      />
    );
  };

  return (
    <View className={`h-full w-[132px] rounded-[24px] border-2 p-2.5 ${shellClass}`}>
      <View className={`flex-1 rounded-[17px] border p-2 ${shellInnerClass}`}>
        <View className={`rounded-xl border px-2 py-1.5 ${topCapsuleClass}`}>
          <Text className={`text-center text-[9px] font-bold uppercase tracking-[1.35px] ${helperTextClass}`}>
            Controls
          </Text>
          <Text className={`pt-0.5 text-center text-[7px] font-bold uppercase tracking-[1.15px] ${helperTextClass}`}>
            Navigation
          </Text>
        </View>

        <View className="mt-2.5 gap-2.5">{TOP_REMOTE_ITEMS.map(renderItem)}</View>

        <View className="mt-auto gap-2.5 pt-2.5">{BOTTOM_REMOTE_ITEMS.map(renderItem)}</View>
      </View>
    </View>
  );
}
