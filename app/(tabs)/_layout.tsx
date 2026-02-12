import { Feather, Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, View, useWindowDimensions } from "react-native";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const mobileTabBarHeight = Platform.OS === "ios" ? 70 : 62;
  const mobileTabBarPaddingBottom = Platform.OS === "ios" ? 10 : 6;
  const mobileTabBarPaddingTop = Platform.OS === "ios" ? 4 : 6;

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
                  borderTopWidth: 0,
                  height: mobileTabBarHeight,
                  paddingBottom: mobileTabBarPaddingBottom,
                  paddingTop: mobileTabBarPaddingTop,
                  elevation: 8,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: -4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                },
            tabBarActiveTintColor: "#ef4444",
            tabBarInactiveTintColor: "#a1a1aa",
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: "600",
            },
            tabBarShowLabel: true,
          }}
        >
          <Tabs.Screen
            name="home"
            options={{
              title: "Home",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="discover"
            options={{
              title: "Discover",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "compass" : "compass-outline"} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="search"
            options={{
              title: "Search",
              tabBarIcon: ({ color }) => <Feather name="search" size={20} color={color} />,
            }}
          />
          <Tabs.Screen
            name="library"
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
