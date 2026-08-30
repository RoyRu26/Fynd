import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { mapAuthError } from '@/features/auth/errors';
import { useAuth } from '@/features/auth/auth-provider';
import { useUsernameAvailability } from '@/features/profile/availability';
import { useUpdateProfile } from '@/features/profile/queries';
import { onboardingSchema, type OnboardingInput } from '@/features/profile/schemas';

export default function OnboardingProfile() {
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
    <ThemedView style={styles.container}>
      <ThemedText type="title">Set up your profile</ThemedText>

      <Controller
        control={control}
        name="username"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            placeholder="Username"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            style={styles.input}
          />
        )}
      />
      {errors.username ? (
        <ThemedText themeColor="textSecondary">{errors.username.message}</ThemedText>
      ) : availability.isFetching ? (
        <ThemedText themeColor="textSecondary">Checking availability…</ThemedText>
      ) : showAvailability ? (
        <ThemedText themeColor="textSecondary">
          {availability.data ? 'Username is available' : 'That username is taken'}
        </ThemedText>
      ) : null}

      <Controller
        control={control}
        name="displayName"
        render={({ field }) => (
          <TextInput
            placeholder="Display name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            style={styles.input}
          />
        )}
      />
      {errors.displayName ? (
        <ThemedText themeColor="textSecondary">{errors.displayName.message}</ThemedText>
      ) : null}

      {formError ? <ThemedText themeColor="textSecondary">{formError}</ThemedText> : null}

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
        style={styles.button}>
        <ThemedText type="link">{isSubmitting ? 'Saving…' : 'Continue'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#88888855',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  button: {
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
