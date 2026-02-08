import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

const baseClasses =
  "items-center justify-center rounded-full bg-brand-primary px-5 py-3";
const textClasses = "text-sm font-semibold text-white";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  className?: string;
  textClassName?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  disabled?: boolean;
};

export function Button({
  label,
  onPress,
  className,
  textClassName,
  leftIcon,
  rightIcon,
  disabled,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`${baseClasses} ${disabled ? "opacity-60" : ""} ${
        className ?? ""
      }`.trim()}
    >
      <View className="flex-row items-center justify-center gap-2">
        {leftIcon ? <View className="items-center">{leftIcon}</View> : null}
        <Text className={`${textClasses} ${textClassName ?? ""}`.trim()}>
          {label}
        </Text>
        {rightIcon ? <View className="items-center">{rightIcon}</View> : null}
      </View>
    </Pressable>
  );
}
