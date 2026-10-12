import { Redirect, Stack } from 'expo-router';

import { useAuthRouteState } from '@/features/auth/auth-route-provider';

export default function OnboardingLayout() {
  const state = useAuthRouteState();

  switch (state.status) {
    case 'loading':
    case 'timed-out':
    case 'error':
      return <Redirect href="/" />;
    case 'unauthenticated':
      return <Redirect href="/(auth)/sign-in" />;
    case 'app':
      return <Redirect href="/(app)/(tabs)" />;
    case 'onboarding':
      return <Stack screenOptions={{ headerShown: false }} />;
  }
}
