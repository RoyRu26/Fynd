import { Redirect, Stack } from 'expo-router';

import { useAuthRouteState } from '@/features/auth/auth-route-provider';

export default function AppLayout() {
  const state = useAuthRouteState();

  switch (state.status) {
    case 'loading':
    case 'timed-out':
    case 'error':
      return <Redirect href="/" />;
    case 'unauthenticated':
      return <Redirect href="/(auth)/sign-in" />;
    case 'onboarding':
      return <Redirect href="/(onboarding)/profile" />;
    case 'app':
      // (tabs) is the NativeTabs group (Home/Sell/Profile); listing/[id],
      // seller/[id], and follows/[id] are plain pushed Stack screens that
      // sit outside it, so opening any of them hides the floating tab bar
      // automatically instead of needing a 4th tab or any custom
      // bottom-nav of its own.
      return (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="listing/[id]" />
          <Stack.Screen name="seller/[id]" />
          <Stack.Screen name="follows/[id]" />
        </Stack>
      );
  }
}
