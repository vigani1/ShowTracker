import { DESKTOP_SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH_COLLAPSED } from "@/constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

const navItems = [
  { href: "/home", label: "Home", icon: "home", iconOutline: "home-outline" },
  { href: "/discover", label: "Discover", icon: "compass", iconOutline: "compass-outline" },
  { href: "/library", label: "Library", icon: "albums", iconOutline: "albums-outline" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_SIDEBAR_BREAKPOINT;

  if (!isDesktop) return null;

  const sidebarWidth = SIDEBAR_WIDTH_COLLAPSED;

  return (
    <View
      className="border-r border-border-default bg-bg-surface/95"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      <View className="flex-1 px-2 py-4">
        {/* Logo */}
        <View className="mb-6 items-center justify-center">
          <Link href="/home" asChild>
            <Pressable className="items-center justify-center">
              <Text className="text-lg font-extrabold tracking-tight text-text-primary">ST</Text>
            </Pressable>
          </Link>
        </View>

        {/* Nav items - icon above label */}
        <View className="gap-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/home" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href as any} asChild>
                <Pressable
                  className={`items-center justify-center rounded-lg px-2 py-3 ${isActive ? "bg-primary/15" : ""}`}
                  style={{ position: "relative" }}
                >
                  {isActive ? (
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "25%",
                        bottom: "25%",
                        width: 3,
                        borderRadius: 2,
                        backgroundColor: "#ef4444",
                      }}
                    />
                  ) : null}
                  <Ionicons
                    name={(isActive ? item.icon : item.iconOutline) as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={isActive ? "#ef4444" : "#a1a1aa"}
                  />
                  <Text
                    className={`mt-1 text-[10px] font-medium tracking-tight ${isActive ? "text-text-primary" : "text-text-secondary"}`}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              </Link>
            );
          })}
        </View>

        <View className="flex-1" />

        {/* Bottom section - Search + Profile */}
        <View className="border-t border-border-default pt-3">
          {/* Search */}
          <Link href="/search" asChild>
            <Pressable className={`items-center justify-center rounded-lg px-2 py-3`} style={{ position: "relative" }}>
              <Feather name="search" size={20} color={pathname === "/search" ? "#ef4444" : "#a1a1aa"} />
              <Text className={`mt-1 text-[10px] font-medium tracking-tight ${pathname === "/search" ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                Search
              </Text>
            </Pressable>
          </Link>

          {/* Profile */}
          <Link href="/profile" asChild>
            <Pressable
              className={`items-center justify-center rounded-lg px-2 py-3 ${pathname === "/profile" ? "bg-primary/15" : ""}`}
              style={{ position: "relative" }}
            >
              {pathname === "/profile" ? (
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "25%",
                    bottom: "25%",
                    width: 3,
                    borderRadius: 2,
                    backgroundColor: "#ef4444",
                  }}
                />
              ) : null}
              <View className="h-7 w-7 items-center justify-center rounded-full bg-bg-elevated">
                <Ionicons name="person" size={16} color={pathname === "/profile" ? "#ef4444" : "#a1a1aa"} />
              </View>
              <Text className={`mt-1 text-[10px] font-medium tracking-tight ${pathname === "/profile" ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                Profile
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}
