import { Feather, Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const isMobileWeb = Platform.OS === "web" && !isDesktop;
  const shouldLiftTabContent = Platform.OS === "ios" || Platform.OS === "android" || isMobileWeb;
  const iosBottomInset = Math.max(insets.bottom, 18);
  const mobileTabBarPaddingBottom =
    Platform.OS === "ios" ? iosBottomInset + 8 : isMobileWeb ? 18 : 10;
  const mobileTabBarPaddingTop = Platform.OS === "ios" ? 2 : 6;
  const mobileTabBarHeight =
    Platform.OS === "ios"
      ? Math.max(84, 50 + mobileTabBarPaddingTop + mobileTabBarPaddingBottom)
      : isMobileWeb
        ? 68
        : 68;

  return (
    <View className="flex-1" style={{ backgroundColor: "#09090b" }}>
      <Tabs
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            tabBarStyle: isDesktop
              ? { display: "none" }
              : {
                  backgroundColor: "rgba(9,9,11,0.92)",
                  borderTopWidth: 2,
                  borderTopColor: "#27272a",
                  height: mobileTabBarHeight,
                  paddingBottom: mobileTabBarPaddingBottom,
                  paddingTop: mobileTabBarPaddingTop,
                },
            tabBarActiveTintColor: "#ef4444",
            tabBarInactiveTintColor: "#a1a1aa",
            tabBarIconStyle: shouldLiftTabContent
              ? {
                  marginTop: Platform.OS === "ios" ? -2 : 0,
                  transform: [{ translateY: -6 }],
                }
              : undefined,
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: "900",
              textTransform: "uppercase" as const,
              letterSpacing: 0.5,
              marginBottom: Platform.OS === "ios" ? 2 : 0,
              ...(shouldLiftTabContent ? { transform: [{ translateY: -6 }] } : null),
            },
            tabBarShowLabel: true,
          }}
        >
          <Tabs.Screen
            name="home/index"
            options={{
              title: "Home",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="discover/index"
            options={{
              title: "Discover",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "compass" : "compass-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="recommendations"
            options={{
              title: "For You",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "sparkles" : "sparkles-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="search"
            options={{
              title: "Search",
              href: isDesktop ? undefined : null,
              tabBarIcon: ({ color }) => <Feather name="search" size={20} color={color} />,
            }}
          />
          <Tabs.Screen
            name="library/index"
            options={{
              title: "Library",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons
                  name={focused ? "albums" : "albums-outline"}
                  size={22}
                  color={color}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: "Profile",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
              ),
            }}
          />
        </Tabs>
    </View>
  );
}
