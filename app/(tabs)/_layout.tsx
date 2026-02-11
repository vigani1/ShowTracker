import { Feather, Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import { Sidebar } from "@/components/Sidebar";

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <View className="flex-1 flex-row" style={{ backgroundColor: "#09090b" }}>
      {isDesktop ? (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        />
      ) : null}
      <View className="flex-1 min-w-0">
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            tabBarStyle: isDesktop
              ? { display: "none" }
              : {
                  backgroundColor: "rgba(9,9,11,0.92)",
                  borderTopWidth: 0,
                  height: 60,
                  paddingBottom: 6,
                  paddingTop: 6,
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
            name="index"
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
            name="watchlist"
            options={{
              title: "Watchlist",
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? "list" : "list-outline"} size={22} color={color} />
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
          <Tabs.Screen name="Extra" options={{ href: null }} />
          <Tabs.Screen name="schedule" options={{ href: null }} />
          <Tabs.Screen name="show/[id]" options={{ href: null }} />
          <Tabs.Screen name="list/[id]" options={{ href: null }} />
          <Tabs.Screen name="list/create" options={{ href: null }} />
        </Tabs>
      </View>
    </View>
  );
}
