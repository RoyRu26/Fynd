import type { Enums } from '@/types/database';

/**
 * Pure listing-detail logic: row normalization and the detail screen's own
 * favorite-cache patch.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase` — matching the same split feed/pagination.ts uses for the
 * same reason: it's what makes this directly unit-testable.
 */

export type ListingDetailImage = {
  id: string;
  storagePath: string;
};

/** The single embedded-select query's row shape — see api.ts. */
export type ListingDetailRow = {
  id: string;
  title: string | null;
  description: string;
  price_amount: number | null;
  currency: string;
  condition: Enums<'listing_condition'> | null;
  size: Enums<'listing_size'> | null;
  status: Enums<'listing_status'>;
  seller_id: string;
  profiles: {
    username: string | null;
    display_name: string | null;
    avatar_path: string | null;
  } | null;
  listing_images: { id: string; storage_path: string; position: number }[];
  favorites: { user_id: string }[];
};

export type NormalizedListingDetail = {
  listingId: string;
  title: string;
  description: string;
  priceAmount: number;
  currency: string;
  condition: Enums<'listing_condition'>;
  size: Enums<'listing_size'>;
  sellerId: string;
  sellerUsername: string | null;
  sellerDisplayName: string | null;
  sellerAvatarPath: string | null;
  images: ListingDetailImage[];
  isFavorited: boolean;
};

/** The normalized detail plus each image's resolved signed URL — see api.ts. */
export type ListingDetail = Omit<NormalizedListingDetail, 'images'> & {
  images: (ListingDetailImage & { url: string })[];
};

/**
 * Row -> domain, or `null` when this isn't a viewable detail page.
 *
 * `null` covers two cases identically, on purpose:
 *   - RLS returned no row at all: not found, someone else's draft/removed
 *     listing, or a bad id.
 *   - A row DID come back but `status !== 'active'` (reserved/sold/removed,
 *     or even the caller's own draft — the "Active listings are public and
 *     sellers see own listings" RLS policy lets an owner read every status
 *     of their own listing, but this screen is "view a published listing,"
 *     not a status-aware owner view).
 *
 * Both must read as "unavailable," never as a flash of title/price/photos
 * right before disappearing — which is also why this never substitutes a
 * default for a null title/price/condition/size instead of throwing: those
 * columns are nullable only to support drafts, and
 * `listings_complete_when_not_draft` guarantees every non-draft row (which
 * 'active' always is) has all four. A null here would mean the constraint
 * itself had been violated, not that a default is owed.
 */
export function normalizeListingDetailRow(
  row: ListingDetailRow | null,
): NormalizedListingDetail | null {
  if (row === null || row.status !== 'active') {
    return null;
  }
  if (row.title === null || row.price_amount === null || row.condition === null || row.size === null) {
    throw new Error(`Listing ${row.id} is active but missing a required field`);
  }

  const images = [...row.listing_images]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({ id: image.id, storagePath: image.storage_path }));

  return {
    listingId: row.id,
    title: row.title,
    description: row.description,
    priceAmount: row.price_amount,
    currency: row.currency,
    condition: row.condition,
    size: row.size,
    sellerId: row.seller_id,
    sellerUsername: row.profiles?.username ?? null,
    sellerDisplayName: row.profiles?.display_name ?? null,
    sellerAvatarPath: row.profiles?.avatar_path ?? null,
    images,
    // The `favorites` embed is RLS-scoped to the caller's own row (`user_id
    // = auth.uid()`), so its mere presence — regardless of whose listing
    // this is — means "I favorited this." At most one row, by the table's
    // own (user_id, listing_id) primary key.
    isFavorited: row.favorites.length > 0,
  };
}

/**
 * Attaches each image's resolved signed URL. Throws rather than returning a
 * detail page with a broken photo — same reasoning as feed/pagination.ts's
 * `associateCoverUrls`.
 */
export function associateListingDetailImageUrls(
  detail: NormalizedListingDetail,
  urlsByPath: Record<string, string>,
): ListingDetail {
  const images = detail.images.map((image) => {
    const url = urlsByPath[image.storagePath];
    if (!url) {
      throw new Error(`Could not resolve an image URL for listing ${detail.listingId}`);
    }
    return { ...image, url };
  });
  return { ...detail, images };
}

/**
 * Pure cache-patch for the detail screen's own query entry. Same reasoning
 * as feed/favorites-cache.ts's `setFavoriteInPages`: a plain object spread,
 * kept here (not inlined in the mutation hook) so it's unit-testable and so
 * the optimistic write and its rollback can't drift into two shapes that
 * happen to usually agree.
 */
export function setFavoriteInDetail(detail: ListingDetail, isFavorited: boolean): ListingDetail {
  if (detail.isFavorited === isFavorited) {
    return detail;
  }
  return { ...detail, isFavorited };
}
