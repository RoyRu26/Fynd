import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AmbientBackground } from '@/components/ambient-background';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import { signUp } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import { signUpSchema, type SignUpInput } from '@/features/auth/schemas';

export default function SignUp() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // Set when signUp() succeeds but returns no session — the email
  // confirmation is enabled branch. Local dev has confirmations off, so this
  // won't normally trigger, but the branch exists so enabling confirmations
  // later is a config change, not a rewrite.
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(input: SignUpInput) {
    setFormError(null);
    try {
      const data = await signUp(input.email, input.password);
      if (!data.session) {
        setCheckEmail(input.email);
      }
      // Otherwise onAuthStateChange picks up the new session; root resolver redirects.
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

  if (checkEmail) {
    return (
      <View style={styles.root}>
        <AmbientBackground />
        <Screen scroll style={styles.screen} contentContainerStyle={styles.contentContainer}>
          <View style={styles.identity}>
            <Text variant="wordmark">Fynd</Text>
            <Text variant="title">Check your email</Text>
            <Text variant="body" color="textSecondary">
              We sent a confirmation link to {checkEmail}.
            </Text>
          </View>
        </Screen>
      </View>
    );
  }

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
            <Text variant="wordmark">Fynd</Text>
            <Text variant="title">Create your account</Text>
            <Text variant="body" color="textSecondary">
              Join Fynd to discover, buy, and sell second-hand.
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
                <TextField
                  label="Password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  secureTextEntry
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.password?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field }) => (
                <TextField
                  label="Confirm password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  secureTextEntry
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.confirmPassword?.message}
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
              Create account
            </Button>
            <Button variant="ghost" onPress={() => router.push('/(auth)/sign-in')}>
              Already have an account? Sign in
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
  actions: {
    gap: space[3],
  },
});
