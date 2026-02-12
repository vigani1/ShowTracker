import { Redirect } from "expo-router";
import { Platform } from "react-native";
import LandingPage from "./lp/landing";

export default function IndexScreen() {
  if (Platform.OS !== "web") {
    return <Redirect href="/login" />;
  }

  return <LandingPage />;
}
