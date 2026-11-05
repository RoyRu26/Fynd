import { useMutation, useMutationState, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { previousFavoriteState } from '@/features/favorites/favorites';
import type { FeedCursor, FeedListing } from '@/features/feed/api';
import { addFavorite, removeFavorite } from '@/features/feed/favorites';
import { setFavoriteInPages } from '@/features/feed/favorites-cache';
import { feedKeys } from '@/features/feed/queries';
import { setFavoriteInDetail, type ListingDetail } from '@/features/listing-detail/detail';
import { listingDetailKeys } from '@/features/listing-detail/queries';
import { savedItemsKeys } from '@/features/saved-items/queries';

/**
 * One stable mutation key for every favorite change, from any screen, so a
 * change in flight on the feed is visible to the detail screen and vice versa.
 */
export const FAVORITE_MUTATION_KEY = ['favorites', 'set'] as const;

type SetFavoriteVariables = { listingId: string; favorite: boolean };
type FeedInfiniteData = InfiniteData<FeedListing[], FeedCursor>;

/** Every feed list entry, whatever its includeOwn/followingOnly flags. */
const FEED_LISTS_KEY = [...feedKeys.all, 'list'] as const;

/** Writes one listing's heart into every cache that renders it. */
function writeFavorite(queryClient: QueryClient, listingId: string, favorite: boolean): void {
  queryClient.setQueryData<ListingDetail>(listingDetailKeys.byId(listingId), (current) =>
    current ? setFavoriteInDetail(current, favorite) : current,
  );
  queryClient.setQueriesData<FeedInfiniteData>({ queryKey: FEED_LISTS_KEY }, (current) =>
    current ? setFavoriteInPages(current, listingId, favorite) : current,
  );
}

/** Whether a change for this listing is in flight right now (not as of last render). */
function isListingPending(queryClient: QueryClient, listingId: string): boolean {
  return (
    queryClient.isMutating({
      mutationKey: FAVORITE_MUTATION_KEY,
      predicate: (mutation) =>
        (mutation.state.variables as SetFavoriteVariables | undefined)?.listingId === listingId,
    }) > 0
  );
}

/**
 * The single favorite mutation shared by the feed (heart + double-tap) and the
 * listing detail screen.
 *
 * Variables carry the TARGET state ("make this favorited"), not a toggle of
 * whatever some cache believes. Two screens used to keep separate copies of
 * the state and each derived the toggle direction from its own copy; when
 * one was stale (liked on the feed, then opened the detail screen whose cached
 * row predated it) the tap sent the wrong write, the server refused or
 * ignored it, and the heart snapped back. Now the tap means exactly what the
 * user saw, and both writes are idempotent server-side.
 *
 * `onMutate` patches every cache that renders the heart (all feed entries and
 * the listing's detail entry), so all screens agree immediately.
 * `onSettled` refetches the detail row (one cheap request) and saved items,
 * which corrects a detail fetch that raced the write. Feed entries are not
 * invalidated: that would refetch and re-sign every loaded page.
 */
export function useSetFavorite() {
  const queryClient = useQueryClient();

  // Derived from the mutation cache so every caller agrees on what is in
  // flight. Render-time only: used to disable buttons, not to gate writes.
  const pendingVariables = useMutationState({
    filters: { mutationKey: FAVORITE_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as SetFavoriteVariables | undefined,
  });
  const pendingListingIds = new Set(
    pendingVariables.flatMap((variables) => (variables ? [variables.listingId] : [])),
  );

  const mutation = useMutation({
    mutationKey: FAVORITE_MUTATION_KEY,
    mutationFn: ({ listingId, favorite }: SetFavoriteVariables) =>
      favorite ? addFavorite(listingId) : removeFavorite(listingId),

    onMutate: async ({ listingId, favorite }) => {
      const detailKey = listingDetailKeys.byId(listingId);

      // Only the detail fetch is cancelled: it could land on top of the
      // optimistic write. Feed fetches are left alone, since cancelling them
      // would abort a next-page load or pull-to-refresh, and a feed refetch
      // returns the server's (already correct or soon corrected) state anyway.
      await queryClient.cancelQueries({ queryKey: detailKey });

      const previous = previousFavoriteState(
        listingId,
        queryClient.getQueryData<ListingDetail>(detailKey)?.isFavorited,
        queryClient.getQueriesData<FeedInfiniteData>({ queryKey: FEED_LISTS_KEY }).map(([, data]) => data),
        favorite,
      );
      writeFavorite(queryClient, listingId, favorite);
      return { previous };
    },

    // Put back only this listing's heart; other listings' in-flight changes
    // and any page loaded since onMutate are left intact.
    onError: (_error, { listingId }, context) => {
      if (context) writeFavorite(queryClient, listingId, context.previous);
    },

    onSettled: (_data, _error, { listingId }) => {
      void queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
      void queryClient.invalidateQueries({ queryKey: savedItemsKeys.all });
    },
  });

  /**
   * Sets one listing's favorite state, unless a change for it is already in
   * flight. Checked against the mutation cache at call time, so a double-tap
   * and a heart press in the same frame cannot both fire.
   */
  function setFavorite(listingId: string, favorite: boolean): void {
    if (isListingPending(queryClient, listingId)) return;
    mutation.mutate({ listingId, favorite });
  }

  return { setFavorite, pendingListingIds, isError: mutation.isError, error: mutation.error };
}
