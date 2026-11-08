import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchRecognisedTerms, fetchSearchPage } from '@/features/search/api';
import {
  deriveNextSearchCursor,
  type SearchCursor,
  type SearchFilters,
  type SearchListing,
} from '@/features/search/search';

/** Divisible by 3, for the eventual 3-up Explore grid (ROADMAP 2.3). */
export const SEARCH_PAGE_SIZE = 24;

export const searchKeys = {
  all: ['search'] as const,
  list: (filters: SearchFilters) => [...searchKeys.all, 'list', filters] as const,
  recognise: (query: string) => [...searchKeys.all, 'recognise', query] as const,
};

/**
 * Paginated search results for the given filter/sort state.
 *
 * Passing the whole `filters` object (not a flattened tuple of its fields)
 * as part of the query key is deliberate — TanStack hashes query keys
 * structurally, so ANY change to any filter or to `sort` naturally produces
 * a different key, and a different key is exactly TanStack's own
 * pagination-reset mechanism (a fresh key starts its own fresh infinite
 * list, `initialPageParam` and all). Do NOT add manual "reset the cursor
 * when a filter changes" logic anywhere that calls this hook — there is
 * nothing to reset; the key shape already makes that a no-op concern. A
 * future reader should not "fix" this by flattening the key.
 *
 * The brand / attribute-term id lists (ROADMAP 7.4) are sorted and deduped
 * when the `SearchFilters` is built (`toSearchFilters`), so the same
 * selection made in a different order hashes to the same key and reuses the
 * same cache entry instead of refetching.
 */
export function useSearch(filters: SearchFilters) {
  return useInfiniteQuery({
    queryKey: searchKeys.list(filters),
    queryFn: ({ pageParam }: { pageParam: SearchCursor }) =>
      fetchSearchPage({ filters, cursor: pageParam, limit: SEARCH_PAGE_SIZE }),
    initialPageParam: null as SearchCursor,
    getNextPageParam: (lastPage: SearchListing[]) =>
      deriveNextSearchCursor(lastPage, SEARCH_PAGE_SIZE, filters.sort),
  });
}

/** Recognition depends only on the alias seed, which changes by migration. */
const RECOGNISE_STALE_TIME_MS = 60 * 60 * 1000;

/**
 * Query chips (ROADMAP 7.5b) for the given effective (debounced, trimmed)
 * query. Disabled for an empty query. No `placeholderData`: data is only
 * ever the response for THIS query, so a chip never offers a word from the
 * previous one. Errors are left to the caller, which shows nothing.
 */
export function useRecognisedTerms(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: searchKeys.recognise(trimmed),
    queryFn: () => fetchRecognisedTerms(trimmed),
    enabled: trimmed.length > 0,
    staleTime: RECOGNISE_STALE_TIME_MS,
  });
}
