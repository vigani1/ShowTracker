import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, View, useWindowDimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { DESKTOP_TAB_RAIL_BREAKPOINT } from "@/constants/navigation";

function MobileSearchTabIcon({
  focused,
  tintColor,
}: {
  focused: boolean;
  tintColor: string;
}) {
  return (
    <View
      className={`h-11 w-11 items-center justify-center rounded-full border-2 ${
        focused
          ? "border-brand-frame bg-brand-primary"
          : "border-brand-frame/50 bg-brand-light-background dark:border-[#6c5140] dark:bg-[#2d211a]"
      }`}
    >
      <Feather name="search" size={20} color={focused ? "#fff8ef" : tintColor} />
      <View
        className={`absolute -bottom-1 h-1.5 w-1.5 rounded-full bg-brand-accent ${
          focused ? "opacity-100" : "opacity-0"
        }`}
      />
    </View>
  );
}

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const isDark = colorScheme === "dark";
  const isDesktopRemote =
    Platform.OS === "web" && width >= DESKTOP_TAB_RAIL_BREAKPOINT;

  return (
    <View className="flex-1" style={{ backgroundColor: isDark ? "#0f141d" : "#e9ddca" }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: isDesktopRemote
            ? {
                display: "none",
              }
            : {
                backgroundColor: isDark ? "#2a1f18" : "#f7efe1",
                borderTopColor: isDark ? "#6a4f3d" : "#4f3c27",
                borderTopWidth: 2,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
                height: 76,
                paddingBottom: 8,
                paddingTop: 7,
                marginHorizontal: 0,
              },
          tabBarActiveTintColor: "#e26f48",
          tabBarInactiveTintColor: isDark ? "#d1bba6" : "#5b4730",
          tabBarLabelStyle: {
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 1.1,
            fontWeight: "700",
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? "home" : "home-outline"} size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: "Discover",
            tabBarIcon: ({ color, focused }) => (
              <MaterialCommunityIcons
                name={focused ? "television-classic" : "television-classic-off"}
                size={20}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarLabel: "",
            tabBarIcon: ({ focused, color }) => (
              <MobileSearchTabIcon focused={focused} tintColor={color} />
            ),
            tabBarItemStyle: {
              justifyContent: "center",
              alignItems: "center",
              paddingTop: 0,
            },
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? "person" : "person-outline"}
                size={20}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="Extra"
          options={{
            title: "More",
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? "grid" : "grid-outline"} size={20} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="watchlist" options={{ href: null }} />
        <Tabs.Screen name="schedule" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
