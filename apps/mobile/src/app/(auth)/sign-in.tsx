import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { PasswordField } from '@/components/auth/password-field';
import { Button, Logo, Screen, Text, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import { signIn } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import { signInSchema, type SignInInput } from '@/features/auth/schemas';

export default function SignIn() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(input: SignInInput) {
    setFormError(null);
    try {
      await signIn(input.email, input.password);
      // onAuthStateChange picks up the new session; root resolver redirects.
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      const mapped = mapAuthError(err);
      if (mapped.field === 'email' || mapped.field === 'password') {
        setError(mapped.field, { message: mapped.message });
      } else {
        setFormError(mapped.message);
      }
    }
  }

  return (
    <View style={styles.root}>
      <Screen scroll keyboardAvoiding contentContainerStyle={styles.contentContainer}>
        <View style={styles.content}>
          <View style={styles.identity}>
            <Logo height={34} />
            <Text variant="title">Welcome back</Text>
            <Text variant="body" color="textSecondary">
              Sign in to continue discovering.
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

            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <PasswordField
                  label="Password"
                  autoCapitalize="none"
                  autoComplete="password"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.password?.message}
                />
              )}
            />

            {/*
              Right-aligned under the password it relates to. A `ghost` Button
              rather than tappable Text so it inherits the 44pt target and the
              button role for free.
            */}
            <View style={styles.forgotRow}>
              <Button variant="ghost" size="sm" onPress={() => router.push('/(auth)/reset-password')}>
                Forgot password?
              </Button>
            </View>
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
              Sign in
            </Button>
            <Button variant="ghost" onPress={() => router.push('/(auth)/sign-up')}>
              New to Fynd? Create an account
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
  forgotRow: {
    alignItems: 'flex-end',
  },
  actions: {
    gap: space[3],
  },
});
