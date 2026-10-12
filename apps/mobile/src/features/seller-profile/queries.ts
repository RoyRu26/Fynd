import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchSellerListingsPage, fetchSellerProfile } from '@/features/seller-profile/api';
import { deriveNextSellerListingsOffset } from '@/features/seller-profile/profile';

/**
 * A 3-up grid reads naturally in rows of 3 — 12 is 4 full rows per page,
 * small enough that a seller with a handful of listings never pages at
 * all, large enough that paging a large catalog isn't chatty.
 */
export const SELLER_LISTINGS_PAGE_SIZE = 12;

export const sellerProfileKeys = {
  byId: (sellerId: string) => ['seller-profile', sellerId] as const,
  listings: (sellerId: string) => ['seller-profile', sellerId, 'listings'] as const,
};

export function useSellerProfile(sellerId: string) {
  return useQuery({
    queryKey: sellerProfileKeys.byId(sellerId),
    queryFn: () => fetchSellerProfile(sellerId),
  });
}

export function useSellerListings(sellerId: string) {
  return useInfiniteQuery({
    queryKey: sellerProfileKeys.listings(sellerId),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchSellerListingsPage({ sellerId, limit: SELLER_LISTINGS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      deriveNextSellerListingsOffset(lastPageParam, lastPage, SELLER_LISTINGS_PAGE_SIZE),
  });
}
