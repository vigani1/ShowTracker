import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

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
      <Text className={`${textClasses} ${textClassName ?? ""}`.trim()}>
        {leftIcon}
        {label}
        {rightIcon}
      </Text>
    </Pressable>
  );
}
