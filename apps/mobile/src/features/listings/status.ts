import type { Enums } from '@/types/database';

/**
 * Listing status domain helpers — same shape as condition.ts/size.ts: a
 * single source for the label mapping and the filtering/empty-copy logic
 * that My Listings (ROADMAP 1.5) needs, so it never leaks a raw enum string
 * into the UI and never duplicates the "which statuses count as mine to
 * browse" rule inline in a screen.
 */

export type ListingStatus = Enums<'listing_status'>;

/** The user-facing label for every status the database defines. */
export const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  reserved: 'Reserved',
  sold: 'Sold',
  removed: 'Removed',
};

/**
 * The filter bar on My Listings. `'removed'` is deliberately excluded — a
 * removed listing is not one of the four lifecycle buckets this roadmap item
 * surfaces, and `'all'` here means "all of draft/active/reserved/sold", not
 * literally every row that could ever exist for the seller.
 */
export type ListingStatusFilter = 'all' | Exclude<ListingStatus, 'removed'>;

export const MY_LISTINGS_FILTERS: ListingStatusFilter[] = ['all', 'draft', 'active', 'reserved', 'sold'];

export const FILTER_LABELS: Record<ListingStatusFilter, string> = {
  all: 'All',
  draft: 'Draft',
  active: 'Active',
  reserved: 'Reserved',
  sold: 'Sold',
};

/**
 * Filters a seller's own listings by the selected bucket.
 *
 * `'all'` still excludes `'removed'` — see the type's doc comment above —
 * so it never shows a listing the seller themselves took down.
 */
export function filterListingsByStatus<T extends { status: ListingStatus }>(
  listings: T[],
  filter: ListingStatusFilter,
): T[] {
  if (filter === 'all') {
    return listings.filter((listing) => listing.status !== 'removed');
  }
  return listings.filter((listing) => listing.status === filter);
}

/**
 * Copy for the empty state, which differs depending on whether the seller
 * has no listings at all versus just none in the currently selected bucket.
 */
export function getMyListingsEmptyCopy(
  filter: ListingStatusFilter,
  totalCount: number,
): { title: string; body?: string } {
  if (totalCount === 0) {
    return { title: "You haven't listed anything yet." };
  }

  switch (filter) {
    case 'draft':
      return { title: 'No drafts right now.' };
    case 'active':
      return { title: 'Nothing active right now.' };
    case 'reserved':
      return { title: 'No reserved listings.' };
    case 'sold':
      return { title: 'No sold listings yet.' };
    case 'all':
      // Unreachable in practice: 'all' includes every non-removed status, so
      // if totalCount > 0 there is at least one row with a non-removed
      // status unless every listing the seller has is 'removed' — a real
      // case (every listing taken down), so it still needs sensible copy.
      return { title: 'No active listings right now.' };
  }
}
