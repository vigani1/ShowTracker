import { useState } from "react";
import { Text, View } from "react-native";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/Button";
import { ScreenWrapper } from "@/components/ScreenWrapper";

export default function ProfileScreen() {
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out failed", error);
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <ScreenWrapper>
      <View className="gap-3">
        <Text className="text-2xl font-semibold text-brand-light-text dark:text-brand-text">
          Profile
        </Text>
        <Text className="text-base text-slate-600 dark:text-slate-400">
          Stats, settings, and theme toggle.
        </Text>
        <View className="rounded-2xl border border-brand-surface/40 bg-brand-light-surface p-4 dark:border-brand-surface dark:bg-brand-surface/60">
          <Text className="text-sm text-brand-light-text dark:text-brand-text">
            User stats and settings components will live here.
          </Text>
        </View>
        <Button
          label={isSigningOut ? "Signing out..." : "Sign out"}
          onPress={handleSignOut}
          disabled={!isAuthenticated || isSigningOut}
        />
        {signOutError ? (
          <Text className="text-sm text-red-500 dark:text-red-400">
            {signOutError}
          </Text>
        ) : null}
      </View>
    </ScreenWrapper>
  );
}
