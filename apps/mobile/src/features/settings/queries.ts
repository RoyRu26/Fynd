import { useMutation, useQueryClient } from '@tanstack/react-query';

import { requestAccountDeletion, updateNotificationPreferences } from '@/features/settings/api';
import { profileKeys } from '@/features/profile/queries';

export const settingsKeys = {
  all: ['settings'] as const,
};

export type UpdateNotificationPreferencesPatch = Partial<{
  notifyNewMessage: boolean;
  notifyNewReview: boolean;
  notifyNewFollower: boolean;
}>;

/**
 * Updates the signed-in user's notification-preference switches.
 *
 * No optimistic update: a toggle flipping back on the rare failure is an
 * acceptable, simple UX for this screen, so the switch's visible state is
 * driven straight from `useProfile`'s cached row rather than a locally
 * tracked optimistic value.
 *
 * On success, invalidates `profileKeys.detail` -- the same cache entry the
 * Profile tab's `useProfile` hook reads (features/profile/queries.ts) -- so
 * any other screen reading the profile row stays in sync, same invalidation
 * target `useUpdateProfile` already uses for the other allowlisted profile
 * columns.
 */
export function useUpdateNotificationPreferencesMutation(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: UpdateNotificationPreferencesPatch) => {
      if (!userId) {
        throw new Error('Cannot update notification preferences without a signed-in user');
      }
      return updateNotificationPreferences(userId, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
}

/**
 * Requests deletion of the signed-in user's own account (ROADMAP 6.1b).
 *
 * Throws on EITHER failure shape -- a transport/invoke error (already
 * thrown by `requestAccountDeletion` itself) or a resolved `{ ok: false,
 * reason, message }` payload (thrown HERE, since `requestAccountDeletion`
 * is a thin passthrough that returns it rather than throwing it) -- so the
 * Settings screen's single `catch` + `mapDeleteAccountError(err)` handles
 * both uniformly, same discipline `ai-suggestions.ts`'s own
 * transport-failure-collapsing established for its own feature, applied at
 * the mutation layer instead of the api layer here.
 *
 * No cache invalidation on success: a successful deletion is immediately
 * followed by `supabase.auth.signOut({ scope: 'local' })` at the call site,
 * whose `SIGNED_OUT` auth-state-change handler already calls
 * `queryClient.clear()` (auth-provider.tsx) -- a second, narrower
 * invalidation here would be redundant with that blanket clear.
 */
export function useDeleteAccountMutation() {
  return useMutation({
    mutationFn: async () => {
      const result = await requestAccountDeletion();
      if (!result.ok) {
        throw result;
      }
    },
  });
}
