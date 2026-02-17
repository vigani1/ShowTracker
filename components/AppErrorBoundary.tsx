import { Ionicons } from "@expo/vector-icons";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

const CONVEX_LIMIT_MARKERS = [
  "exceeded the free plan limits",
  "deployments have been disabled",
];

function extractErrorMessage(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isConvexLimitError(message: string) {
  const normalized = message.toLowerCase();
  return CONVEX_LIMIT_MARKERS.some((marker) => normalized.includes(marker));
}

type AppErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type AppErrorBoundaryState = {
  error: unknown;
};

class AppErrorBoundaryInternal extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary] Caught render error", error, errorInfo.componentStack);
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    const rawMessage = extractErrorMessage(this.state.error);
    const convexLimitHit = isConvexLimitError(rawMessage);

    const title = convexLimitHit
      ? "Backend Temporarily Unavailable"
      : "Something Went Wrong";

    const body = convexLimitHit
      ? "This Convex deployment is disabled because free plan limits were exceeded. Upgrade/re-enable the deployment, then retry."
      : "An unexpected error occurred while rendering this screen. Retry or reload the app.";

    return (
      <View className="flex-1 items-center justify-center bg-bg-base px-5 py-8">
        <View className="w-full max-w-xl rounded-2xl border-2 border-border-bright bg-bg-surface p-5">
          <View className="mb-4 flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
              <Ionicons
                name={convexLimitHit ? "server-outline" : "warning-outline"}
                size={20}
                color="#ef4444"
              />
            </View>
            <Text
              className="text-xl text-text-primary"
              style={{ fontFamily: "Courier New", fontWeight: "900" }}
            >
              {title}
            </Text>
          </View>

          <Text className="text-sm leading-6 text-text-secondary">{body}</Text>

          {convexLimitHit ? (
            <Text className="mt-2 text-xs text-text-muted">
              Please contact ShowTracker support to restore backend availability.
            </Text>
          ) : null}

          <View className="mt-5 flex-row gap-2">
            <Pressable
              onPress={this.handleRetry}
              className="flex-1 items-center justify-center rounded-lg border-2 border-primary bg-primary py-2.5"
            >
              <Text className="text-sm font-black uppercase tracking-wide text-white">Retry</Text>
            </Pressable>

            {Platform.OS === "web" ? (
              <Pressable
                onPress={this.handleReload}
                className="flex-1 items-center justify-center rounded-lg border-2 border-border-default bg-bg-elevated py-2.5"
              >
                <Text className="text-sm font-bold uppercase tracking-wide text-text-primary">
                  Reload
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text className="mt-4 text-xs text-text-muted" numberOfLines={3}>
            {__DEV__ ? rawMessage : "An unexpected error occurred."}
          </Text>
        </View>
      </View>
    );
  }
}

export function AppErrorBoundary(props: AppErrorBoundaryProps) {
  return (
    <AppErrorBoundaryInternal {...props}>{props.children}</AppErrorBoundaryInternal>
  );
}
