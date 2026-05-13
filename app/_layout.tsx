import "@/global.css";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, Platform, View, useWindowDimensions } from "react-native";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
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
    pathname === "/recommendations" ||
    pathname === "/search" ||
    pathname === "/library" ||
    pathname === "/profile" ||
    pathname === "/profile/settings" ||
    pathname === "/import" ||
    pathname.startsWith("/list/") ||
    pathname.startsWith("/show/");
  const shouldShowDesktopSidebar =
    isDesktop && isShellPath;

  return (
    <View className="flex-1 flex-row" style={{ backgroundColor: "#09090b" }}>
      {shouldShowDesktopSidebar ? <Sidebar /> : null}
      <View className="flex-1 min-w-0">
        <AppErrorBoundary resetKey={pathname}>
          <Stack
            screenOptions={{
              headerShown: false,
              gestureEnabled: true,
              fullScreenGestureEnabled: false,
              animationMatchesGesture: Platform.OS === "ios",
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="show/[id]"
              options={{
                presentation: "transparentModal",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="profile/settings"
              options={{
                presentation: "transparentModal",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
          </Stack>
        </AppErrorBoundary>
      </View>
    </View>
  );
}

export function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexAuthProvider
        client={convex}
        storage={tokenStorage}
        // App currently uses password + anonymous auth only.
        // Disable auth code handling to avoid verifyCode runtime failures
        // when stale `code` params are present.
        shouldHandleCode={false}
      >
        <ThemeProvider>
          <AuthGate>
            <StatusBar style="light" />
            <RootLayoutContent />
          </AuthGate>
        </ThemeProvider>
      </ConvexAuthProvider>
    </GestureHandlerRootView>
  );
}

export default RootLayout;
