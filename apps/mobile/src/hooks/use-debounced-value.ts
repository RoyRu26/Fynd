import { useEffect, useState } from 'react';

/**
 * Debounces a changing value: the returned value only catches up to `value`
 * after it has stopped changing for `delayMs`. Generalizes the inline
 * `useState` + `useEffect`/`setTimeout` pattern `features/profile/availability.ts`'s
 * `useUsernameAvailability` already uses at a fixed 400ms, so a second
 * caller (ROADMAP 2.3's Explore search box) does not duplicate it inline.
 * `availability.ts` itself is left as-is for this change -- a flagged
 * follow-up, not refactored here.
 *
 * No debounced-value-specific invariant beyond "settle after quiet time", so
 * there is nothing to split into a separate pure module the way
 * `active-filters.ts` is -- the effect body IS the logic.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
