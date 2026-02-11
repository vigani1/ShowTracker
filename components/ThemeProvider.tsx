import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { useColorScheme } from "nativewind";

export function ThemeProvider({ children }: PropsWithChildren) {
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme("dark");
  }, [setColorScheme]);

  return <>{children}</>;
}
