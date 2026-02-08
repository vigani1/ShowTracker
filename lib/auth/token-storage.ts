import type { TokenStorage } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function getWebStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export const tokenStorage: TokenStorage = {
  async getItem(key) {
    if (Platform.OS === "web") {
      return getWebStorage()?.getItem(key) ?? null;
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error("SecureStore getItem failed", error);
      return null;
    }
  },
  async setItem(key, value) {
    if (Platform.OS === "web") {
      getWebStorage()?.setItem(key, value);
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error("SecureStore setItem failed", error);
    }
  },
  async removeItem(key) {
    if (Platform.OS === "web") {
      getWebStorage()?.removeItem(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error("SecureStore removeItem failed", error);
    }
  },
};
