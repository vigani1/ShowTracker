import { router, type Href } from "expo-router";
import { HeaderIconButton } from "@/components/HeaderIconButton";

type AppBackButtonProps = {
  fallbackHref?: Href;
  className?: string;
  variant?: "back" | "close";
};

export function AppBackButton({
  fallbackHref = "/home",
  className,
  variant = "back",
}: AppBackButtonProps) {
  const handlePress = () => {
    if (variant === "close" && router.canDismiss()) {
      router.dismiss();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackHref);
  };

  return (
    <HeaderIconButton
      icon={variant === "close" ? "close" : "chevron-back"}
      accessibilityLabel={variant === "close" ? "Close details" : "Go back"}
      onPress={handlePress}
      className={className}
    />
  );
}
