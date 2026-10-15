import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchSavedListingsPage } from '@/features/saved-items/api';
import { deriveNextSavedListingsOffset } from '@/features/saved-items/saved-items';

/**
 * Same page size and reasoning as `seller-profile`'s own grid: 12 is 4
 * full rows per page, small enough that most users never page at all,
 * large enough that paging a long saved-items list isn't chatty.
 */
export const SAVED_LISTINGS_PAGE_SIZE = 12;

export const savedItemsKeys = {
  listings: (userId: string | undefined) => ['saved-items', userId, 'listings'] as const,
};

export function useSavedListings(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: savedItemsKeys.listings(userId),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchSavedListingsPage({ userId: userId as string, limit: SAVED_LISTINGS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      deriveNextSavedListingsOffset(lastPageParam, lastPage, SAVED_LISTINGS_PAGE_SIZE),
    enabled: !!userId,
  });
}
