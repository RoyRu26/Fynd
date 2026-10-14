import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar, Button, Icon, IconButton, Screen, Text, TextField, type IconName } from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useUsernameAvailability } from '@/features/profile/availability';
import { mapProfileError } from '@/features/profile/errors';
import { normalizeBio } from '@/features/profile/profile';
import { useAvatarUrl, useProfile, useUpdateAvatar, useUpdateProfile } from '@/features/profile/queries';
import { editProfileSchema, type EditProfileInput } from '@/features/profile/schemas';

/**
 * Edit profile — ROADMAP 1.7. Reuses onboarding's exact
 * Controller + useUsernameAvailability wiring for the username field
 * (including its live available/taken indicator) and its exact
 * form-error-display pattern, widened here with a bio field and an avatar
 * picker. The avatar picker is independent of the form's own Save button —
 * same "upload happens immediately, independent of the form" precedent as
 * sell/[id].tsx's PhotoSection.
 *
 * Manual back IconButton, no native header — this screen's Stack
 * (profile/_layout.tsx) already sets headerShown: false, same as
 * sell/[id].tsx.
 */

// Verified against the installed packages: 'chevron.left'/'arrow_back'
// already used the same way by seller/[id].tsx and sell/[id].tsx.
const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
// Verified against the installed packages: 'camera.fill' exists in
// sf-symbols-typescript's types, and 'photo_camera' exists in expo-symbols'
// android/symbols.json.
const CAMERA_ICON: IconName = { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' };
// Same pair onboarding/profile.tsx already uses for the identical
// available/taken indicator.
const AVAILABLE_ICON: IconName = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };
const TAKEN_ICON: IconName = { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' };

export default function EditProfile() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const userId = session?.user.id;

  const profileQuery = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);

  if (profileQuery.isPending) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <BackRow onPress={() => router.back()} />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      </Screen>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <BackRow onPress={() => router.back()} />
        <View style={styles.centered}>
          <Text variant="body" color="danger">
            Something went wrong loading your profile.
          </Text>
          <Button variant="secondary" size="sm" onPress={() => profileQuery.refetch()}>
            Try again
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <BackRow onPress={() => router.back()} />
      <EditProfileForm userId={userId as string} profile={profileQuery.data} updateProfile={updateProfile} />
    </Screen>
  );
}

function BackRow({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.header}>
      <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={onPress} />
    </View>
  );
}

function EditProfileForm({
  userId,
  profile,
  updateProfile,
}: {
  userId: string;
  profile: { username: string | null; display_name: string | null; bio: string | null; avatar_path: string | null };
  updateProfile: ReturnType<typeof useUpdateProfile>;
}) {
  const { colors } = useAppTheme();
  const [formError, setFormError] = useState<string | null>(null);

  const updateAvatar = useUpdateAvatar(userId);
  const avatarUrlQuery = useAvatarUrl(profile.avatar_path);
  const [avatarPickError, setAvatarPickError] = useState<string | null>(null);

  const displayName = profile.display_name ?? '';

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditProfileInput>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: {
      username: profile.username ?? '',
      displayName,
      bio: profile.bio ?? '',
    },
  });

  const username = useWatch({ control, name: 'username' });
  // Excludes the viewer's own id, so re-saving an unchanged username never
  // shows "taken" — it matches their own row.
  const availability = useUsernameAvailability(username, userId);

  async function handlePickAvatar() {
    setAvatarPickError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarPickError(
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
      setAvatarPickError(mapProfileError(err).message);
    }
  }

  async function onSubmit(input: EditProfileInput) {
    setFormError(null);
    try {
      await updateProfile.mutateAsync({
        username: input.username,
        display_name: input.displayName,
        bio: normalizeBio(input.bio),
      });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      const mapped = mapProfileError(err);
      if (mapped.field === 'username') {
        setError('username', { message: mapped.message });
      } else {
        setFormError(mapped.message);
      }
    }
  }

  const showAvailability =
    username.length > 0 &&
    !errors.username &&
    username === availability.debounced &&
    availability.data !== undefined;

  return (
    <View style={styles.content}>
      <View style={styles.avatarSection}>
        <View style={styles.avatarWrap}>
          <Avatar size="lg" source={avatarUrlQuery.data} name={displayName || profile.username || undefined} />
          <View style={styles.avatarBadge}>
            <IconButton
              icon={CAMERA_ICON}
              accessibilityLabel="Change profile picture"
              onPress={handlePickAvatar}
              disabled={updateAvatar.isPending}
              variant="onMedia"
              size="sm"
            />
          </View>
          {updateAvatar.isPending ? (
            <View
              style={[StyleSheet.absoluteFill, styles.avatarUploadingOverlay, { backgroundColor: colors.overlayScrim }]}>
              <ActivityIndicator color={colors.textOnMedia} />
            </View>
          ) : null}
        </View>
        {avatarPickError ? (
          <Text
            variant="caption"
            color="danger"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert">
            {avatarPickError}
          </Text>
        ) : null}
      </View>

      <View style={styles.fields}>
        <View>
          <Controller
            control={control}
            name="username"
            render={({ field }) => (
              <TextField
                label="Username"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.username?.message}
              />
            )}
          />
          <View style={styles.availabilityRegion} accessibilityLiveRegion="polite">
            {errors.username ? null : availability.isFetching ? (
              <View style={styles.availabilityRow}>
                <ActivityIndicator size="small" color={colors.textTertiary} />
                <Text variant="caption" color="textTertiary">
                  Checking availability…
                </Text>
              </View>
            ) : showAvailability ? (
              <View style={styles.availabilityRow}>
                <Icon
                  name={availability.data ? AVAILABLE_ICON : TAKEN_ICON}
                  size="sm"
                  color={availability.data ? colors.success : colors.danger}
                />
                <Text variant="caption" color={availability.data ? 'success' : 'danger'}>
                  {availability.data ? 'Username is available' : 'That username is taken'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Controller
          control={control}
          name="displayName"
          render={({ field }) => (
            <TextField
              label="Display name"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.displayName?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="bio"
          render={({ field }) => (
            <TextField
              label="Bio"
              multiline
              numberOfLines={3}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.bio?.message}
            />
          )}
        />
      </View>

      {formError ? (
        <Text
          variant="caption"
          color="danger"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
        Save
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  avatarSection: {
    alignItems: 'center',
    gap: space[2],
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    right: -space[1],
    bottom: -space[1],
  },
  avatarUploadingOverlay: {
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: {
    gap: space[3],
  },
  availabilityRegion: {
    marginTop: space[1],
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
});
