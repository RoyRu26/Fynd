import { createListingImageUrls } from '@/features/listings/api';
import {
  associateSavedListingCoverUrls,
  normalizeSavedListingRow,
  type SavedListingRow,
  type SavedListingsPage,
} from '@/features/saved-items/saved-items';
import { supabase } from '@/lib/supabase';

/**
 * Database access for the Saved Items grid (ROADMAP 1.8).
 *
 * One embedded-select query, not an RPC: `favorites` already grants
 * `select` to the owning user via RLS ("Users read own favorites"), and
 * `listings`' own "Active listings are public" policy already admits
 * exactly the rows this screen is allowed to show — there is no
 * server-side business rule here beyond what those two policies already
 * express, the same reasoning `seller-profile/api.ts`'s header gives for
 * its own two-query, no-RPC approach.
 *
 * `listings!inner(...)` plus `.eq('listings.status', 'active')` is load-
 * bearing, not decorative: a plain (non-`!inner`) embed would leave
 * `listings: null` for a favorite pointing at a sold/removed listing
 * rather than excluding the row, which would either crash the normalizer
 * or require a null-check this screen has no good fallback for. The
 * `!inner` join makes the status filter apply to the FAVORITES row itself
 * — a sold or removed favorite drops out of the page entirely, silently,
 * rather than surfacing a tile that leads to listing-detail's existing
 * "not available" dead end for a non-owner. Verified empirically against
 * the local stack (not just read from PostgREST's docs): a favorite
 * pointing at a `sold` listing is absent from the result when this filter
 * is applied, present when it isn't.
 *
 * Exactly one (lowest-`position`) image per listing is embedded via the
 * same `.order(..., {referencedTable}).limit(1, {referencedTable})`
 * postgrest-js pattern `seller-profile/api.ts` already uses, so a page of
 * N saved listings costs one round trip for the rows plus one batched
 * signed-URL call, never N+1.
 */
export async function fetchSavedListingsPage(params: {
  userId: string;
  limit: number;
  offset: number;
}): Promise<SavedListingsPage> {
  const { userId, limit, offset } = params;

  const { data, error, count } = await supabase
    .from('favorites')
    .select(
      `
      listings!inner (
        id,
        title,
        price_amount,
        currency,
        listing_images (
          storage_path,
          position
        )
      )
    `,
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .eq('listings.status', 'active')
    .order('created_at', { ascending: false })
    .order('position', { referencedTable: 'listings.listing_images', ascending: true })
    .limit(1, { referencedTable: 'listings.listing_images' })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data as { listings: SavedListingRow }[]).map((row) => row.listings);
  const normalized = rows.map(normalizeSavedListingRow);
  if (normalized.length === 0) {
    return { listings: [], totalCount: count ?? 0 };
  }

  const urlsByPath = await createListingImageUrls(normalized.map((listing) => listing.coverStoragePath));
  const listings = associateSavedListingCoverUrls(normalized, urlsByPath);
  return { listings, totalCount: count ?? listings.length };
}
