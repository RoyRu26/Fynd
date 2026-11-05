import type { FeedPages } from '@/features/feed/favorites-cache';

/**
 * What the heart showed before an optimistic favorite change, so a failed
 * write can put back just this listing instead of restoring whole cache
 * snapshots (which would also erase other listings' in-flight hearts and any
 * page loaded in the meantime).
 *
 * The detail entry wins when present; otherwise the first feed copy of the
 * listing. With no cached copy anywhere, the tap must have flipped a visible
 * heart, so the previous state is the opposite of the target.
 */
export function previousFavoriteState(
  listingId: string,
  detailIsFavorited: boolean | undefined,
  feedCaches: readonly (FeedPages<unknown> | undefined)[],
  target: boolean,
): boolean {
  if (detailIsFavorited !== undefined) return detailIsFavorited;
  for (const cache of feedCaches) {
    for (const page of cache?.pages ?? []) {
      const listing = page.find((candidate) => candidate.listingId === listingId);
      if (listing) return listing.isFavorited;
    }
  }
  return !target;
}
