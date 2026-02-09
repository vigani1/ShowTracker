import type { PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { Platform, useColorScheme as useDeviceColorScheme } from "react-native";
import { useColorScheme } from "nativewind";

const THEME_STORAGE_KEY = "showtracker.theme";

export function ThemeProvider({ children }: PropsWithChildren) {
  const deviceScheme = useDeviceColorScheme();
  const { colorScheme, setColorScheme } = useColorScheme();
  const hasAppliedInitialScheme = useRef(false);

  useEffect(() => {
    if (hasAppliedInitialScheme.current) {
      return;
    }

    let storedScheme: "light" | "dark" | "system" | null = null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") {
        storedScheme = raw;
      }
    }

    if (storedScheme) {
      setColorScheme(storedScheme);
    } else if (deviceScheme) {
      setColorScheme(deviceScheme);
    }

    hasAppliedInitialScheme.current = true;
  }, [deviceScheme, setColorScheme]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    if (!colorScheme) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, colorScheme);

    const resolvedTheme = colorScheme ?? deviceScheme ?? "light";
    const backgroundColor = resolvedTheme === "dark" ? "#0f141d" : "#e9ddca";
    document.body.style.backgroundColor = backgroundColor;
    document.documentElement.style.backgroundColor = backgroundColor;

    const root = document.getElementById("root");
    if (root) {
      root.style.backgroundColor = backgroundColor;
    }
  }, [colorScheme, deviceScheme]);

  return <>{children}</>;
}
