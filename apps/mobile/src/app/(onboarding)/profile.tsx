import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Icon, Logo, Screen, Text, TextField, type IconName } from '@/components/ui';
import { border, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapAuthError } from '@/features/auth/errors';
import { useUsernameAvailability } from '@/features/profile/availability';
import { useAvatarUrl, useProfile, useUpdateProfile } from '@/features/profile/queries';
import { onboardingSchema, type OnboardingInput } from '@/features/profile/schemas';
import { useAvatarPicker } from '@/features/profile/use-avatar-picker';

// Verified against the installed packages, not guessed: both SF Symbol names
// exist in sf-symbols-typescript's types, and both Material Symbols names
// exist in expo-symbols' android/symbols.json.
const AVAILABLE_ICON: IconName = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };
const TAKEN_ICON: IconName = { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' };
const ADD_PHOTO_ICON: IconName = { ios: 'plus', android: 'add', web: 'add' };

const AVATAR_PICKER_SIZE = 84;
const AVATAR_BADGE_SIZE = 28;

export default function OnboardingProfile() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const userId = session?.user.id;
  const updateProfile = useUpdateProfile(userId);

  // Same hook `profile/edit.tsx` uses. The upload commits as soon as an image
  // is chosen, independent of this form's Continue button — which is why
  // `onboardingSchema` has no avatar field to validate.
  const avatarPicker = useAvatarPicker(userId);
  // Preview comes from the profile row, which is where `avatar_path` actually
  // lives. `useUpdateAvatar` invalidates this exact query on success, so the
  // picked photo appears here without any local preview state.
  const profileQuery = useProfile(userId);
  const avatarUrlQuery = useAvatarUrl(profileQuery.data?.avatar_path);

  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { username: '', displayName: '' },
  });

  const username = useWatch({ control, name: 'username' });
  const availability = useUsernameAvailability(username);

  async function onSubmit(input: OnboardingInput) {
    setFormError(null);
    try {
      await updateProfile.mutateAsync({
        username: input.username,
        display_name: input.displayName,
      });
      // Query invalidation re-resolves the route via AuthRouteProvider.
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      const mapped = mapAuthError(err);
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

  const hasAvatar = Boolean(avatarUrlQuery.data);

  return (
    <View style={styles.root}>
      <Screen scroll keyboardAvoiding contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <Logo height={34} />
            <Text variant="title">Set up your profile</Text>
            <Text variant="body" color="textSecondary">
              Choose how other people see you on Fynd.
            </Text>
          </View>

          <View style={styles.avatarSection}>
            <Pressable
              onPress={avatarPicker.pick}
              disabled={avatarPicker.isUploading}
              accessibilityRole="button"
              // One target, one name. The `+` badge is decorative chrome on
              // this same button, not a second control — giving it its own
              // role would announce two buttons for one action.
              accessibilityLabel={hasAvatar ? 'Change profile photo' : 'Add a profile photo'}
              accessibilityState={{ disabled: avatarPicker.isUploading, busy: avatarPicker.isUploading }}
              style={styles.avatarTarget}>
              <View style={styles.avatarCircleWrap}>
                {hasAvatar ? (
                  // `xl` is 84px, matching the empty slot below exactly — the
                  // circle must not resize when a photo lands in it. Avatar
                  // with no `name`/`accessibilityLabel` is not an AT node, so
                  // it adds nothing to this button's own name.
                  <Avatar size="xl" source={avatarUrlQuery.data} />
                ) : (
                  // Dashed and empty at the same 84px: reads as a slot waiting
                  // to be filled rather than a broken image.
                  <View
                    style={[
                      styles.avatarPlaceholder,
                      { borderColor: colors.borderStrong, backgroundColor: colors.bgElevated },
                    ]}
                  />
                )}

                <View
                  style={[styles.avatarBadge, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
                  {avatarPicker.isUploading ? (
                    <ActivityIndicator size="small" color={colors.onAccent} />
                  ) : (
                    <Icon name={ADD_PHOTO_ICON} size="sm" color={colors.onAccent} />
                  )}
                </View>
              </View>

              {/*
                Inside the Pressable, not beside it. This caption reads as the
                control's label, so it has to be tappable — and because the
                Pressable supplies its own `accessibilityLabel`, folding the
                text in here keeps it to one AT node instead of announcing
                "Add a photo" again after the button.
              */}
              <View style={styles.avatarCaption}>
                <Text variant="label">{hasAvatar ? 'Change photo' : 'Add a photo'}</Text>
                <Text variant="caption" color="textTertiary">
                  Optional
                </Text>
              </View>
            </Pressable>

            {avatarPicker.error ? (
              <Text
                variant="caption"
                color="danger"
                accessibilityLiveRegion="polite"
                accessibilityRole="alert">
                {avatarPicker.error}
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
                    // Shows the handle shape without putting '@' in the value
                    // — the field stays exactly what zod validates and what
                    // gets saved, so the prefix cannot leak into the username.
                    leading={
                      // Hidden from AT: an RN Text is an accessibility
                      // element by default, so this would otherwise be its
                      // own stop announcing "@" right before a field already
                      // labelled "Username".
                      <Text
                        variant="body"
                        color="textTertiary"
                        accessible={false}
                        importantForAccessibility="no">
                        @
                      </Text>
                    }
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
            Continue
          </Button>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingTop: space[10],
  },
  content: {
    gap: space[8],
  },
  identity: {
    gap: space[2],
  },
  fields: {
    gap: space[3],
  },
  avatarSection: {
    alignItems: 'center',
    gap: space[2],
  },
  avatarTarget: {
    alignItems: 'center',
    gap: space[2],
  },
  avatarCircleWrap: {
    // Anchors the badge; the badge itself overflows this box deliberately.
    position: 'relative',
  },
  avatarPlaceholder: {
    width: AVATAR_PICKER_SIZE,
    height: AVATAR_PICKER_SIZE,
    borderRadius: AVATAR_PICKER_SIZE / 2,
    borderWidth: border.thin,
    borderStyle: 'dashed',
  },
  avatarBadge: {
    position: 'absolute',
    right: -space[1],
    bottom: -space[1],
    width: AVATAR_BADGE_SIZE,
    height: AVATAR_BADGE_SIZE,
    borderRadius: AVATAR_BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Rings the badge in the page color so it separates from the avatar
    // beneath it regardless of how light or dark that photo is.
    borderWidth: border.thick,
  },
  avatarCaption: {
    alignItems: 'center',
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
