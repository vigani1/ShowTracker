import { useEffect, useMemo, useRef } from "react";

type StableDisplayOptions<T> = {
  holdAcrossContext?: boolean;
  contextKey?: string;
  isLoading?: boolean;
  shouldHold?: (value: T) => boolean;
};

type StableDisplaySnapshot<T> = {
  contextKey?: string;
  value: T;
};

export function useStableDisplayValue<T>(
  value: T | null | undefined,
  options: StableDisplayOptions<T> = {}
): T | null | undefined {
  const {
    contextKey,
    holdAcrossContext = false,
    isLoading = false,
    shouldHold,
  } = options;
  const snapshotRef = useRef<StableDisplaySnapshot<T> | null>(null);
  const hasValue = value !== null && value !== undefined;
  const shouldHoldCurrentValue = hasValue && shouldHold ? shouldHold(value) : false;

  useEffect(() => {
    if (!hasValue || isLoading || shouldHoldCurrentValue) {
      return;
    }

    snapshotRef.current = {
      contextKey,
      value,
    };
  }, [contextKey, hasValue, isLoading, shouldHoldCurrentValue, value]);

  return useMemo(() => {
    const snapshot = snapshotRef.current;
    const canUseSnapshot =
      snapshot !== null &&
      (holdAcrossContext || snapshot.contextKey === contextKey);

    if (isLoading || shouldHoldCurrentValue) {
      if (canUseSnapshot) {
        return snapshot.value;
      }

      return shouldHoldCurrentValue ? undefined : value;
    }

    if (!hasValue) {
      return value;
    }

    return value;
  }, [
    contextKey,
    hasValue,
    holdAcrossContext,
    isLoading,
    shouldHoldCurrentValue,
    value,
  ]);
}

export function useStableCount(
  value: number | null | undefined,
  contextKey: string,
  isLoading: boolean
) {
  return useStableDisplayValue(value, {
    contextKey,
    isLoading,
    shouldHold: (count) => isLoading && count === 0,
  });
}

export type DisplayPair = {
  label: string;
  value: string;
  contextKey: string;
};

export function useStableDisplayPair(
  pair: DisplayPair | null | undefined,
  options: Omit<StableDisplayOptions<DisplayPair>, "contextKey"> = {}
) {
  return useStableDisplayValue(pair, {
    ...options,
    contextKey: pair?.contextKey,
    holdAcrossContext: true,
  });
}
