import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchFollowCounts,
  fetchFollowListPage,
  fetchIsFollowing,
  followSeller,
  unfollowSeller,
} from '@/features/follows/api';
import {
  adjustFollowCounts,
  deriveNextFollowListOffset,
  type FollowCounts,
  type FollowListMode,
} from '@/features/follows/follows';

/**
 * A screenful of rows for a follower/following list — same sizing
 * reasoning as `SELLER_LISTINGS_PAGE_SIZE`: large enough that most
 * profiles never page at all, small enough that a very-followed profile's
 * list isn't chatty.
 */
export const FOLLOW_LIST_PAGE_SIZE = 20;

export const followKeys = {
  counts: (profileId: string) => ['follows', profileId, 'counts'] as const,
  // `viewerId` is `string | undefined` (mirroring `savedItemsKeys.listings`'s
  // own `userId: string | undefined` shape) rather than requiring a resolved
  // id: the auth session can still be hydrating when a profile screen
  // mounts, and the key needs to exist before `enabled` gates the fetch.
  isFollowing: (viewerId: string | undefined, profileId: string) =>
    ['follows', viewerId, profileId, 'is-following'] as const,
  list: (profileId: string, mode: FollowListMode) => ['follows', profileId, 'list', mode] as const,
};

/**
 * A stable mutation key, so `useMutationState` below can find an in-flight
 * toggle without the hook keeping its own parallel state — same pattern as
 * `feed/queries.ts`'s `FAVORITE_MUTATION_KEY`.
 */
export const FOLLOW_MUTATION_KEY = ['follows', 'toggleFollow'] as const;

export function useFollowCounts(profileId: string) {
  return useQuery({
    queryKey: followKeys.counts(profileId),
    queryFn: () => fetchFollowCounts(profileId),
  });
}

/**
 * Whether the viewer follows `profileId`.
 *
 * Disabled with no viewer (session still hydrating, or signed out) and
 * disabled when `viewerId === profileId` — a viewer's relationship to their
 * own profile is not "do I follow myself," it's "this is my profile," which
 * the screen already branches on separately before ever rendering a Follow
 * button.
 */
export function useIsFollowing(viewerId: string | undefined, profileId: string) {
  return useQuery({
    queryKey: followKeys.isFollowing(viewerId, profileId),
    queryFn: () => fetchIsFollowing(viewerId as string, profileId),
    enabled: !!viewerId && viewerId !== profileId,
  });
}

/**
 * A paginated page of `profileId`'s followers or following list. Mirrors
 * `seller-profile/queries.ts`'s `useSellerListings` shape exactly: offset
 * page params, `getNextPageParam` via the shared offset-deriver.
 */
export function useFollowList(profileId: string, mode: FollowListMode) {
  return useInfiniteQuery({
    queryKey: followKeys.list(profileId, mode),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchFollowListPage({ profileId, mode, limit: FOLLOW_LIST_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      deriveNextFollowListOffset(lastPageParam, lastPage, FOLLOW_LIST_PAGE_SIZE),
  });
}

type ToggleFollowVariables = { profileId: string; isFollowing: boolean };

/**
 * Toggles following `profileId`, updating both that profile's follower
 * count and the viewer's own following count optimistically.
 *
 * Two cache entries represent the SAME edge from two different profiles'
 * perspectives, and both are patched in one `onMutate`:
 *
 *   * `followKeys.counts(profileId)` — the TARGET's counts. `followersCount`
 *     moves, via the shared `adjustFollowCounts` (see its own doc comment
 *     for why it is specifically `followersCount`, never `followingCount`,
 *     that this helper touches).
 *   * `followKeys.counts(viewerId)` — the VIEWER's own counts, a different
 *     cache entry entirely. `followingCount` moves here instead — the
 *     viewer just started or stopped following one more profile.
 *     `setQueryData` on a key that has never been fetched (the viewer has
 *     not opened their own profile this session) is a safe no-op, so this
 *     is applied unconditionally rather than gated on "is it cached."
 *   * `followKeys.isFollowing(viewerId, profileId)` flips directly.
 *
 * In-flight guard and cache-preferred toggle direction mirror
 * `useToggleFavoriteFromDetail` exactly: `isPending` is derived from the
 * mutation cache (filtered to this `profileId`, since a different profile
 * screen's toggle must not disable this one's button), and `toggleFollow`
 * refuses to fire while one is already pending for this profile.
 */
export function useToggleFollow(profileId: string, viewerId: string | undefined) {
  const queryClient = useQueryClient();
  const countsKey = followKeys.counts(profileId);
  const isFollowingKey = followKeys.isFollowing(viewerId, profileId);
  const viewerCountsKey = viewerId ? followKeys.counts(viewerId) : undefined;

  const pendingVariables = useMutationState({
    filters: { mutationKey: FOLLOW_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as ToggleFollowVariables | undefined,
  });
  const isPending = pendingVariables.some((variables) => variables?.profileId === profileId);

  const mutation = useMutation({
    mutationKey: FOLLOW_MUTATION_KEY,
    mutationFn: ({ isFollowing }: ToggleFollowVariables) =>
      isFollowing ? unfollowSeller(profileId) : followSeller(profileId),

    onMutate: async ({ isFollowing }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: countsKey }),
        queryClient.cancelQueries({ queryKey: isFollowingKey }),
      ]);

      const previousCounts = queryClient.getQueryData<FollowCounts>(countsKey);
      const previousIsFollowing = queryClient.getQueryData<boolean>(isFollowingKey);
      const previousViewerCounts = viewerCountsKey
        ? queryClient.getQueryData<FollowCounts>(viewerCountsKey)
        : undefined;

      queryClient.setQueryData<FollowCounts>(countsKey, (current) =>
        current ? adjustFollowCounts(current, isFollowing) : current,
      );
      queryClient.setQueryData<boolean>(isFollowingKey, !isFollowing);
      if (viewerCountsKey) {
        queryClient.setQueryData<FollowCounts>(viewerCountsKey, (current) =>
          current
            ? { ...current, followingCount: current.followingCount + (isFollowing ? -1 : 1) }
            : current,
        );
      }

      return { previousCounts, previousIsFollowing, previousViewerCounts };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousCounts !== undefined) {
        queryClient.setQueryData<FollowCounts>(countsKey, context.previousCounts);
      }
      if (context?.previousIsFollowing !== undefined) {
        queryClient.setQueryData<boolean>(isFollowingKey, context.previousIsFollowing);
      }
      if (viewerCountsKey && context?.previousViewerCounts !== undefined) {
        queryClient.setQueryData<FollowCounts>(viewerCountsKey, context.previousViewerCounts);
      }
    },
  });

  /**
   * `isFollowing` is only a fallback: when the is-following cache already
   * holds a value, that wins, since it is what the server last reported and
   * what the optimistic update will be applied against.
   */
  function toggleFollow(isFollowing: boolean): void {
    if (isPending) return;
    const cached = queryClient.getQueryData<boolean>(isFollowingKey);
    mutation.mutate({ profileId, isFollowing: cached ?? isFollowing });
  }

  return { toggleFollow, isPending };
}
