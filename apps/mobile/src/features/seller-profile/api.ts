import { createListingImageUrls } from '@/features/listings/api';
import { createAvatarUrls } from '@/features/profile/api';
import {
  associateSellerAvatarUrl,
  associateSellerListingCoverUrls,
  normalizeSellerListingRow,
  normalizeSellerProfileRow,
  type SellerListingRow,
  type SellerListingsPage,
  type SellerProfile,
  type SellerProfileRow,
} from '@/features/seller-profile/profile';
import { supabase } from '@/lib/supabase';

/**
 * Database access for the public seller profile.
 *
 * Two small, explicit queries, not one clever embedded one: `profiles` is
 * publicly readable ("Profiles are publicly readable", `using (true)`) and
 * entirely independent of listing visibility, so folding it into the
 * listings query would only make the listings query's own filters harder to
 * read for no round-trip savings.
 *
 * The listings query embeds exactly one (lowest-`position`) image per
 * listing via `.order(..., {referencedTable}).limit(1, {referencedTable})`
 * — the same per-embedded-table ordering/limit postgrest-js supports for
 * `listing_images` elsewhere — so a page of N listings costs exactly one
 * round trip for the rows plus one batched signed-URL call, never N+1.
 *
 * `status = 'active'` is filtered explicitly here even though the
 * "Active listings are public and sellers see own listings" RLS policy
 * would already hide another seller's non-active rows: that policy
 * deliberately lets an owner read every status of their OWN listings, and
 * this screen renders through the same code path regardless of whether the
 * viewer is the seller — so without the explicit filter, a seller viewing
 * their own public profile would see their drafts/reserved/sold/removed
 * inventory leak into what is supposed to be the buyer-facing view.
 */

export async function fetchSellerProfile(sellerId: string): Promise<SellerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path')
    .eq('id', sellerId)
    .maybeSingle();
  if (error) throw error;

  const normalized = normalizeSellerProfileRow(data as SellerProfileRow | null);
  if (normalized === null) {
    return null;
  }

  const urlsByPath = await createAvatarUrls(normalized.avatarPath ? [normalized.avatarPath] : []);
  return associateSellerAvatarUrl(normalized, urlsByPath);
}

export async function fetchSellerListingsPage(params: {
  sellerId: string;
  limit: number;
  offset: number;
}): Promise<SellerListingsPage> {
  const { sellerId, limit, offset } = params;

  const { data, error, count } = await supabase
    .from('listings')
    .select(
      `
      id,
      title,
      price_amount,
      currency,
      listing_images (
        storage_path,
        position
      )
    `,
      { count: 'exact' },
    )
    .eq('seller_id', sellerId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('position', { referencedTable: 'listing_images', ascending: true })
    .limit(1, { referencedTable: 'listing_images' })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const normalized = (data as SellerListingRow[]).map(normalizeSellerListingRow);
  if (normalized.length === 0) {
    return { listings: [], totalCount: count ?? 0 };
  }

  const urlsByPath = await createListingImageUrls(normalized.map((listing) => listing.coverStoragePath));
  const listings = associateSellerListingCoverUrls(normalized, urlsByPath);
  return { listings, totalCount: count ?? listings.length };
}
