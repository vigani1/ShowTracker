import {
  DESKTOP_SIDEBAR_BREAKPOINT,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "@/constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const navItems = [
  { href: "/", label: "Home", icon: "home", iconOutline: "home-outline" },
  { href: "/discover", label: "Discover", icon: "compass", iconOutline: "compass-outline" },
  { href: "/search", label: "Search", icon: "search", iconOutline: "search" },
  { href: "/watchlist", label: "Watchlist", icon: "list", iconOutline: "list-outline" },
  { href: "/schedule", label: "Schedule", icon: "calendar", iconOutline: "calendar-outline" },
] as const;

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;
  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  if (!isDesktop) return null;

  return (
    <View
      className="border-r border-border-default bg-bg-surface/95"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      <View className="flex-1 px-3 py-4">
        {/* Logo + collapse toggle */}
        <View className="mb-6 flex-row items-center justify-between">
          {collapsed ? (
            <Pressable onPress={onToggleCollapsed} className="w-full items-center rounded-lg py-1">
              <Ionicons name="chevron-forward" size={18} color="#a1a1aa" />
            </Pressable>
          ) : (
            <>
              <Link href="/" asChild>
                <Pressable className="flex-1">
                  <Text className="text-lg font-extrabold tracking-tight text-text-primary">ShowTracker</Text>
                </Pressable>
              </Link>
              <Pressable
                onPress={onToggleCollapsed}
                className="items-center justify-center rounded-lg"
                style={{ width: 28, height: 28, backgroundColor: "rgba(63,63,70,0.3)" }}
              >
                <Ionicons name="chevron-back" size={16} color="#a1a1aa" />
              </Pressable>
            </>
          )}
        </View>

        {/* Nav items */}
        <View className="gap-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href as "/"} asChild>
                <Pressable
                  className={`flex-row items-center gap-3 rounded-lg px-3 py-2.5 ${isActive ? "bg-primary/15" : ""}`}
                  style={{ position: "relative" }}
                >
                  {isActive ? (
                    <View style={{ position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3, borderRadius: 2, backgroundColor: "#ef4444" }} />
                  ) : null}
                  <View>
                    {item.icon === "search" ? (
                      <Feather name="search" size={20} color={isActive ? "#ef4444" : "#a1a1aa"} />
                    ) : (
                      <Ionicons
                        name={(isActive ? item.icon : item.iconOutline) as keyof typeof Ionicons.glyphMap}
                        size={22}
                        color={isActive ? "#ef4444" : "#a1a1aa"}
                      />
                    )}
                  </View>
                  {!collapsed ? (
                    <Text className={`text-sm font-medium ${isActive ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                      {item.label}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
            );
          })}
        </View>

        <View className="flex-1" />

        {/* User section */}
        <View className="border-t border-border-default pt-3">
          <Link href="/profile" asChild>
            <Pressable className="flex-row items-center gap-3 rounded-lg px-3 py-2">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-bg-elevated">
                <Ionicons name="person" size={18} color="#a1a1aa" />
              </View>
              {!collapsed ? (
                <Text className="flex-1 text-sm font-medium text-text-secondary" numberOfLines={1}>Profile</Text>
              ) : null}
            </Pressable>
          </Link>
        </View>

      </View>
    </View>
  );
}
