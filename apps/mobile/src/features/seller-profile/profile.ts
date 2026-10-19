/**
 * Pure seller-profile logic: row normalization for both the identity header
 * and the active-listings grid.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase` — matching the same split feed/pagination.ts and
 * listing-detail/detail.ts use for the same reason: it's what makes this
 * directly unit-testable.
 */

export type NormalizedSellerProfile = {
  sellerId: string;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
};

export type SellerProfile = NormalizedSellerProfile & { avatarUrl: string | null };

export type SellerProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
};

/** `null` means the seller id didn't resolve to a row at all. */
export function normalizeSellerProfileRow(row: SellerProfileRow | null): NormalizedSellerProfile | null {
  if (row === null) {
    return null;
  }
  return {
    sellerId: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
  };
}

/**
 * Attaches the resolved avatar URL. Null-tolerant, NOT throw-on-missing —
 * unlike `associateSellerListingCoverUrls` below, an avatar is a legitimate
 * permanent null state (onboarding never sets one), matching
 * `associateInboxCoverUrls`'s tolerant pattern rather than
 * `associateCoverUrls`'s strict one.
 */
export function associateSellerAvatarUrl(
  profile: NormalizedSellerProfile,
  urlsByPath: Record<string, string>,
): SellerProfile {
  return {
    ...profile,
    avatarUrl: profile.avatarPath ? urlsByPath[profile.avatarPath] ?? null : null,
  };
}

/** The single embedded-select query's row shape for one page — see api.ts. */
export type SellerListingRow = {
  id: string;
  title: string | null;
  price_amount: number | null;
  currency: string;
  listing_images: { storage_path: string; position: number }[];
};

export type NormalizedSellerListing = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  coverStoragePath: string;
};

export type SellerListing = NormalizedSellerListing & { coverUrl: string };

/**
 * Row -> domain. The query this normalizes already filters to
 * `status = 'active'` server-side (see api.ts) — `title`/`price_amount` are
 * typed nullable only because the `listings` COLUMNS are nullable (to
 * support drafts); `listings_complete_when_not_draft` guarantees both are
 * set on every active row, and `publish_listing`'s own photo requirement
 * guarantees at least one image. A null here, or an empty `listing_images`
 * array, means that guarantee was violated — worth throwing loudly on, not
 * silently coercing.
 */
export function normalizeSellerListingRow(row: SellerListingRow): NormalizedSellerListing {
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
 * a grid tile with a broken photo — same reasoning as feed/pagination.ts's
 * `associateCoverUrls`.
 */
export function associateSellerListingCoverUrls(
  rows: NormalizedSellerListing[],
  urlsByPath: Record<string, string>,
): SellerListing[] {
  return rows.map((row) => {
    const coverUrl = urlsByPath[row.coverStoragePath];
    if (!coverUrl) {
      throw new Error(`Could not resolve a cover image URL for listing ${row.listingId}`);
    }
    return { ...row, coverUrl };
  });
}

export type SellerListingsPage = {
  listings: SellerListing[];
  totalCount: number;
};

/**
 * The next page's offset, or `null` when there is no next page.
 *
 * Offset-based, not a keyset cursor like the Home feed's: a single seller's
 * catalog is far smaller and far less concurrently-written than the global
 * feed, so the simpler mechanism is the right-sized one here, not a
 * keyset scheme copied over for its own sake. A page shorter than what was
 * requested, or a running total that has already reached `totalCount`, is
 * the signal that the catalog is exhausted.
 */
export function deriveNextSellerListingsOffset(
  currentOffset: number,
  page: SellerListingsPage,
  pageSize: number,
): number | null {
  const nextOffset = currentOffset + page.listings.length;
  if (page.listings.length < pageSize || nextOffset >= page.totalCount) {
    return null;
  }
  return nextOffset;
}
