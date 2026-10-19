import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createAvatarUrls, fetchProfile, removeAvatarObject, updateProfile, type ProfileRow } from '@/features/profile/api';
import { uploadAvatar } from '@/features/profile/avatar-upload';
import { sellerProfileKeys } from '@/features/seller-profile/queries';

export const profileKeys = {
  all: ['profile'] as const,
  detail: (userId: string | undefined) => [...profileKeys.all, userId] as const,
  avatarUrl: (storagePath: string | null | undefined) =>
    [...profileKeys.all, 'avatar-url', storagePath] as const,
};

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.detail(userId),
    queryFn: () => fetchProfile(userId as string),
    enabled: !!userId,
  });
}

/**
 * Resolves one avatar storage path to a signed URL — the edit-profile
 * screen's own single-avatar need, structurally the same as
 * `useListingImageUrls` in listings/queries.ts but for exactly one path
 * instead of a batch, since there is only ever one avatar to render here.
 */
export function useAvatarUrl(storagePath: string | null | undefined) {
  return useQuery({
    queryKey: profileKeys.avatarUrl(storagePath),
    queryFn: () => createAvatarUrls([storagePath as string]),
    enabled: !!storagePath,
    // Signed URLs are minted for 1 hour (see createAvatarUrls' default);
    // staying well under that avoids ever rendering with one that expired
    // mid-session.
    staleTime: 45 * 60 * 1000,
    select: (urls) => (storagePath ? urls[storagePath] : undefined),
  });
}

/**
 * The patch type is a `Partial`, not the full set required: onboarding's
 * existing call site (`{ username, display_name }`) and the edit-profile
 * screen's (`{ username, display_name, bio }`) both go through this same
 * hook, unchanged from each caller's point of view.
 */
export type UpdateProfilePatch = Partial<{
  username: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
}>;

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: UpdateProfilePatch) => {
      if (!userId) {
        throw new Error('Cannot update profile without a signed-in user');
      }
      return updateProfile(userId, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
}

/**
 * Uploads a new avatar, commits its path onto the profile, then
 * best-effort removes whatever the OLD avatar object was (only if one
 * existed) — in that order, same "upload, commit, clean up the old one
 * last" sequencing as the listing-photo pipeline's own upload-before-attach
 * discipline. A failed cleanup is never surfaced: the new avatar is already
 * live, and the stale object is an invisible, later-removable orphan.
 *
 * Invalidates this profile's own cache entry AND the public seller-profile
 * entry sharing the same row (`sellerProfileKeys.byId`), so the seller
 * profile screen picks up a freshly-changed avatar without a manual
 * refetch.
 */
export function useUpdateAvatar(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceUri: string): Promise<ProfileRow> => {
      if (!userId) {
        throw new Error('Cannot update an avatar without a signed-in user');
      }

      const previous = await fetchProfile(userId);
      const newPath = await uploadAvatar({ userId, sourceUri });
      const updated = await updateProfile(userId, { avatar_path: newPath });

      if (previous.avatar_path) {
        await removeAvatarObject(previous.avatar_path);
      }

      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: sellerProfileKeys.byId(userId) });
      }
    },
  });
}
