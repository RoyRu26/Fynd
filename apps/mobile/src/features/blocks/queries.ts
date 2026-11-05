import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import { blockUser, fetchIsBlockedByMe, fetchIsBlockedEitherWay, unblockUser } from '@/features/blocks/api';
import { feedKeys } from '@/features/feed/queries';
import { followKeys } from '@/features/follows/queries';

export const blockKeys = {
  // viewerId is `string | undefined` (mirroring followKeys.isFollowing's
  // own shape) rather than requiring a resolved id: the auth session can
  // still be hydrating when a sheet mounts, and the key needs to exist
  // before `enabled` gates the fetch.
  isBlockedByMe: (viewerId: string | undefined, targetId: string) =>
    ['blocks', viewerId, targetId, 'is-blocked-by-me'] as const,
  isBlockedEitherWay: (targetId: string) => ['blocks', targetId, 'is-blocked-either-way'] as const,
};

/**
 * A stable mutation key, so `useMutationState` below can find an in-flight
 * toggle without the hook keeping its own parallel state — same pattern as
 * `follows/queries.ts`'s `FOLLOW_MUTATION_KEY`.
 */
export const BLOCK_MUTATION_KEY = ['blocks', 'toggleBlock'] as const;

/**
 * Whether the signed-in viewer has blocked `targetId` — drives
 * `MoreActionsSheet`'s "Block this seller" / "Unblock this seller" row
 * label and state. Reads under the owner-scoped SELECT policy directly
 * (`fetchIsBlockedByMe`), which is sufficient here: the viewer asking
 * about their OWN blocklist is exactly the one direction that policy
 * allows.
 */
export function useIsBlockedByMe(viewerId: string | undefined, targetId: string) {
  return useQuery({
    queryKey: blockKeys.isBlockedByMe(viewerId, targetId),
    queryFn: () => fetchIsBlockedByMe(viewerId as string, targetId),
    enabled: !!viewerId && viewerId !== targetId,
  });
}

/**
 * Whether a block exists between the signed-in viewer and `targetId`, in
 * EITHER direction — via `is_blocked_with`. Used to proactively hide
 * "Message seller" on the listing detail screen. No `viewerId` parameter:
 * the RPC resolves the caller from `auth.uid()` itself, so there is
 * nothing here for a caller to forge.
 */
export function useIsBlockedEitherWay(targetId: string | undefined) {
  return useQuery({
    queryKey: blockKeys.isBlockedEitherWay(targetId ?? ''),
    queryFn: () => fetchIsBlockedEitherWay(targetId as string),
    enabled: !!targetId,
  });
}

type ToggleBlockVariables = { targetId: string; isBlocked: boolean };

/**
 * Toggles blocking `targetId`, mirroring `useToggleFollow`'s in-flight-
 * guard shape exactly: `isPending` is derived from the mutation cache
 * (filtered to this `targetId`, since a different profile's toggle must
 * not disable this one's row), and `toggleBlock` refuses to fire while one
 * is already pending for this target.
 *
 * On success, invalidates:
 *
 *   * EVERY feed list variant (`feedKeys.all`, a prefix match covering all
 *     four `includeOwn`/`followingOnly` combinations) — unlike
 *     `useToggleFollow`, which only ever needs the two `followingOnly`
 *     variants (following a seller can only ever change the "Following"
 *     feed's membership), a block changes what's visible in EVERY feed
 *     view, "For you" included.
 *   * Both parties' follow caches (`followKeys.counts` for viewer and
 *     target, plus `followKeys.isFollowing(viewerId, targetId)`) — the
 *     server-side trigger may have just silently severed a mutual follow,
 *     so stale follow UI state needs invalidating immediately rather than
 *     waiting for an unrelated refetch.
 *   * Both `isBlockedByMe`/`isBlockedEitherWay` cache entries for this
 *     pair, so the sheet's own row flips immediately.
 */
export function useToggleBlock(targetId: string, viewerId: string | undefined) {
  const queryClient = useQueryClient();
  const isBlockedByMeKey = blockKeys.isBlockedByMe(viewerId, targetId);
  const isBlockedEitherWayKey = blockKeys.isBlockedEitherWay(targetId);

  const pendingVariables = useMutationState({
    filters: { mutationKey: BLOCK_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as ToggleBlockVariables | undefined,
  });
  const isPending = pendingVariables.some((variables) => variables?.targetId === targetId);

  const mutation = useMutation({
    mutationKey: BLOCK_MUTATION_KEY,
    mutationFn: ({ isBlocked }: ToggleBlockVariables) =>
      isBlocked ? unblockUser(targetId) : blockUser(targetId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.all });
      queryClient.invalidateQueries({ queryKey: isBlockedByMeKey });
      queryClient.invalidateQueries({ queryKey: isBlockedEitherWayKey });
      queryClient.invalidateQueries({ queryKey: followKeys.counts(targetId) });
      if (viewerId) {
        queryClient.invalidateQueries({ queryKey: followKeys.counts(viewerId) });
        queryClient.invalidateQueries({ queryKey: followKeys.isFollowing(viewerId, targetId) });
      }
    },
  });

  /**
   * `isBlocked` is only a fallback: when the is-blocked-by-me cache
   * already holds a value, that wins, mirroring `toggleFollow`'s identical
   * reasoning.
   *
   * `onError` is a per-call callback, not a hook-level one -- there is no
   * optimistic update here to roll back (unlike `useToggleFollow`'s own
   * cache patch), so the caller (`MoreActionsSheet`) is what actually
   * needs to hear about a failure, to surface `mapBlockError` via its own
   * `Alert.alert`.
   */
  function toggleBlock(isBlocked: boolean, options?: { onError?: (error: unknown) => void }): void {
    if (isPending) return;
    const cached = queryClient.getQueryData<boolean>(isBlockedByMeKey);
    mutation.mutate({ targetId, isBlocked: cached ?? isBlocked }, { onError: options?.onError });
  }

  return { toggleBlock, isPending };
}
