/**
 * Pure saved-items logic: row normalization and pagination for the Saved
 * Items grid (ROADMAP 1.8).
 *
 * This is read + navigate only — favoriting/unfavoriting itself stays in
 * `features/feed/favorites.ts` (the toggle mutation) and
 * `features/feed/favorites-cache.ts` (the feed's own optimistic cache),
 * both unaffected by this feature. There is no un-favorite affordance on
 * this screen's grid tile: `ListingGridTile` is a shared component reused
 * verbatim by Search and the public Seller Profile grid (DESIGN.md
 * §14.2/§14.3's "no chips at this size"), so adding a heart icon to it
 * would change every other screen that renders it. Un-favoriting stays
 * available from listing detail, exactly like the seller-profile grid's
 * own tiles lead there to manage anything about the listing.
 *
 * No react-native import of any kind — matching the same split
 * `seller-profile/profile.ts` uses for the same reason: it's what makes
 * this directly unit-testable.
 */

/** The single embedded-select query's row shape for one page — see api.ts. */
export type SavedListingRow = {
  id: string;
  title: string | null;
  price_amount: number | null;
  currency: string;
  listing_images: { storage_path: string; position: number }[];
};

export type NormalizedSavedListing = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  coverStoragePath: string;
};

export type SavedListing = NormalizedSavedListing & { coverUrl: string };

/**
 * Row -> domain. The query this normalizes already inner-joins and filters
 * to `status = 'active'` server-side (see api.ts) — a sold or removed
 * favorite drops out of the result entirely rather than surfacing here with
 * a dead-end tap target. `title`/`price_amount` are typed nullable only
 * because the `listings` COLUMNS are nullable (to support drafts);
 * `listings_complete_when_not_draft` guarantees both are set on every
 * active row, and `publish_listing`'s own photo requirement guarantees at
 * least one image. A null here, or an empty `listing_images` array, means
 * that guarantee was violated — worth throwing loudly on, not silently
 * coercing, same reasoning `seller-profile/profile.ts`'s
 * `normalizeSellerListingRow` already uses for the identical shape.
 */
export function normalizeSavedListingRow(row: SavedListingRow): NormalizedSavedListing {
  if (row.title === null || row.price_amount === null) {
    throw new Error(`Active listing ${row.id} is missing a required field`);
  }
  const cover = row.listing_images[0];
  if (!cover) {
    throw new Error(`Active listing ${row.id} has no cover image`);
  }
  return {
    listingId: row.id,
    title: row.title,
    priceAmount: row.price_amount,
    currency: row.currency,
    coverStoragePath: cover.storage_path,
  };
}

/**
 * Attaches each listing's resolved cover URL. Throws rather than returning
 * a grid tile with a broken photo — same reasoning as
 * `seller-profile/profile.ts`'s `associateSellerListingCoverUrls`.
 */
export function associateSavedListingCoverUrls(
  rows: NormalizedSavedListing[],
  urlsByPath: Record<string, string>,
): SavedListing[] {
  return rows.map((row) => {
    const coverUrl = urlsByPath[row.coverStoragePath];
    if (!coverUrl) {
      throw new Error(`Could not resolve a cover image URL for listing ${row.listingId}`);
    }
    return { ...row, coverUrl };
  });
}

export type SavedListingsPage = {
  listings: SavedListing[];
  totalCount: number;
};

/**
 * The next page's offset, or `null` when there is no next page.
 *
 * Offset-based, not a keyset cursor like the Home feed's — same reasoning
 * `deriveNextSellerListingsOffset` already documents: one user's saved
 * items is a far smaller, far less concurrently-written set than the
 * global feed, so the simpler mechanism is the right-sized one here.
 */
export function deriveNextSavedListingsOffset(
  currentOffset: number,
  page: SavedListingsPage,
  pageSize: number,
): number | null {
  const nextOffset = currentOffset + page.listings.length;
  if (page.listings.length < pageSize || nextOffset >= page.totalCount) {
    return null;
  }
  return nextOffset;
}
