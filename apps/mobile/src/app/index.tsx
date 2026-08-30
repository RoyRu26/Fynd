import { Redirect } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuthRouteState } from '@/features/auth/auth-route-provider';

export default function Index() {
  const state = useAuthRouteState();

  switch (state.status) {
    case 'loading':
      // Covered by the splash overlay (native) / invisible (web) — see RootLayoutInner.
      return null;
    case 'timed-out':
      return <RetryScreen message="This is taking a while." onRetry={state.retry} />;
    case 'error':
      return <RetryScreen message="Something went wrong." onRetry={state.retry} />;
    case 'unauthenticated':
      return <Redirect href="/(auth)/sign-in" />;
    case 'onboarding':
      return <Redirect href="/(onboarding)/profile" />;
    case 'app':
      return <Redirect href="/(app)" />;
  }
}

function RetryScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.text}>
        {message}
      </ThemedText>
      <Pressable onPress={onRetry} style={styles.button}>
        <ThemedText type="link">Retry</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  text: {
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
});
