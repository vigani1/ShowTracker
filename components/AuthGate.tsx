import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { useConvexAuth } from "convex/react";

export function AuthGate({ children }: PropsWithChildren) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const isAuthRoute = pathname === "/login" || pathname === "/register";
    if (!isAuthenticated && !isAuthRoute) {
      router.replace("/login");
      return;
    }
    if (isAuthenticated && isAuthRoute) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return null;
  }

  return <>{children}</>;
}
