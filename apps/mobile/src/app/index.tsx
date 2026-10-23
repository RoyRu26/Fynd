import { Redirect } from 'expo-router';
import { StyleSheet } from 'react-native';

import { EmptyState, Screen, type IconName } from '@/components/ui';
import { useAuthRouteState } from '@/features/auth/auth-route-provider';

// Same shape as explore.tsx/inbox/index.tsx's own ERROR_ICON constants.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };

export default function Index() {
  const state = useAuthRouteState();

  switch (state.status) {
    case 'loading':
      // Covered by the splash overlay (native) / invisible (web) — see RootLayoutInner.
      return null;
    case 'timed-out':
      return <RetryScreen title="This is taking a while." onRetry={state.retry} />;
    case 'error':
      return <RetryScreen title="Something went wrong." onRetry={state.retry} />;
    case 'unauthenticated':
      return <Redirect href="/(auth)/welcome" />;
    case 'onboarding':
      return <Redirect href="/(onboarding)/profile" />;
    case 'app':
      return <Redirect href="/(app)/(tabs)" />;
  }
}

function RetryScreen({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Screen contentContainerStyle={styles.container}>
      <EmptyState variant="error" icon={ERROR_ICON} title={title} actionLabel="Try again" onAction={onRetry} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
