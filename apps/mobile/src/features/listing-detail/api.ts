import { createListingImageUrls } from '@/features/listings/api';
import { createAvatarUrls } from '@/features/profile/api';
import {
  associateListingDetailImageUrls,
  associateListingDetailSellerAvatarUrl,
  normalizeListingDetailRow,
  type ListingDetail,
  type ListingDetailRow,
} from '@/features/listing-detail/detail';
import { supabase } from '@/lib/supabase';

/**
 * Database access for the listing detail screen.
 *
 * One query, not several: `listings` already carries a direct FK to
 * `profiles` (seller) and is the FK *target* of both `listing_images` and
 * `favorites`, so PostgREST can embed the seller, every ordered image, and
 * the caller's own favorite row (if any) in a single round trip — avoiding
 * N+1 without a new RPC or a schema change. `favorites`' own RLS ("Users
 * read own favorites") is what makes that last embed return only the
 * caller's row regardless of whose listing this is: its mere presence (0 or
 * 1 rows, since (user_id, listing_id) is the table's own primary key) is
 * "did I favorite this," for free.
 *
 * The `listings` SELECT policy ("Active listings are public and sellers see
 * own listings") is what makes this safe to call for ANY listing id: a
 * draft or removed listing belonging to someone else simply returns no row,
 * which `normalizeListingDetailRow` already treats as "not found" — no
 * client-side ownership check needed before the query runs.
 */
export async function fetchListingDetail(listingId: string): Promise<ListingDetail | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(
      `
      id,
      title,
      description,
      price_amount,
      currency,
      condition,
      size,
      status,
      seller_id,
      profiles (
        username,
        display_name,
        avatar_path
      ),
      listing_images (
        id,
        storage_path,
        position
      ),
      favorites (
        user_id
      )
    `,
    )
    .eq('id', listingId)
    .order('position', { referencedTable: 'listing_images', ascending: true })
    .maybeSingle();
  if (error) throw error;

  const normalized = normalizeListingDetailRow(data as ListingDetailRow | null);
  if (normalized === null) {
    return null;
  }

  // Both signed-URL requests are independent (different buckets, different
  // paths), so they run in parallel rather than serializing one behind the
  // other.
  const [imageUrlsByPath, avatarUrlsByPath] = await Promise.all([
    createListingImageUrls(normalized.images.map((image) => image.storagePath)),
    createAvatarUrls(normalized.sellerAvatarPath ? [normalized.sellerAvatarPath] : []),
  ]);

  const withImages =
    normalized.images.length === 0
      ? { ...normalized, images: [] }
      : associateListingDetailImageUrls(normalized, imageUrlsByPath);

  return associateListingDetailSellerAvatarUrl(withImages, avatarUrlsByPath);
}
