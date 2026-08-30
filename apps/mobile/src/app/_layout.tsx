import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/features/auth/auth-provider';
import { AuthRouteProvider, useAuthRouteState } from '@/features/auth/auth-route-provider';
import { queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthRouteProvider>
          <RootLayoutInner />
        </AuthRouteProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Separate from RootLayout because useAuthRouteState() only works inside the
// providers mounted above — RootLayout's own job is purely to mount them.
function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const state = useAuthRouteState();
  const isReady = state.status !== 'loading';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay isReady={isReady} />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
