import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { fetchFeedPage, type FeedCursor, type FeedListing } from '@/features/feed/api';
import { addFavorite, removeFavorite } from '@/features/feed/favorites';
// Both helpers are generic over the page-param type and structurally
// compatible with TanStack's own `InfiniteData`, so the cache value passes
// straight through without a cast in either direction.
import { isListingFavoritedInPages, setFavoriteInPages } from '@/features/feed/favorites-cache';
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

// ============================================================
// Favorites
// ============================================================

/**
 * A stable mutation key, so `useMutationState` below can find in-flight
 * toggles without the hook keeping its own parallel state.
 *
 * Exported so the listing-detail feature's own favorite mutation can share
 * it — both screens toggling the same underlying fact should be visible to
 * the same in-flight check, not two independently-tracked ones.
 */
export const FAVORITE_MUTATION_KEY = ['feed', 'toggleFavorite'] as const;

type ToggleFavoriteVariables = { listingId: string; isFavorited: boolean };

type FeedInfiniteData = InfiniteData<FeedListing[], FeedCursor>;

/**
 * Toggles a favorite, updating the feed cache optimistically.
 *
 * Reads the current state from the feed cache rather than taking it on
 * trust, because the RPC's `is_favorited` is the authoritative read state
 * and duplicating it in component state is exactly the second source of
 * truth worth avoiding. The caller passes the value it rendered; this hook
 * re-derives from the cache and prefers the cache when the two disagree
 * (the cache is what the server last said).
 *
 * Race handling is deliberately boring. `pendingListingIds` exposes which
 * listings have a toggle in flight so the heart can be disabled for exactly
 * that card, and `toggleFavorite` refuses to fire for an id already in
 * flight. Serializing with a mutation `scope` was the alternative, but it
 * makes `onMutate` — and therefore the optimistic flip — wait for the
 * previous mutation to settle, so the second tap would visibly lag. A
 * disabled control during a sub-second request is both simpler and more
 * honest about what is happening.
 *
 * No `onSettled` invalidation. Invalidating this key refetches EVERY loaded
 * page and re-signs every cover URL (each page is an RPC plus a batch
 * signing call), and can re-slice page boundaries under a user who is
 * mid-scroll. The optimistic value is already what the server now holds;
 * `onError` restores the pre-mutation snapshot if it isn't.
 *
 * `includeOwn`/`followingOnly` must match the `useFeed` call backing the
 * screen that renders the card doing the toggling, so this patches the SAME
 * `feedKeys.list` entry that screen is reading — a favorite toggled on the
 * "Following" tab must land in that tab's own cache, not "For you"'s.
 */
export function useToggleFavorite(includeOwn: boolean = false, followingOnly: boolean = false) {
  const queryClient = useQueryClient();
  const queryKey = feedKeys.list(includeOwn, followingOnly);

  // Derived from the mutation cache, not from local state, so every card
  // reading this hook agrees about what is in flight.
  const pendingVariables = useMutationState({
    filters: { mutationKey: FAVORITE_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as ToggleFavoriteVariables | undefined,
  });
  const pendingListingIds = new Set(
    pendingVariables.flatMap((variables) => (variables ? [variables.listingId] : [])),
  );

  const mutation = useMutation({
    mutationKey: FAVORITE_MUTATION_KEY,
    mutationFn: ({ listingId, isFavorited }: ToggleFavoriteVariables) =>
      isFavorited ? removeFavorite(listingId) : addFavorite(listingId),

    onMutate: async ({ listingId, isFavorited }) => {
      // Stop an in-flight page fetch from landing on top of the optimistic
      // write and reverting the heart mid-tap.
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<FeedInfiniteData>(queryKey);
      queryClient.setQueryData<FeedInfiniteData>(queryKey, (current) =>
        current ? setFavoriteInPages(current, listingId, !isFavorited) : current,
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      // Restore the exact pre-tap snapshot. Re-toggling instead would be
      // wrong if a concurrent page fetch had changed the cache in between.
      if (context?.previous) {
        queryClient.setQueryData<FeedInfiniteData>(queryKey, context.previous);
      }
    },
  });

  /**
   * Fires a toggle for one listing, unless one is already in flight for it.
   *
   * `isFavorited` is only a fallback: when the listing is still in the feed
   * cache, the cache's value wins, since that is what the server last
   * reported and what the optimistic update will be applied against.
   */
  function toggleFavorite(listingId: string, isFavorited: boolean): void {
    if (pendingListingIds.has(listingId)) {
      return;
    }
    const cached = isListingFavoritedInPages(
      queryClient.getQueryData<FeedInfiniteData>(queryKey),
      listingId,
    );
    mutation.mutate({ listingId, isFavorited: cached ?? isFavorited });
  }

  return { toggleFavorite, pendingListingIds, isError: mutation.isError, error: mutation.error };
}
