import { useCallback, useEffect, useRef, useState } from 'react';

import { addRecentSearch, removeRecentSearch } from '@/features/search/recent-searches';
import { loadRecentSearches, saveRecentSearches } from '@/features/search/recent-searches-storage';

/**
 * Device-local recent-searches state for ROADMAP 2.4's Explore search box.
 *
 * Deliberately NOT a TanStack Query hook — this is local device state (no
 * server round trip, no cache to invalidate), the same reasoning that keeps
 * `use-debounced-value.ts` a plain hook. Pure wiring over the already-tested
 * `recent-searches.ts` logic and the storage module, so — like every other
 * untested `queries.ts` hook in this codebase — this has no `.test.ts`.
 */
export function useRecentSearches() {
  const [items, setItems] = useState<string[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadRecentSearches().then((loaded) => {
      if (mountedRef.current) {
        setItems(loaded);
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable identities: callers (explore.tsx) memoize their own callbacks
  // against `record`/`remove`/`clear`, which only works if these don't get
  // a new identity every render of this hook's caller.
  const record = useCallback((query: string) => {
    setItems((prev) => {
      const next = addRecentSearch(prev, query);
      saveRecentSearches(next);
      return next;
    });
  }, []);

  const remove = useCallback((query: string) => {
    setItems((prev) => {
      const next = removeRecentSearch(prev, query);
      saveRecentSearches(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    saveRecentSearches([]);
  }, []);

  return { items, record, remove, clear };
}
