import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { getColors, getNavigationTheme, type Scheme } from '@/design/theme';

// Pure subtree theme/context mechanism. Deliberately does not render
// anything and has no opinion about system chrome (status bar, etc.) — a
// nested forced-dark provider must never implicitly change the phone's
// status bar as a side effect of subtree color resolution. Root-level system
// chrome is owned explicitly by the root layout instead.

type AppThemeContextValue = {
  scheme: Scheme;
  colors: ReturnType<typeof getColors>;
  navigationTheme: ReturnType<typeof getNavigationTheme>;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({
  children,
  scheme: forcedScheme,
}: {
  children: ReactNode;
  /** Forces this subtree to a specific scheme, e.g. a future permanently-dark Home feed. Omit to follow the system. */
  scheme?: Scheme;
}) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | 'unspecified' | null | undefined
  const scheme: Scheme = forcedScheme ?? (systemScheme === 'dark' ? 'dark' : 'light');

  const value = useMemo(
    () => ({ scheme, colors: getColors(scheme), navigationTheme: getNavigationTheme(scheme) }),
    [scheme],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within an AppThemeProvider');
  }
  return ctx;
}
