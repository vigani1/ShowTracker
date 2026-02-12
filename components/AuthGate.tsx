import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { useConvexAuth } from "convex/react";
import { Platform } from "react-native";

export function AuthGate({ children }: PropsWithChildren) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const isNative = Platform.OS !== "web";

    const isAuthRoute = pathname === "/login" || pathname === "/register";
    const isLandingRoute = pathname === "/" || pathname === "/lp" || pathname === "/lp/landing";
    const isPublicRoute = isAuthRoute || (!isNative && isLandingRoute);

    const unauthenticatedRedirect = isNative ? "/login" : "/";

    if (!isAuthenticated && !isPublicRoute) {
      router.replace(unauthenticatedRedirect);
      return;
    }

    if (isNative && isAuthenticated && isLandingRoute) {
      router.replace("/home");
      return;
    }

    if (isAuthenticated && isAuthRoute) {
      router.replace("/home");
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return null;
  }

  return <>{children}</>;
}
