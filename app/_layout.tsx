import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { ConvexProvider } from "convex/react";
import { AuthGate } from "@/components/AuthGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { convex } from "@/lib/convex/client";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ConvexProvider client={convex}>
      <ThemeProvider>
        <AuthGate>
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      </ThemeProvider>
    </ConvexProvider>
  );
}
