import "@/global.css";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, Platform, View, useWindowDimensions } from "react-native";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AuthGate } from "@/components/AuthGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Sidebar } from "@/components/Sidebar";
import { DESKTOP_SIDEBAR_BREAKPOINT } from "@/constants/navigation";
import { convex } from "@/lib/convex/client";
import { tokenStorage } from "@/lib/auth/token-storage";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated and will be removed in a future release.",
]);

function RootLayoutContent() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const pathname = usePathname();
  const isShellPath =
    pathname === "/home" ||
    pathname === "/discover" ||
    pathname === "/search" ||
    pathname === "/library" ||
    pathname === "/profile" ||
    pathname.startsWith("/list/") ||
    pathname.startsWith("/show/");
  const shouldShowDesktopSidebar =
    isDesktop && isShellPath;

  return (
    <View className="flex-1 flex-row" style={{ backgroundColor: "#09090b" }}>
      {shouldShowDesktopSidebar ? <Sidebar /> : null}
      <View className="flex-1 min-w-0">
        <Stack
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            fullScreenGestureEnabled: false,
            animationMatchesGesture: Platform.OS === "ios",
          }}
        />
      </View>
    </View>
  );
}

export function RootLayout() {
  return (
    <ConvexAuthProvider client={convex} storage={tokenStorage}>
      <ThemeProvider>
        <AuthGate>
          <StatusBar style="light" />
          <RootLayoutContent />
        </AuthGate>
      </ThemeProvider>
    </ConvexAuthProvider>
  );
}

export default RootLayout;
