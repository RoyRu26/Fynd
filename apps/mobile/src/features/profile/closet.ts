import { findCategoryMatch, type CategoryGroup } from '@/features/categories/categories';
import type { ListingStatus } from '@/features/listings/status';

/**
 * Pure logic for the Profile tab's "closet" (SCREENS.md Task 7): which of
 * the viewer's own listings appear in it, the Highlights row's category/Sold
 * circles, and filtering the grid by one.
 *
 * No react-native import of any kind — matching the same split
 * `seller-profile/profile.ts` and `features/listings/rack.ts` use for the
 * same reason: it's what makes this directly unit-testable.
 */

/** The single embedded-select query's row shape for one page — see api.ts. */
export type ClosetListingRow = {
  id: string;
  title: string | null;
  status: ListingStatus;
  category_id: string | null;
  listing_images: { storage_path: string; position: number }[];
};

export type NormalizedClosetListing = {
  listingId: string;
  title: string;
  status: ListingStatus;
  categoryId: string | null;
  coverStoragePath: string;
};

export type ClosetListing = NormalizedClosetListing & { coverUrl: string };

/**
 * Row -> domain. The query this normalizes already filters to
 * `status in ('active', 'reserved', 'sold')` server-side (see api.ts) — all
 * three went through `publish_listing`'s own photo requirement, so `title`
 * and at least one image are guaranteed exactly the same way
 * `seller-profile/profile.ts`'s `normalizeSellerListingRow` already
 * documents for its own (active-only) subset. A null title or an empty
 * `listing_images` array here means that guarantee was violated — worth
 * throwing loudly on, not silently coercing.
 */
export function normalizeClosetListingRow(row: ClosetListingRow): NormalizedClosetListing {
  if (row.title === null) {
    throw new Error(`Closet listing ${row.id} is missing a title`);
  }
  const cover = row.listing_images[0];
  if (!cover) {
    throw new Error(`Closet listing ${row.id} has no cover image`);
  }
  return {
    listingId: row.id,
    title: row.title,
    status: row.status,
    categoryId: row.category_id,
    coverStoragePath: cover.storage_path,
  };
}

/**
 * Attaches each listing's resolved cover URL. Throws rather than returning a
 * grid tile with a broken photo — same reasoning as
 * `seller-profile/profile.ts`'s `associateSellerListingCoverUrls`.
 */
export function associateClosetCoverUrls(
  rows: NormalizedClosetListing[],
  urlsByPath: Record<string, string>,
): ClosetListing[] {
  return rows.map((row) => {
    const coverUrl = urlsByPath[row.coverStoragePath];
    if (!coverUrl) {
      throw new Error(`Could not resolve a cover image URL for listing ${row.listingId}`);
    }
    return { ...row, coverUrl };
  });
}

export type ClosetPage = { listings: ClosetListing[]; totalCount: number };

/**
 * The next page's offset, or `null` when there is no next page. Same
 * offset-based reasoning as `deriveNextSellerListingsOffset`: one person's
 * own closet is a small, non-concurrently-paginated set, so the simpler
 * mechanism is right-sized here too.
 */
export function deriveNextClosetOffset(currentOffset: number, page: ClosetPage, pageSize: number): number | null {
  const nextOffset = currentOffset + page.listings.length;
  if (page.listings.length < pageSize || nextOffset >= page.totalCount) {
    return null;
  }
  return nextOffset;
}

export type ClosetHighlight =
  | { kind: 'category'; id: string; label: string }
  | { kind: 'sold'; id: 'sold'; label: 'Sold' };

/**
 * The Highlights row: one circle per top-level category group actually
 * present among the viewer's closet listings, in first-seen order, plus a
 * trailing "Sold" circle — but only when at least one listing is actually
 * sold. Both are instances of the same "hide rather than show an empty
 * state" rule the handoff's own optional seller badge follows: a highlight
 * with nothing behind it is chrome, not navigation.
 *
 * Reuses `findCategoryMatch` rather than comparing `categoryId` directly
 * against group ids: a listing's stored category can be a LEAF (e.g.
 * "Outerwear" under "Clothing"), so this groups by the leaf's PARENT, the
 * same resolution Explore's own category tabs already rely on.
 */
export function deriveClosetHighlights(
  listings: Pick<ClosetListing, 'categoryId' | 'status'>[],
  categoryGroups: CategoryGroup[],
): ClosetHighlight[] {
  const seenGroupIds: string[] = [];
  const highlightByGroupId = new Map<string, ClosetHighlight>();

  for (const listing of listings) {
    const match = findCategoryMatch(categoryGroups, listing.categoryId);
    if (match === null) {
      continue;
    }
    if (!highlightByGroupId.has(match.group.id)) {
      highlightByGroupId.set(match.group.id, { kind: 'category', id: match.group.id, label: match.group.name });
      seenGroupIds.push(match.group.id);
    }
  }

  const highlights = seenGroupIds.map((id) => highlightByGroupId.get(id)!);
  if (listings.some((listing) => listing.status === 'sold')) {
    highlights.push({ kind: 'sold', id: 'sold', label: 'Sold' });
  }
  return highlights;
}

/**
 * Filters the grid by the tapped highlight. `null` (nothing selected) shows
 * everything. A category highlight matches any listing whose stored
 * category resolves (leaf or group) to that same top-level group — the
 * mirror of how `deriveClosetHighlights` grouped listings into it.
 */
export function filterClosetListings<T extends { categoryId: string | null; status: ListingStatus }>(
  listings: T[],
  activeHighlightId: string | null,
  categoryGroups: CategoryGroup[],
): T[] {
  if (activeHighlightId === null) {
    return listings;
  }
  if (activeHighlightId === 'sold') {
    return listings.filter((listing) => listing.status === 'sold');
  }
  return listings.filter((listing) => findCategoryMatch(categoryGroups, listing.categoryId)?.group.id === activeHighlightId);
}

/** The collage cover's photos: the N most recent closet listings' covers, in loaded order. */
export function selectCollagePhotos<T>(listings: T[], limit: number): T[] {
  return listings.slice(0, limit);
}
