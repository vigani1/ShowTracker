import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#0b0f1a", borderTopColor: "#121a2b" },
        tabBarActiveTintColor: "#5b7cfa",
        tabBarInactiveTintColor: "#6b7280",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Discover" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen name="watchlist" options={{ title: "Watchlist" }} />
      <Tabs.Screen name="schedule" options={{ title: "Schedule" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
