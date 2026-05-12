import { useMemo } from "react";
import { PanResponder } from "react-native";

type UseHorizontalSectionSwipeOptions<T extends string> = {
  value: T;
  values: readonly T[];
  onValueChange: (value: T) => void;
  enabled?: boolean;
};

const MIN_SWIPE_DISTANCE = 64;
const DIRECTION_LOCK_RATIO = 1.35;

export function useHorizontalSectionSwipe<T extends string>({
  value,
  values,
  onValueChange,
  enabled = true,
}: UseHorizontalSectionSwipeOptions<T>) {
  const isEnabled = enabled && values.length > 1;

  return useMemo(() => {
    if (!isEnabled) {
      return {};
    }

    const panResponder = PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const absDx = Math.abs(gestureState.dx);
        const absDy = Math.abs(gestureState.dy);
        return (
          absDx > 16 &&
          absDx > absDy * DIRECTION_LOCK_RATIO
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) < MIN_SWIPE_DISTANCE) {
          return;
        }

        const currentIndex = values.indexOf(value);
        if (currentIndex < 0) {
          return;
        }

        const nextIndex =
          gestureState.dx < 0
            ? Math.min(currentIndex + 1, values.length - 1)
            : Math.max(currentIndex - 1, 0);

        const nextValue = values[nextIndex];
        if (nextValue !== value) {
          onValueChange(nextValue);
        }
      },
    });

    return panResponder.panHandlers;
  }, [isEnabled, onValueChange, value, values]);
}
