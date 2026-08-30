import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { signUp } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import { signUpSchema, type SignUpInput } from '@/features/auth/schemas';

export default function SignUp() {
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
      <ThemedView style={styles.container}>
        <ThemedText type="title">Check your email</ThemedText>
        <ThemedText>We sent a confirmation link to {checkEmail}.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Create account</ThemedText>

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            style={styles.input}
          />
        )}
      />
      {errors.email ? (
        <ThemedText themeColor="textSecondary">{errors.email.message}</ThemedText>
      ) : null}

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            placeholder="Password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            style={styles.input}
          />
        )}
      />
      {errors.password ? (
        <ThemedText themeColor="textSecondary">{errors.password.message}</ThemedText>
      ) : null}

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            placeholder="Confirm password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            style={styles.input}
          />
        )}
      />
      {errors.confirmPassword ? (
        <ThemedText themeColor="textSecondary">{errors.confirmPassword.message}</ThemedText>
      ) : null}

      {formError ? <ThemedText themeColor="textSecondary">{formError}</ThemedText> : null}

      <Pressable onPress={handleSubmit(onSubmit)} disabled={isSubmitting} style={styles.button}>
        <ThemedText type="link">{isSubmitting ? 'Creating account…' : 'Create account'}</ThemedText>
      </Pressable>

      <Link href="/(auth)/sign-in">
        <ThemedText type="link">Already have an account? Sign in</ThemedText>
      </Link>
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
