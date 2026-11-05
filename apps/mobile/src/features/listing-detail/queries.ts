import { useQuery } from '@tanstack/react-query';

import { fetchListingDetail } from '@/features/listing-detail/api';

export const listingDetailKeys = {
  byId: (listingId: string) => ['listing-detail', listingId] as const,
};

export function useListingDetail(listingId: string) {
  return useQuery({
    queryKey: listingDetailKeys.byId(listingId),
    queryFn: () => fetchListingDetail(listingId),
  });
}
