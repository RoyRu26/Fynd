import type { FeedListing } from '@/features/feed/pagination';

/**
 * Pure cache transforms for optimistic favoriting.
 *
 * Kept separate from queries.ts so the whole optimistic/rollback path is
 * unit-testable without React, a QueryClient, or a renderer — the behaviour
 * that actually matters here (does the right card flip, does nothing else
 * move, is the input left alone) is all expressible as a function of two
 * arguments.
 *
 * Structurally compatible with TanStack's `InfiniteData<FeedListing[],
 * TPageParam>`, generic over the page-param type so a transformed value can
 * be handed straight back to `setQueryData` without a cast.
 */
export type FeedPages<TPageParam = unknown> = {
  pages: FeedListing[][];
  pageParams: TPageParam[];
};

/**
 * Sets `isFavorited` on every copy of one listing, across every loaded page.
 *
 * "Every copy" is deliberate, not defensive. The feed is keyset-paginated on
 * `(created_at, id)`, which makes duplicates across pages unlikely — but
 * `includeOwn` switching, a refetch that re-slices page boundaries, or a
 * listing whose `created_at` ties with the cursor row can all put the same
 * id in two loaded pages at once. Flipping only the first match would leave
 * a second card showing a stale heart, which reads as the tap not having
 * worked.
 *
 * Returns the ORIGINAL object when nothing matched. TanStack compares by
 * reference to decide whether to notify subscribers, so an unchanged
 * reference means a no-op tap (a listing that has already scrolled out of
 * the cache, say) costs no re-render of the feed.
 */
export function setFavoriteInPages<TPageParam>(
  data: FeedPages<TPageParam>,
  listingId: string,
  isFavorited: boolean,
): FeedPages<TPageParam> {
  let changed = false;

  const pages = data.pages.map((page) => {
    let pageChanged = false;

    const next = page.map((listing) => {
      if (listing.listingId !== listingId || listing.isFavorited === isFavorited) {
        return listing;
      }
      pageChanged = true;
      return { ...listing, isFavorited };
    });

    if (!pageChanged) {
      return page;
    }
    changed = true;
    return next;
  });

  if (!changed) {
    return data;
  }
  return { ...data, pages };
}

/**
 * Whether any loaded page currently has this listing favorited.
 *
 * The feed RPC's `is_favorited` is the authoritative read state, so the
 * toggle direction is derived from the cache rather than from a second
 * client-owned source of truth. Returns `null` when the listing is not in
 * the cache at all, which the caller treats as "cannot determine" rather
 * than as "not favorited" — guessing would risk sending an `insert` for a
 * row that already exists (a 23505 from the composite primary key).
 */
export function isListingFavoritedInPages<TPageParam>(
  data: FeedPages<TPageParam> | undefined,
  listingId: string,
): boolean | null {
  if (!data) {
    return null;
  }
  for (const page of data.pages) {
    for (const listing of page) {
      if (listing.listingId === listingId) {
        return listing.isFavorited;
      }
    }
  }
  return null;
}
