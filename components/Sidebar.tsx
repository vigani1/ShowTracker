import { DESKTOP_SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH_COLLAPSED } from "@/constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

const navItems = [
  { href: "/home", label: "Home", icon: "home", iconOutline: "home-outline" },
  { href: "/discover", label: "Discover", icon: "compass", iconOutline: "compass-outline" },
  {
    href: "/recommendations",
    label: "For You",
    icon: "sparkles",
    iconOutline: "sparkles-outline",
  },
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
      {/* Red accent bar at top */}
      <View style={{ height: 3, backgroundColor: "#ef4444" }} />

      <View className="flex-1 px-2 py-4">
        {/* Logo */}
        <View className="mb-6 items-center justify-center">
          <Link href="/home" asChild>
            <Pressable className="h-10 w-10 items-center justify-center rounded-md border-2 border-primary bg-primary/20">
              <Text className="text-sm font-black text-primary">ST</Text>
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
                  className={`items-center justify-center rounded-lg px-2 py-3 ${isActive ? "border-l-2 border-primary bg-primary/15" : ""}`}
                >
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
            <Pressable className={`items-center justify-center rounded-lg px-2 py-3 ${pathname === "/search" ? "border-l-2 border-primary bg-primary/15" : ""}`}>
              <Feather name="search" size={20} color={pathname === "/search" ? "#ef4444" : "#a1a1aa"} />
              <Text className={`mt-1 text-[10px] font-medium tracking-tight ${pathname === "/search" ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                Search
              </Text>
            </Pressable>
          </Link>

          {/* Library */}
          <Link href="/library" asChild>
            <Pressable
              className={`items-center justify-center rounded-lg px-2 py-3 ${pathname === "/library" || pathname.startsWith("/library") ? "border-l-2 border-primary bg-primary/15" : ""}`}
            >
              <Ionicons
                name={(pathname === "/library" || pathname.startsWith("/library") ? "albums" : "albums-outline") as keyof typeof Ionicons.glyphMap}
                size={22}
                color={pathname === "/library" || pathname.startsWith("/library") ? "#ef4444" : "#a1a1aa"}
              />
              <Text
                className={`mt-1 text-[10px] font-medium tracking-tight ${pathname === "/library" || pathname.startsWith("/library") ? "text-text-primary" : "text-text-secondary"}`}
                numberOfLines={1}
              >
                Library
              </Text>
            </Pressable>
          </Link>

          {/* Profile */}
          <Link href="/profile" asChild>
            <Pressable
              className={`items-center justify-center rounded-lg px-2 py-3 ${pathname === "/profile" ? "border-l-2 border-primary bg-primary/15" : ""}`}
            >
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
