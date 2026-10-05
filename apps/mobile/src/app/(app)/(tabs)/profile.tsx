import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { signOut } from '@/features/auth/api';

export default function Profile() {
  const { session } = useAuth();
  const email = session?.user.email ?? session?.user.id;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Profile</ThemedText>
        <ThemedText themeColor="textSecondary">{email}</ThemedText>
        <Pressable onPress={() => signOut()} style={styles.button}>
          <ThemedText type="link">Sign out</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
});
