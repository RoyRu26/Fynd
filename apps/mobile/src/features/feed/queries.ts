import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchFeedPage, type FeedCursor, type FeedListing } from '@/features/feed/api';
import { deriveNextCursor } from '@/features/feed/pagination';

export type { FeedCursor } from '@/features/feed/api';

/**
 * Small on purpose: this is a paged, full-viewport mobile feed, not an
 * infinite-scroll list of thumbnails. A page should comfortably cover
 * several swipes without the user ever seeing a loading gap, without
 * fetching (and paying to sign) images that may never be scrolled to.
 */
export const FEED_PAGE_SIZE = 10;

export const feedKeys = {
  all: ['feed'] as const,
  // includeOwn stays part of the key — production Home always calls this
  // with false, but keeping it here rather than hardcoding it is what lets
  // local testing flip it on for the single-account fixture without the
  // two modes silently sharing a cache entry. followingOnly joins it for
  // the same reason, ROADMAP 3.2's "For you"/"Following" toggle: the two
  // scopes are different result sets entirely, so they need their own
  // cache entries rather than one key that silently mixes them.
  list: (includeOwn: boolean, followingOnly: boolean) =>
    [...feedKeys.all, 'list', includeOwn, followingOnly] as const,
};

export function useFeed(includeOwn: boolean = false, followingOnly: boolean = false) {
  return useInfiniteQuery({
    queryKey: feedKeys.list(includeOwn, followingOnly),
    queryFn: ({ pageParam }: { pageParam: FeedCursor }) =>
      fetchFeedPage({ limit: FEED_PAGE_SIZE, cursor: pageParam, includeOwn, followingOnly }),
    initialPageParam: null as FeedCursor,
    getNextPageParam: (lastPage: FeedListing[]) => deriveNextCursor(lastPage, FEED_PAGE_SIZE),
  });
}
