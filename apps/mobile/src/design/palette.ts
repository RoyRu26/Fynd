// Color primitives and the semantic layer, as pure data.
//
// No runtime import of any kind — not react-native, not expo-router. This is
// the same split as text-variants.ts / text.tsx: tokens.ts imports
// Platform/StyleSheet and theme.ts imports expo-router, and since ES modules
// execute their whole body on import, either one would transitively pull in
// react-native's Flow source, which the test runner's transform cannot parse.
// Keeping the palette here is what makes palette.test.ts — the contrast and
// color-vision harness — able to assert against the real shipped values
// rather than a hand-copied duplicate that can silently drift.
//
// tokens.ts re-exports the ramps and theme.ts re-exports the semantic layer,
// so no consumer imports this file directly.

// ============================================================
// Primitive ramps — DESIGN.md §3
// ============================================================

// Warm neutral ramp. Unchanged by the Olive & Oat migration: it was already
// tinted toward red/yellow, which §3 requires ("never blue").
//
// 450 and 550 are new. `textTertiary` was neutral.500 in both schemes and
// measured 3.56:1 on the old cream — below the 4.5:1 floor for the
// normal-sized text it actually carries (TextField placeholder, TextField
// helper text, the onboarding availability caption). That was a pre-existing
// accessibility defect, not one this migration introduced; these two steps
// are the minimum correction that keeps the three-tier text hierarchy intact.
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
  500: '#857E78', // no consumer since the textTertiary correction; retained as a ramp step
  550: '#726B65', // light textTertiary
  600: '#655F5A',
  700: '#4A4541',
  800: '#2E2A28',
  900: '#1A1716',
  950: '#0C0A0B',
} as const;

// Oat surface ramp — light scheme only, replacing the former `cream`.
// The neutral steps above are near-white greys and read cold against a warm
// canvas, so surfaces keep their own family. Softened from the previous
// cream anchor (#FBF1D8, S 72%) to roughly S 44%: at full cream saturation
// the canvas tints every thumbnail in a 3-up grid and competes with the
// product photography that §1 makes the hero.
export const oat = {
  50: '#FCFAF3', // light bgElevated
  100: '#F6F2E8', // swatch anchor — light bg
  200: '#EAE4D4', // light bgSunken
} as const;

// Olive brand ramp — hue ~78-83, S 33-45%, replacing the former brick-crimson
// `red`. The brand leaves the red sector entirely so `danger` owns it
// unambiguously: the previous accent sat 1 degree of hue and 1.87:1 from
// danger, which DESIGN.md §8 calls "a safety problem, not an aesthetic one."
//
// Olive is deliberately low-chroma. A saturated accent competes with product
// photography; this one recedes behind it, per §1's "the interface recedes."
export const olive = {
  300: '#B8CC8A',
  400: '#8FA855', // dark accentText
  500: '#6B8A36',
  600: '#5E7A2E', // dark accent
  700: '#4A5D28', // light accent, light accentText, dark accentPressed
  800: '#33421A', // light accentPressed
} as const;

// Favorite ramp, replacing `magenta`. Now a per-scheme pair like `accent`
// (§3 rule 1) rather than one hue: the old single magenta measured 1.02:1
// from danger — near-identical luminance, separated by hue alone. Splitting
// it lets each scheme pick a step that clears both its own background and
// danger.
export const rose = {
  500: '#FF6FA5', // dark favoriteActive
  600: '#E93A7D', // light favoriteActive
} as const;

// Success ramp, replacing the single `success.500 #2E9E63`.
//
// Two changes, both forced by measurement rather than taste. First the hue:
// with an olive brand, a yellow-green success would reproduce the exact
// collision this migration exists to remove, so success moved to teal (~170)
// — 90 degrees off the accent. Second, it became a per-scheme pair, for the
// same reason `accent` is one (§3 rule 1): the single value measured 3.73:1
// as caption text on the dark scheme, and a teal dark enough to pass on oat
// is muddy on near-black.
//
// Both steps are additionally verified to stay distinguishable from the
// olive accent under deuteranopia and protanopia, which the first teal
// candidate (#12796B) failed at 1.21:1.
export const teal = {
  400: '#63CDBC', // dark success
  700: '#0B5F55', // light success
} as const;

// Danger ramp, replacing the single `danger.500 #D93A3A`.
//
// The old value was chosen so a WHITE FOREGROUND on it cleared AA (4.55:1) —
// but `danger`'s actual consumers use it as a foreground, not a fill:
// TextField's error caption, the onboarding availability row, and the Sell
// screens' error text. Measured as text it was 4.07:1 on the light canvas
// and 4.34:1 on the dark one. Both fail. Like `accent`, it has to be a
// per-scheme pair to clear a pale canvas and a near-black one.
//
// A consequence worth stating: on the dark scheme a red light enough to read
// as text is too light for white on top, so `onDanger` becomes ink there.
// That is precisely why §3 rule 6 keeps `onDanger` decoupled from
// `onAccent` instead of assuming both are white forever.
export const crimson = {
  400: '#E8564B', // dark danger
  700: '#BF2A22', // light danger
} as const;

// Warning ramp, replacing the single `warning.500 #C87A16`, which measured
// 3.00:1 as text on the light canvas. Same per-scheme correction; the dark
// step keeps the original value, which was already fine on near-black.
export const amber = {
  400: '#C87A16', // dark warning
  700: '#9A5D0E', // light warning
} as const;

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

export const lightColors: SemanticColors = {
  bg: oat[100],
  bgElevated: oat[50],
  bgSunken: oat[200],
  bgInverse: neutral[900],
  text: neutral[900],
  textSecondary: neutral[600],
  textTertiary: neutral[550],
  textInverse: neutral[25],
  textOnMedia: '#FFFFFF',
  border: neutral[200],
  borderStrong: neutral[300],
  // Achromatic, NOT the brand accent — focus is a system state, not a brand
  // moment (§3 rule 2a). Deepened from neutral.800 to neutral.950 because the
  // danger correction above darkened the error border: against the new
  // crimson.700 the old charcoal measured 2.42:1, below the 3:1 a focused
  // field needs to stay distinguishable from a focused+errored one. Now
  // 3.36:1. Still achromatic, so the rule's intent is unchanged.
  borderFocus: neutral[950],
  accent: olive[700],
  accentPressed: olive[800],
  onAccent: '#FFFFFF',
  accentText: olive[700],
  favoriteActive: rose[600],
  danger: crimson[700],
  dangerBg: '#FDF0F0',
  onDanger: '#FFFFFF',
  success: teal[700],
  successBg: '#E4F1EE',
  warning: amber[700],
  warningBg: '#FDF6E8',
  overlayScrim: 'rgba(12,10,11,0.55)',
  skeleton: neutral[100],
};

export const darkColors: SemanticColors = {
  bg: neutral[950],
  bgElevated: neutral[900],
  bgSunken: neutral[950],
  bgInverse: neutral[50],
  text: neutral[25],
  textSecondary: neutral[400],
  textTertiary: neutral[450],
  textInverse: neutral[900],
  textOnMedia: '#FFFFFF',
  border: neutral[800],
  borderStrong: neutral[700],
  // Lightened from neutral.200 for the same reason as the light scheme: the
  // dark danger step is lighter, so the ring had to move further from it
  // (2.63:1 -> 3.24:1).
  borderFocus: neutral[50],
  accent: olive[600],
  accentPressed: olive[700],
  onAccent: '#FFFFFF',
  accentText: olive[400],
  favoriteActive: rose[500],
  danger: crimson[400],
  dangerBg: '#3A1E1E',
  // Ink, not white: see the crimson ramp's note. A red light enough to read
  // as text on near-black cannot carry a white foreground.
  onDanger: neutral[900],
  success: teal[400],
  successBg: '#0F2E29',
  warning: amber[400],
  warningBg: '#332714',
  overlayScrim: 'rgba(12,10,11,0.55)',
  skeleton: neutral[800],
};

export function getColors(scheme: Scheme): SemanticColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
