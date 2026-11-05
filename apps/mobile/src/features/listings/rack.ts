import type { ListingStatus } from '@/features/listings/status';

/**
 * Pure logic for the Sell tab's "your rack" strip (SCREENS.md Task 5) — which
 * of a seller's own listings appear in it, in what order, and which of the
 * handoff's three pill states (Live / Draft / Sold) each one gets.
 *
 * No react-native import of any kind, matching the same split
 * `seller-profile/profile.ts` and `status.ts` use for the same reason: it's
 * what makes this directly unit-testable.
 */

export type RackStatusKind = 'live' | 'draft' | 'sold';

/**
 * Maps a listing's lifecycle status onto the rack's three-way pill.
 *
 * `null` means the listing is excluded from the rack entirely. `removed` is
 * the only such status: a seller took it down themselves, so it has no place
 * in a glanceable "what's happening with my stuff" strip — the same bucket
 * `status.ts`'s own `'all'` filter already excludes from My Listings.
 * `reserved` folds into `live`: a hold on an otherwise-active listing is not
 * one of the three states the handoff names, and it reads closer to "still
 * out there" than to "sold".
 */
export function getRackStatusKind(status: ListingStatus): RackStatusKind | null {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'active':
    case 'reserved':
      return 'live';
    case 'sold':
      return 'sold';
    case 'removed':
      return null;
  }
}

export type RackEligibleListing = { id: string; status: ListingStatus };

export type RackItem<T extends RackEligibleListing> = T & { statusKind: RackStatusKind };

/**
 * The listings the rack strip renders, in order, each tagged with its pill
 * state — the first `limit` rack-eligible listings out of `listings`.
 *
 * `listings` is assumed already ordered the way `fetchMyListings` returns it
 * (most-recently-updated first); this only filters and truncates, it never
 * re-sorts. Capped at `limit` purely for render cost — the strip is a plain
 * `ScrollView`, not a virtualized list, and "See all" is what reaches
 * everything beyond it (see `countRackEligible`).
 */
export function selectRackItems<T extends RackEligibleListing>(listings: T[], limit: number): RackItem<T>[] {
  const items: RackItem<T>[] = [];
  for (const listing of listings) {
    const statusKind = getRackStatusKind(listing.status);
    if (statusKind === null) {
      continue;
    }
    items.push({ ...listing, statusKind });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

/** The true count behind "See all N" — every rack-eligible listing, not just the ones the capped strip renders. */
export function countRackEligible(listings: RackEligibleListing[]): number {
  return listings.filter((listing) => getRackStatusKind(listing.status) !== null).length;
}

/** One `listing_images` row, the shape `fetchListingCovers` queries (see api.ts). */
export type ListingImageCoverRow = { listing_id: string; storage_path: string; position: number };

/**
 * The lowest-`position` storage path per listing id, assuming `rows` already
 * arrive ordered by `position` ascending (see `fetchListingCovers`'s own
 * query order) — so the first row seen for a given listing id is its cover,
 * and later rows for the same id are ignored.
 *
 * A listing with no rows at all (an empty draft) simply has no entry, rather
 * than throwing — unlike `seller-profile/profile.ts`'s cover resolution,
 * which can assume every row has at least one image because it only ever
 * queries `status = 'active'` listings. The rack shows drafts too, and a
 * draft legitimately has zero photos until the seller adds one.
 */
export function groupLowestPositionCoverByListingId(rows: ListingImageCoverRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (!(row.listing_id in result)) {
      result[row.listing_id] = row.storage_path;
    }
  }
  return result;
}
