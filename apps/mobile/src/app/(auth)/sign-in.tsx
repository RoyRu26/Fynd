import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { signIn } from '@/features/auth/api';
import { mapAuthError } from '@/features/auth/errors';
import { signInSchema, type SignInInput } from '@/features/auth/schemas';

export default function SignIn() {
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
    <ThemedView style={styles.container}>
      <ThemedText type="title">Sign in</ThemedText>

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
            autoComplete="password"
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

      {formError ? <ThemedText themeColor="textSecondary">{formError}</ThemedText> : null}

      <Pressable onPress={handleSubmit(onSubmit)} disabled={isSubmitting} style={styles.button}>
        <ThemedText type="link">{isSubmitting ? 'Signing in…' : 'Sign in'}</ThemedText>
      </Pressable>

      <Link href="/(auth)/sign-up">
        <ThemedText type="link">Create an account</ThemedText>
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
