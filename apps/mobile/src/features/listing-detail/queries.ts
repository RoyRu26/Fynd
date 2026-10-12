import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { addFavorite, removeFavorite } from '@/features/feed/favorites';
import { setFavoriteInPages } from '@/features/feed/favorites-cache';
import type { FeedCursor, FeedListing } from '@/features/feed/pagination';
import { FAVORITE_MUTATION_KEY, feedKeys } from '@/features/feed/queries';
import { fetchListingDetail } from '@/features/listing-detail/api';
import { setFavoriteInDetail, type ListingDetail } from '@/features/listing-detail/detail';

export const listingDetailKeys = {
  byId: (listingId: string) => ['listing-detail', listingId] as const,
};

export function useListingDetail(listingId: string) {
  return useQuery({
    queryKey: listingDetailKeys.byId(listingId),
    queryFn: () => fetchListingDetail(listingId),
  });
}

type ToggleFavoriteVariables = { listingId: string; isFavorited: boolean };
type FeedInfiniteData = InfiniteData<FeedListing[], FeedCursor>;

/**
 * Favorite toggle for the detail screen's own heart button.
 *
 * Deliberately not a second favorite state model: this reuses the exact
 * same `addFavorite`/`removeFavorite` calls, the exact same
 * `FAVORITE_MUTATION_KEY` (so a toggle in flight from either screen is
 * visible to both), and the feed's own `setFavoriteInPages` helper. The only
 * new logic is patching this screen's own query cache entry — plus, in the
 * same `onMutate`, patching Home's already-mounted feed cache too (both
 * `includeOwn` variants, unconditionally; `setFavoriteInPages` is a no-op
 * when a given cache entry doesn't currently hold this listing). Pushed
 * Stack screens don't unmount the screen underneath them, so without this,
 * favoriting here and navigating back to Home would show a stale heart
 * until the next feed refetch.
 */
export function useToggleFavoriteFromDetail(listingId: string) {
  const queryClient = useQueryClient();
  const detailKey = listingDetailKeys.byId(listingId);

  const pendingVariables = useMutationState({
    filters: { mutationKey: FAVORITE_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as ToggleFavoriteVariables | undefined,
  });
  const isPending = pendingVariables.some((variables) => variables?.listingId === listingId);

  const mutation = useMutation({
    mutationKey: FAVORITE_MUTATION_KEY,
    mutationFn: ({ listingId: targetId, isFavorited }: ToggleFavoriteVariables) =>
      isFavorited ? removeFavorite(targetId) : addFavorite(targetId),

    onMutate: async ({ isFavorited }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });

      const previousDetail = queryClient.getQueryData<ListingDetail>(detailKey);
      queryClient.setQueryData<ListingDetail>(detailKey, (current) =>
        current ? setFavoriteInDetail(current, !isFavorited) : current,
      );

      const feedSnapshots = ([false, true] as const).map((includeOwn) => {
        const key = feedKeys.list(includeOwn);
        const previous = queryClient.getQueryData<FeedInfiniteData>(key);
        queryClient.setQueryData<FeedInfiniteData>(key, (current) =>
          current ? setFavoriteInPages(current, listingId, !isFavorited) : current,
        );
        return { key, previous };
      });

      return { previousDetail, feedSnapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData<ListingDetail>(detailKey, context.previousDetail);
      }
      context?.feedSnapshots.forEach(({ key, previous }) => {
        if (previous) {
          queryClient.setQueryData<FeedInfiniteData>(key, previous);
        }
      });
    },
  });

  function toggleFavorite(isFavorited: boolean): void {
    if (isPending) return;
    const cached = queryClient.getQueryData<ListingDetail>(detailKey)?.isFavorited;
    mutation.mutate({ listingId, isFavorited: cached ?? isFavorited });
  }

  return { toggleFavorite, isPending, isError: mutation.isError };
}
