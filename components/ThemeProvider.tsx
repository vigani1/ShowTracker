import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { useColorScheme as useDeviceColorScheme } from "react-native";
import { useColorScheme } from "nativewind";

export function ThemeProvider({ children }: PropsWithChildren) {
  const deviceScheme = useDeviceColorScheme();
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    if (deviceScheme) {
      setColorScheme(deviceScheme);
    }
  }, [deviceScheme, setColorScheme]);

  return <>{children}</>;
}
