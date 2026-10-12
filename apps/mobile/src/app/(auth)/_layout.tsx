import { Redirect, Stack } from 'expo-router';

import { useAuthRouteState } from '@/features/auth/auth-route-provider';

export default function AuthLayout() {
  const state = useAuthRouteState();

  switch (state.status) {
    case 'loading':
    case 'timed-out':
    case 'error':
      // Never render this group's screens on top of an unresolved/error state —
      // bounce back to the root resolver, which owns the retry UI.
      return <Redirect href="/" />;
    case 'onboarding':
      return <Redirect href="/(onboarding)/profile" />;
    case 'app':
      return <Redirect href="/(app)/(tabs)" />;
    case 'unauthenticated':
      return <Stack screenOptions={{ headerShown: false }} />;
  }
}
