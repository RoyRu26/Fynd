import { DefaultTheme as NavDefaultTheme, type Theme as NavigationTheme } from 'expo-router';

import { cream, functional, magenta, neutral, red } from '@/design/tokens';

// Semantic color layer. Screens read only these — never a primitive ramp
// value directly (DESIGN.md §15, rule 1).

export type Scheme = 'light' | 'dark';

export type SemanticColors = {
  bg: string;
  bgElevated: string;
  bgSunken: string;
  bgInverse: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textOnMedia: string;
  border: string;
  borderStrong: string;
  borderFocus: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  favoriteActive: string;
  danger: string;
  dangerBg: string;
  // Deliberately its own token, not reused from onAccent — even though both
  // currently resolve to white, danger's foreground is defined by its own
  // contrast needs against `danger`, never borrowed from accent's.
  onDanger: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  overlayScrim: string;
  skeleton: string;
};

// DESIGN.md §3, "Light" column.
export const lightColors: SemanticColors = {
  bg: cream[100],
  bgElevated: cream[50],
  bgSunken: cream[200],
  bgInverse: neutral[900],
  text: neutral[800],
  textSecondary: neutral[600],
  textTertiary: neutral[500],
  textInverse: neutral[25],
  textOnMedia: "#FFFFFF",
  border: neutral[200],
  borderStrong: neutral[300],
  // Charcoal, NOT the brand accent: with a red brand, an accent-colored
  // focus ring would collapse into the danger error border. Charcoal
  // separates from `danger` on two axes at once — luminance (3.12:1) and
  // chroma (achromatic vs saturated) — and reads 13.39:1 against the field
  // fill. See DESIGN.md §3.
  borderFocus: neutral[800],
  accent: "#c1121f",
  accentPressed: red[700],
  onAccent: "#FFFFFF",
  accentText: red[600],
  favoriteActive: magenta[600],
  danger: functional.danger,
  dangerBg: "#FDF0F0",
  onDanger: "#FFFFFF",
  success: functional.success,
  successBg: "#EDF7F1",
  warning: functional.warning,
  warningBg: "#FDF6E8",
  overlayScrim: "rgba(12,10,11,0.55)",
  skeleton: neutral[100],
};

// DESIGN.md §3, "Dark" column.
export const darkColors: SemanticColors = {
  bg: neutral[950],
  bgElevated: neutral[900],
  bgSunken: neutral[950],
  bgInverse: neutral[50],
  text: neutral[25],
  textSecondary: neutral[400],
  textTertiary: neutral[500],
  textInverse: neutral[900],
  textOnMedia: '#FFFFFF',
  border: neutral[800],
  borderStrong: neutral[700],
  // Charcoal's dark-scheme counterpart — a light stone neutral. Same
  // reasoning as the light scheme: 13.08:1 against the field fill, 3.34:1
  // from `danger`, and achromatic against a saturated error border.
  borderFocus: neutral[200],
  accent: red[500],
  accentPressed: red[600],
  onAccent: '#FFFFFF',
  accentText: red[400],
  favoriteActive: magenta[500],
  danger: functional.danger,
  dangerBg: '#3A1E1E',
  onDanger: '#FFFFFF',
  success: functional.success,
  successBg: '#17301F',
  warning: functional.warning,
  warningBg: '#332714',
  overlayScrim: 'rgba(12,10,11,0.55)',
  skeleton: neutral[800],
};

export function getColors(scheme: Scheme): SemanticColors {
  return scheme === 'dark' ? darkColors : lightColors;
}

// Derives react-navigation's theme from the same semantic tokens every
// screen reads, so nav chrome and app UI never drift apart. Reuses
// expo-router's own platform font-select for nav chrome typography (`fonts`)
// unchanged — DESIGN.md doesn't ask for custom nav-chrome fonts, only colors.
export function getNavigationTheme(scheme: Scheme): NavigationTheme {
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
