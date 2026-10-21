import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AmbientBackground } from '@/components/ambient-background';
import { BrandMark } from '@/components/brand-mark';
import { Button, Icon, Screen, Text, TextField, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapAuthError } from '@/features/auth/errors';
import { useUsernameAvailability } from '@/features/profile/availability';
import { useUpdateProfile } from '@/features/profile/queries';
import { onboardingSchema, type OnboardingInput } from '@/features/profile/schemas';

// Verified against the installed packages, not guessed: both SF Symbol names
// exist in sf-symbols-typescript's types, and both Material Symbols names
// exist in expo-symbols' android/symbols.json.
const AVAILABLE_ICON: IconName = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };
const TAKEN_ICON: IconName = { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' };

export default function OnboardingProfile() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const userId = session?.user.id;
  const updateProfile = useUpdateProfile(userId);

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

  return (
    <View style={styles.root}>
      <AmbientBackground />
      <Screen
        scroll
        keyboardAvoiding
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <BrandMark />
            <Text variant="title">Set up your profile</Text>
            <Text variant="body" color="textSecondary">
              Choose how other people see you on Fynd.
            </Text>
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
  screen: {
    backgroundColor: 'transparent',
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
  availabilityRegion: {
    marginTop: space[1],
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
});
