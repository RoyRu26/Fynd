import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useUpdateProfile } from '@/features/profile/queries';

export default function OnboardingProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const updateProfile = useUpdateProfile(userId);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    try {
      await updateProfile.mutateAsync({ username, display_name: displayName });
      // Query invalidation re-resolves the route via AuthRouteProvider.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Set up your profile</ThemedText>

      <TextInput
        autoCapitalize="none"
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        style={styles.input}
      />
      <TextInput
        placeholder="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        style={styles.input}
      />

      {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

      <Pressable onPress={handleSubmit} disabled={updateProfile.isPending} style={styles.button}>
        <ThemedText type="link">{updateProfile.isPending ? 'Saving…' : 'Continue'}</ThemedText>
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
