import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { Button, Logo, Screen, Text, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import { resetPassword } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import { resetPasswordSchema, type ResetPasswordInput } from '@/features/auth/schemas';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [requestedFor, setRequestedFor] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(input: ResetPasswordInput) {
    setFormError(null);
    try {
      await resetPassword(input.email);
      setRequestedFor(input.email);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      const mapped = mapAuthError(err);
      if (mapped.field === 'email') {
        setError('email', { message: mapped.message });
      } else {
        setFormError(mapped.message);
      }
    }
  }

  if (requestedFor) {
    return (
      <View style={styles.root}>
        <Screen scroll contentContainerStyle={styles.contentContainer}>
          <View style={styles.content}>
            <View style={styles.identity}>
              <Logo height={34} />
              <Text variant="title">Check your email</Text>
              {/*
                "If an account exists", not "we sent an email". GoTrue answers
                200 whether or not the address is registered, specifically so
                this screen cannot be used to enumerate accounts — wording it
                as a confirmed send would leak exactly what that protects, and
                would also be a claim we cannot actually verify.
              */}
              <Text variant="body" color="textSecondary">
                If an account exists for {requestedFor}, we&apos;ve sent a link to reset its
                password.
              </Text>
              {/*
                Stated up front rather than discovered after tapping. The
                client has `detectSessionInUrl: false`, so the recovery link
                genuinely cannot complete in the app yet — see `resetPassword`
                in features/auth/api.ts.
              */}
              <Text variant="caption" color="textTertiary">
                The link opens in your browser to finish setting a new password.
              </Text>
            </View>

            <View style={styles.actions}>
              <Button onPress={() => router.replace('/(auth)/sign-in')}>Back to sign in</Button>
            </View>
          </View>
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Screen scroll keyboardAvoiding contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <Logo height={34} />
            <Text variant="title">Reset your password</Text>
            <Text variant="body" color="textSecondary">
              Enter your email and we&apos;ll send you a link to set a new one.
            </Text>
          </View>

          <View style={styles.fields}>
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <TextField
                  label="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.email?.message}
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

          <View style={styles.actions}>
            <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting}>
              Send reset link
            </Button>
            {/*
              `replace`, not `back()` — matching the success branch. The label
              names a destination, so it has to reach it even when this screen
              was opened directly from a link and there is nothing to pop.
            */}
            <Button variant="ghost" onPress={() => router.replace('/(auth)/sign-in')}>
              Back to sign in
            </Button>
          </View>
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
  actions: {
    gap: space[3],
  },
});
