import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppThemeProvider, useAppTheme } from '@/design/theme-provider';
import { useAppFonts } from '@/design/use-app-fonts';
import { AuthProvider } from '@/features/auth/auth-provider';
import { AuthRouteProvider, useAuthRouteState } from '@/features/auth/auth-route-provider';
import { queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AuthRouteProvider>
                <RootLayoutInner />
              </AuthRouteProvider>
            </AuthProvider>
          </QueryClientProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Separate from RootLayout because useAuthRouteState() only works inside the
// providers mounted above — RootLayout's own job is purely to mount them.
function RootLayoutInner() {
  const { scheme, navigationTheme } = useAppTheme();
  const state = useAuthRouteState();
  const fontsReady = useAppFonts();
  const isReady = state.status !== 'loading' && fontsReady;

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AnimatedSplashOverlay isReady={isReady} />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
