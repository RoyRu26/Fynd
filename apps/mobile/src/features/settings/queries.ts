import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateNotificationPreferences } from '@/features/settings/api';
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
