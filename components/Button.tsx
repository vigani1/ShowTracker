import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  className?: string;
  textClassName?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  disabled?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary border-2 border-primary px-5 py-3",
  secondary: "rounded-lg px-5 py-3 border-2 border-border-bright",
  ghost: "rounded-lg px-5 py-3",
};

const variantTextClasses: Record<ButtonVariant, string> = {
  primary: "text-white font-black text-sm uppercase tracking-wide",
  secondary: "text-text-primary font-bold text-sm",
  ghost: "text-primary font-bold text-sm",
};

export function Button({
  label,
  onPress,
  variant = "primary",
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
      accessibilityRole="button"
      className={`items-center justify-center ${variantClasses[variant]} ${
        disabled ? "opacity-50" : ""
      } ${className ?? ""}`.trim()}
      style={({ pressed }) =>
        pressed && !disabled
          ? { opacity: 0.9, transform: [{ scale: 0.98 }] }
          : undefined
      }
    >
      <View className="flex-row items-center justify-center gap-2">
        {leftIcon ? <View className="items-center">{leftIcon}</View> : null}
        <Text className={`${variantTextClasses[variant]} ${textClassName ?? ""}`.trim()}>
          {label}
        </Text>
        {rightIcon ? <View className="items-center">{rightIcon}</View> : null}
      </View>
    </Pressable>
  );
}
