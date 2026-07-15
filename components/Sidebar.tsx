import { DESKTOP_SIDEBAR_BREAKPOINT, SIDEBAR_WIDTH_COLLAPSED } from "@/constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Image, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

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
  const isLibraryActive =
    pathname === "/library" || pathname.startsWith("/library");
  const isProfileActive =
    pathname === "/profile" || pathname.startsWith("/profile/");

  return (
    <View
      className="border-r border-border-default bg-bg-surface/95"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      <View className="flex-1 px-2 py-4">
        {/* Logo */}
        <View className="mb-6 items-center justify-center">
          <Link href="/home" asChild>
            <Pressable className="h-10 w-10 items-center justify-center overflow-hidden">
              <Image
                source={require("../assets/showtracker-mark.png")}
                resizeMode="contain"
                style={{ width: 40, height: 28 }}
              />
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
                  className={`relative items-center justify-center rounded-lg px-2 py-2.5 ${isActive ? "bg-bg-elevated" : ""}`}
                >
                  {isActive ? <View className="absolute right-0 h-6 w-1 rounded-l-full bg-primary" /> : null}
                  <View className={`h-8 w-8 items-center justify-center rounded-md ${isActive ? "bg-primary/15" : ""}`}>
                    <Ionicons
                      name={(isActive ? item.icon : item.iconOutline) as keyof typeof Ionicons.glyphMap}
                      size={21}
                      color={isActive ? "#ef4444" : "#a1a1aa"}
                    />
                  </View>
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
            <Pressable className={`relative items-center justify-center rounded-lg px-2 py-2.5 ${pathname === "/search" ? "bg-bg-elevated" : ""}`}>
              {pathname === "/search" ? <View className="absolute right-0 h-6 w-1 rounded-l-full bg-primary" /> : null}
              <View className={`h-8 w-8 items-center justify-center rounded-md ${pathname === "/search" ? "bg-primary/15" : ""}`}>
                <Feather name="search" size={20} color={pathname === "/search" ? "#ef4444" : "#a1a1aa"} />
              </View>
              <Text className={`mt-1 text-[10px] font-medium tracking-tight ${pathname === "/search" ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                Search
              </Text>
            </Pressable>
          </Link>

          {/* Library */}
          <Link href="/library" asChild>
            <Pressable
              className={`relative items-center justify-center rounded-lg px-2 py-2.5 ${isLibraryActive ? "bg-bg-elevated" : ""}`}
            >
              {isLibraryActive ? <View className="absolute right-0 h-6 w-1 rounded-l-full bg-primary" /> : null}
              <View className={`h-8 w-8 items-center justify-center rounded-md ${isLibraryActive ? "bg-primary/15" : ""}`}>
                <Ionicons
                  name={(isLibraryActive ? "albums" : "albums-outline") as keyof typeof Ionicons.glyphMap}
                  size={21}
                  color={isLibraryActive ? "#ef4444" : "#a1a1aa"}
                />
              </View>
              <Text
                className={`mt-1 text-[10px] font-medium tracking-tight ${isLibraryActive ? "text-text-primary" : "text-text-secondary"}`}
                numberOfLines={1}
              >
                Library
              </Text>
            </Pressable>
          </Link>

          {/* Profile */}
          <Link href="/profile" asChild>
            <Pressable
              className={`relative items-center justify-center rounded-lg px-2 py-2.5 ${isProfileActive ? "bg-bg-elevated" : ""}`}
            >
              {isProfileActive ? <View className="absolute right-0 h-6 w-1 rounded-l-full bg-primary" /> : null}
              <View className={`h-8 w-8 items-center justify-center rounded-md ${isProfileActive ? "bg-primary/15" : ""}`}>
                <Ionicons name={isProfileActive ? "person" : "person-outline"} size={18} color={isProfileActive ? "#ef4444" : "#a1a1aa"} />
              </View>
              <Text className={`mt-1 text-[10px] font-medium tracking-tight ${isProfileActive ? "text-text-primary" : "text-text-secondary"}`} numberOfLines={1}>
                Profile
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}
