import { router, type Href } from "expo-router";
import { HeaderIconButton } from "@/components/HeaderIconButton";

type AppBackButtonProps = {
  fallbackHref?: Href;
  className?: string;
};

export function AppBackButton({
  fallbackHref = "/home",
  className,
}: AppBackButtonProps) {
  const handlePress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackHref);
  };

  return (
    <HeaderIconButton
      icon="chevron-back"
      accessibilityLabel="Go back"
      onPress={handlePress}
      className={className}
    />
  );
}
