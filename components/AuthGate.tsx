import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useConvexAuth } from "convex/react";

export function AuthGate({ children }: PropsWithChildren) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const inAuthGroup = segments[0] === "(auth)";
    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/login");
      return;
    }
    if (isAuthenticated && inAuthGroup) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, router, segments]);

  if (isLoading) {
    return null;
  }

  return <>{children}</>;
}
