import { useQuery } from '@tanstack/react-query';

import { searchBrands } from '@/features/brands/api';
import { cleanBrandText, type BrandSuggestion } from '@/features/brands/brands';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

export const brandKeys = {
  all: ['brands'] as const,
  search: (query: string) => [...brandKeys.all, 'search', query] as const,
};

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Typeahead suggestions for the text being typed. Debounced so a fast typist
 * doesn't fire a request per keystroke. The query is cleaned and lowercased
 * ("Nike", " NIKE " and "nike" are one cache entry; the search itself ignores
 * case). Catalog changes only with migrations, so a few minutes of caching is
 * safe.
 *
 * Suggestions are returned only when they belong to what is typed RIGHT NOW:
 * while the debounce or the request is still catching up, the list is empty
 * rather than showing the previous query's results as if they matched. A
 * failed search also yields an empty list; the field still offers the typed
 * text as a custom brand, which the server links to a catalog brand if it
 * matches one.
 */
export function useBrandSearch(typed: string): BrandSuggestion[] {
  const settled = cleanBrandText(useDebouncedValue(typed, SEARCH_DEBOUNCE_MS)).toLowerCase();
  const current = cleanBrandText(typed).toLowerCase();

  const search = useQuery({
    queryKey: brandKeys.search(settled),
    queryFn: () => searchBrands(settled),
    enabled: settled !== '',
    staleTime: 5 * 60 * 1000,
  });

  return current !== '' && settled === current ? (search.data ?? []) : [];
}
