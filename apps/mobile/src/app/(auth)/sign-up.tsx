import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { signUp } from '@/features/auth/api';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when signUp() succeeds but returns no session — the email
  // confirmation is enabled branch. Local dev has confirmations off, so this
  // won't normally trigger, but the branch exists so enabling confirmations
  // later is a config change, not a rewrite.
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const data = await signUp(email, password);
      if (!data.session) {
        setCheckEmail(true);
      }
      // Otherwise onAuthStateChange picks up the new session; root resolver redirects.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Check your email</ThemedText>
        <ThemedText>We sent a confirmation link to {email}.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Create account</ThemedText>

      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        autoCapitalize="none"
        secureTextEntry
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />

      {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

      <Pressable onPress={handleSubmit} disabled={submitting} style={styles.button}>
        <ThemedText type="link">{submitting ? 'Creating account…' : 'Create account'}</ThemedText>
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
