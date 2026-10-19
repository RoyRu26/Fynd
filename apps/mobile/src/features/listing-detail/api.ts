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
 * `profiles` (seller) and `categories`, and is the FK *target* of both
 * `listing_images` and `favorites`, so PostgREST can embed the seller,
 * category (with its own parent), every ordered image, and the caller's own
 * favorite row (if any) in a single round trip — avoiding N+1 without a new
 * RPC or a schema change. `favorites`' own RLS ("Users read own favorites")
 * is what makes that last embed return only the caller's row regardless of
 * whose listing this is: its mere presence (0 or 1 rows, since (user_id,
 * listing_id) is the table's own primary key) is "did I favorite this," for
 * free.
 *
 * The `listings` SELECT policy ("Active listings are public and sellers see
 * own listings") is what makes this safe to call for ANY listing id: a
 * draft or removed listing belonging to someone else simply returns no row,
 * which `normalizeListingDetailRow` already treats as "not found" — no
 * client-side ownership check needed before the query runs.
 *
 * ============================================================
 * The category self-join's exact shape (verified empirically, not assumed)
 * ============================================================
 * `categories` self-references via `parent_id` (categories_parent_id_fkey),
 * so embedding a listing's category AND that category's own parent needs
 * PostgREST to disambiguate a self-join twice over: once for
 * listings -> categories (two listings FKs exist in principle, though only
 * one today), and again for categories -> categories.
 *
 * The naturally-reached-for hint syntax for the inner self-join --
 * `parent:categories!categories_parent_id_fkey(id, name)`, mirroring the
 * outer `categories!listings_category_id_fkey` -- does NOT resolve: tested
 * directly against this local stack (inserting a throwaway fixture and
 * calling the REST endpoint), it comes back `PGRST200 "Could not find a
 * relationship between 'categories' and 'categories'"` every time the hint
 * repeats the table name, with OR without the constraint-name form.
 *
 * What DOES work is hinting by the bare COLUMN name only, with no table
 * name prefix at all: `parent:parent_id(id, name)`. That resolves to the
 * correct many-to-one direction (the leaf's parent, a single object) --
 * confirmed against both a leaf (parent populated) and a top-level row
 * (parent: null) via direct REST calls before this was relied upon here.
 * `categories!parent_id(id, name)` (table name + column-name hint together)
 * was also tried and silently resolves to the WRONG direction (the
 * one-to-many "children" list, coming back empty for a leaf) -- so the
 * table-name prefix must be omitted entirely for the inner embed, which is
 * why it looks inconsistent with the outer one below.
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
      categories!listings_category_id_fkey (
        id,
        name,
        parent:parent_id (
          id,
          name
        )
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
