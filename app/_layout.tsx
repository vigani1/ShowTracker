import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { View } from "react-native";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AuthGate } from "@/components/AuthGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { convex } from "@/lib/convex/client";
import { tokenStorage } from "@/lib/auth/token-storage";

export function RootLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <ConvexAuthProvider client={convex} storage={tokenStorage}>
      <ThemeProvider>
        <AuthGate>
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          <View className="flex-1" style={{ backgroundColor: isDark ? "#0f141d" : "#e9ddca" }}>
            <Stack screenOptions={{ headerShown: false }} />
          </View>
        </AuthGate>
      </ThemeProvider>
    </ConvexAuthProvider>
  );
}

export default RootLayout;
