// Color primitives and the semantic layer, as pure data.
//
// No runtime import of any kind — not react-native, not expo-router. tokens.ts
// imports Platform/StyleSheet and theme.ts imports expo-router; either would
// pull react-native's Flow source into the test runner. Keeping the palette
// here lets palette.test.ts (contrast + colour-vision harness) assert against
// the real shipped values.
//
// tokens.ts re-exports the ramps and theme.ts re-exports the semantic layer,
// so no consumer imports this file directly.
//
// PAPER & INK migration (replaces Olive & Oat). Paper-cream surfaces, warm
// black ink, one loud orange-red. Danger moved off red to magenta so the
// brand owns the red-orange sector alone (DESIGN.md §8).

// ============================================================
// Primitive ramps — DESIGN.md §3
// ============================================================

// Warm neutral ramp. 900/950 retuned to the Paper & Ink "ink" blacks; every
// other step unchanged (already red/yellow-tinted, never blue).
export const neutral = {
  0: '#FFFFFF',
  25: '#FAF9F8',
  35: '#F8F4EF',
  50: '#F5F3F1',
  100: '#EDEAE7',
  200: '#E0DCD8',
  300: '#CAC4BF',
  400: '#A8A19B',
  450: '#8C857E', // dark textTertiary
  500: '#857E78',
  550: '#726B65', // light textTertiary
  600: '#655F5A',
  700: '#4A4541',
  800: '#2E2A28',
  900: '#1E1A15',
  950: '#14110D',
} as const;

// Paper surface ramp — light scheme only.
export const paper = {
  50: '#FAF7F0', // light bgElevated
  100: '#F4EFE4', // light bg
  200: '#E6E0D2', // light bgSunken
} as const;

// Ink brand ramp — orange-red, hue ~13.
// 500 is the brand swatch. It is too light for white text (≈3.9:1) or as
// normal-size text on paper (≈3.4:1), so the light scheme uses 700 for
// accent/accentText (≈5.9:1 under white, ≈5.1:1 on paper). 500 stays the
// dark-scheme accent (≈4.8:1 on neutral.950) and large-type brand ink.
export const ink = {
  300: '#F5A184',
  400: '#F06A45', // dark accentText, dark favoriteActive
  500: '#E8481F', // brand; dark accent
  600: '#C23C15', // dark accentPressed
  700: '#B8360F', // light accent, light accentText, light favoriteActive
  800: '#8F2A0B', // light accentPressed
} as const;

// Success ramp — teal, ~155° off the ink accent.
export const teal = {
  400: '#63CDBC', // dark success
  700: '#0B5F55', // light success
} as const;

// Danger ramp — magenta, moved off red so it never reads as the brand.
// Dark step is light enough for text on near-black, so onDanger is ink there.
export const magenta = {
  400: '#F0609A', // dark danger
  700: '#A3155A', // light danger
} as const;

// Warning ramp — unchanged.
export const amber = {
  400: '#C87A16', // dark warning
  700: '#9A5D0E', // light warning
} as const;

// Deprecated aliases so tokens.ts's re-export and existing tests keep
// compiling. Remove once tokens.ts and palette.test.ts use the new names.
/** @deprecated use `paper` */
export const oat = paper;
/** @deprecated use `ink` */
export const olive = ink;
/** @deprecated use `magenta` */
export const crimson = magenta;
/** @deprecated favoriteActive now uses the ink ramp */
export const rose = { 500: ink[400], 600: ink[700] } as const;

// ============================================================
// Semantic layer — DESIGN.md §3
// ============================================================
// Screens read only these, never a primitive ramp value.

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
  // Own token, not reused from onAccent — defined by its contrast against danger.
  onDanger: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  overlayScrim: string;
  skeleton: string;
};

export const lightColors: SemanticColors = {
  bg: paper[100],
  bgElevated: paper[50],
  bgSunken: paper[200],
  bgInverse: neutral[950],
  text: neutral[950],
  textSecondary: neutral[600],
  textTertiary: neutral[550],
  textInverse: paper[100],
  textOnMedia: '#FFFFFF',
  border: neutral[200],
  borderStrong: neutral[300],
  // Achromatic — focus is a system state, not a brand moment (§3 rule 2a).
  borderFocus: neutral[950],
  accent: ink[700],
  accentPressed: ink[800],
  onAccent: '#FFFFFF',
  accentText: ink[700],
  favoriteActive: ink[700],
  danger: magenta[700],
  dangerBg: '#FBEAF2',
  onDanger: '#FFFFFF',
  success: teal[700],
  successBg: '#E4F1EE',
  warning: amber[700],
  warningBg: '#FDF6E8',
  overlayScrim: 'rgba(20,17,13,0.55)',
  skeleton: paper[200],
};

export const darkColors: SemanticColors = {
  bg: neutral[950],
  bgElevated: neutral[900],
  bgSunken: neutral[950],
  bgInverse: paper[100],
  text: paper[100],
  textSecondary: neutral[400],
  textTertiary: neutral[450],
  textInverse: neutral[950],
  textOnMedia: '#FFFFFF',
  border: neutral[800],
  borderStrong: neutral[700],
  borderFocus: neutral[50],
  accent: ink[500],
  accentPressed: ink[600],
  onAccent: '#FFFFFF',
  accentText: ink[400],
  favoriteActive: ink[400],
  danger: magenta[400],
  dangerBg: '#3A1528',
  onDanger: neutral[950],
  success: teal[400],
  successBg: '#0F2E29',
  warning: amber[400],
  warningBg: '#332714',
  overlayScrim: 'rgba(20,17,13,0.55)',
  skeleton: neutral[800],
};

export function getColors(scheme: Scheme): SemanticColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
