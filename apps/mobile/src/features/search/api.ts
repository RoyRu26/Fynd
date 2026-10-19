import { createListingImageUrls } from '@/features/listings/api';
import {
  associateSearchCoverUrls,
  buildSearchParams,
  normalizeSearchRow,
  type SearchCursor,
  type SearchFilters,
  type SearchListing,
} from '@/features/search/search';
import { supabase } from '@/lib/supabase';

export type { SearchCursor, SearchFilters, SearchListing } from '@/features/search/search';

/**
 * Database access for ROADMAP 2.2 "Search backend".
 *
 * The privilege model this layer respects, enforced server-side:
 *
 *   * `search_listings` is `SECURITY INVOKER` — it only ever returns
 *     `status = 'active'` rows, the exact set RLS already lets every
 *     authenticated caller read. There is no personalization (no
 *     `is_favorited`, no own-listing exclusion) for this layer to account
 *     for — unlike feed/api.ts's `fetchFeedPage`.
 *   * Cover images come back as a `storage_path`, never a public URL — the
 *     bucket is private, so rendering one requires a signed URL.
 */

/**
 * One search results page: the `search_listings` RPC, then exactly one
 * batched signed-URL request covering every cover photo in the page. Never
 * N+1 — mirrors feed/api.ts's `fetchFeedPage` flow exactly, minus the
 * avatar-signing step that page needs and this one does not (no seller
 * identity is surfaced here).
 */
export async function fetchSearchPage(params: {
  filters: SearchFilters;
  cursor: SearchCursor;
  limit: number;
}): Promise<SearchListing[]> {
  const { filters, cursor, limit } = params;

  const { data, error } = await supabase.rpc('search_listings', buildSearchParams(filters, cursor, limit));
  if (error) throw error;

  const rows = data.map(normalizeSearchRow);
  if (rows.length === 0) {
    return [];
  }

  const coverUrlsByPath = await createListingImageUrls(rows.map((row) => row.coverStoragePath));
  return associateSearchCoverUrls(rows, coverUrlsByPath);
}
