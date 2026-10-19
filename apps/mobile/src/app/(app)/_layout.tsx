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
      // seller/[id], follows/[id], and conversation/[id] are plain pushed
      // Stack screens that sit outside it, so opening any of them hides the
      // floating tab bar automatically instead of needing a 4th tab or any
      // custom bottom-nav of its own. All four share one thing: each is
      // reachable from more than one tab's own context (conversation/[id],
      // for instance, opens both from the Inbox tab's own list AND from
      // listing/[id]'s "Message seller" action), so none of them belongs
      // nested inside a single tab's stack -- doing that for conversation/
      // [id] once was a real bug (see that screen's own doc comment).
      return (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="listing/[id]" />
          <Stack.Screen name="seller/[id]" />
          <Stack.Screen name="follows/[id]" />
          <Stack.Screen name="conversation/[id]" />
        </Stack>
      );
  }
}
