import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';

import { mapProfileError } from '@/features/profile/errors';
import { useUpdateAvatar } from '@/features/profile/queries';

/**
 * Picks an image from the library and uploads it as the user's avatar.
 *
 * Extracted from `profile/edit.tsx`, where this whole sequence was inline,
 * once onboarding became a second caller. The part worth sharing is not the
 * picker call — it is the permission handling: the `canAskAgain` branch is the
 * difference between "we need access" (the OS will prompt) and "access is off,
 * change it in Settings" (the OS will not prompt again, so telling the user to
 * tap again strands them). Two copies of that distinction is two chances to
 * get one of them wrong.
 *
 * The upload is independent of any form's submit, matching the precedent in
 * `edit.tsx` and `sell/[id].tsx`'s PhotoSection: it commits as soon as the
 * image is chosen. That is why onboarding needs no avatar field in its zod
 * schema.
 */
export function useAvatarPicker(userId: string | undefined) {
  const updateAvatar = useUpdateAvatar(userId);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        permission.canAskAgain
          ? 'Fynd needs access to your photos to set a profile picture.'
          : 'Photo access is turned off for Fynd. Enable it in Settings to set a profile picture.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    if (!asset) {
      return;
    }

    try {
      await updateAvatar.mutateAsync(asset.uri);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setError(mapProfileError(err).message);
    }
  }

  return { pick, isUploading: updateAvatar.isPending, error };
}
