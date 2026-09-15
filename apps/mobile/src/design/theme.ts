import { DefaultTheme as NavDefaultTheme, type Theme as NavigationTheme } from 'expo-router';

import { getColors } from '@/design/palette';

// Semantic color layer. Screens read only these — never a primitive ramp
// value directly (DESIGN.md §15, rule 1).
//
// The tokens themselves live in src/design/palette.ts, which has no runtime
// imports and is therefore testable; this file adds the expo-router-dependent
// navigation derivation on top. Everything is re-exported here so consumers
// keep importing from '@/design/theme' unchanged.

export {
  getColors,
  lightColors,
  darkColors,
  type Scheme,
  type SemanticColors,
} from '@/design/palette';

// Derives react-navigation's theme from the same semantic tokens every
// screen reads, so nav chrome and app UI never drift apart. Reuses
// expo-router's own platform font-select for nav chrome typography (`fonts`)
// unchanged — DESIGN.md doesn't ask for custom nav-chrome fonts, only colors.
export function getNavigationTheme(scheme: 'light' | 'dark'): NavigationTheme {
  const colors = getColors(scheme);
  return {
    dark: scheme === 'dark',
    colors: {
      primary: colors.accent,
      background: colors.bg,
      card: colors.bgElevated,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
    fonts: NavDefaultTheme.fonts,
  };
}
