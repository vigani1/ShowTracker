import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Card } from "@/components/Card";
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
      <View className="pb-4">
        <Text className="mb-1 text-3xl font-extrabold tracking-[-0.5px] text-text-primary">
          Profile
        </Text>
        <Text className="mb-6 text-sm text-text-secondary">
          Settings and preferences
        </Text>

        {/* User avatar */}
        <View className="mb-6 items-center">
          <View className="h-20 w-20 items-center justify-center rounded-full border-2 border-primary bg-bg-elevated">
            <Ionicons name="person" size={36} color="#fafafa" />
          </View>
          <Text className="mt-3 text-lg font-bold text-text-primary">
            {isAuthenticated ? "Signed In" : "Not Signed In"}
          </Text>
          <Text className="text-sm text-text-secondary">
            {isAuthenticated ? "Synced with Convex" : "Not authenticated"}
          </Text>
        </View>

        {/* Account */}
        <Card className="mb-4 p-4">
          <Text className="text-lg font-bold text-text-primary">
            Account
          </Text>
          <Text className="mt-1 text-sm leading-relaxed text-text-secondary">
            {isAuthenticated
              ? "Signed in and synced with Convex."
              : "Not authenticated."}
          </Text>
        </Card>

        <Pressable
          onPress={handleSignOut}
          disabled={!isAuthenticated || isSigningOut}
          style={{
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(239,68,68,0.1)",
            borderWidth: 1,
            borderColor: "rgba(239,68,68,0.3)",
            opacity: !isAuthenticated || isSigningOut ? 0.5 : 1,
          }}
        >
          <Text style={{ color: "#ef4444", fontSize: 14, fontWeight: "600" }}>
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Text>
        </Pressable>

        {signOutError ? (
          <Text className="mt-3 text-sm text-primary">{signOutError}</Text>
        ) : null}
      </View>
    </ScreenWrapper>
  );
}
