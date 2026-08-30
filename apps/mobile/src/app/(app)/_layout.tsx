import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
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
      return <AppTabs />;
  }
}
