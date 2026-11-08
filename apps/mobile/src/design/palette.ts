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
// PAPER & INK (replaces Olive & Oat). Paper-cream surfaces, warm black ink,
// one loud orange-red. Danger moved off red to magenta so the brand owns the
// red-orange sector alone (DESIGN.md §8).
//
// ============================================================
// The structural consequence of a red-orange brand, measured
// ============================================================
// Olive & Oat could put brand and danger 78 degrees apart, because a green
// brand and a red danger live in opposite sectors. Paper & Ink deliberately
// moves the brand INTO the warm sector, which means brand and danger are now
// neighbours (36-52 degrees apart) rather than opposites. Hue alone can no
// longer carry the "Save is not Delete" signal, so the separation is carried
// by LUMINANCE instead, and that is what forced most of the values below.
//
// Two hard constraints pin `danger` in each scheme, and they pull opposite
// ways:
//   * it is a FOREGROUND token (TextField's error caption, the Sell screens'
//     error text), so it needs 4.5:1 against its own background;
//   * it is also the error BORDER, so it needs 3:1 against `borderFocus`, or
//     a focused field and a focused+errored field become the same control.
// Together those leave danger only a narrow luminance window — roughly
// 0.117-0.153 on paper, 0.201-0.266 on ink. `accent` therefore has to sit
// clearly OUTSIDE that window, or the two collapse together for a dichromat.
// Every accent/danger value below is a consequence of that, not a taste call.

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
  50: '#FAF7F0', // light bgElevated, light switchThumb
  100: '#F4EFE4', // light bg
  200: '#E6E0D2', // light bgSunken
} as const;

// Ink brand ramp — orange-red, hue ~8-20.
//
// 500 is the brand swatch: the colour the brand IS. Since 2026-11-08 (Roy:
// the app's orange matches the logo) it is the LIGHT scheme's `accent` and
// every scheme's primary button fill (`buttonPrimary`). Its limits:
//   * white on it measures 3.9:1, so its label (`onAccent`,
//     `onButtonPrimary`) is ink, 4.8:1;
//   * as normal-size text on paper it measures 3.4:1, so light `accentText`
//     stays ink.700;
//   * its luminance (0.219) sits INSIDE the dark scheme's danger window
//     (0.201-0.266), so on near-black it is the one orange a dichromat cannot
//     tell apart from the magenta danger. The dark `accent` therefore keeps
//     the brighter ink.300. Primary buttons still use the swatch in dark,
//     because §8 keeps every destructive control outlined/tonal, so a primary
//     button never meets danger as a same-shape fill.
//
// There is no 600 step. The ramp is numbered by lightness position, and
// nothing currently needs a value between the brand swatch and ink.700 —
// an unused step is a value someone will eventually reach
// for by accident.
export const ink = {
  200: '#FFA385', // dark accentPressed
  300: '#FF7D52', // dark accent
  400: '#F06A45', // dark accentText, dark favoriteActive, light accentPressed, buttonPrimaryPressed
  500: '#E8481F', // BRAND SWATCH — light accent + favoriteActive, buttonPrimary
  700: '#8B1604', // light accentText
} as const;

// Success ramp — teal, ~155-165 degrees off the ink accent. Unchanged from
// Olive & Oat: it was already chosen to sit far from a warm accent, and it
// still measures at least 1.65:1 from `accent` under both dichromat
// simulations (dark protanopia is the tightest).
export const teal = {
  400: '#63CDBC', // dark success
  700: '#0B5F55', // light success
} as const;

// Danger ramp — magenta, moved off red so it never reads as the brand.
//
// Both steps are more saturated and further from the accent's luminance than
// a "calmer" magenta would be, and that is deliberate: magenta's blue channel
// is the only thing a deuteranope or protanope has left to tell it apart from
// an orange accent once hue collapses. Desaturating either step toward a
// dusty rose drops accent-vs-danger below 1.6:1 under simulation — i.e. it
// would make "Delete" look like "Save" for a dichromat, which DESIGN.md §8
// calls "a safety problem, not an aesthetic one."
//
// Dark step is light enough for text on near-black, so onDanger is ink there.
// The light step sits at the BOTTOM of paper's window (0.118, 3.0:1 against
// borderFocus) since the light accent became the brighter brand swatch: that
// is what keeps accent-vs-danger at 1.6:1 under dichromat simulation.
export const magenta = {
  400: '#F00094', // dark danger
  700: '#BC0C60', // light danger
} as const;

// Warning ramp — amber, pushed from hue ~34 to ~46 (light) / ~46 (dark).
// Against an ORANGE brand the old amber sat 14-20 degrees away, close enough
// to read as a dimmer accent; the golder hue restores 31-40 degrees of
// separation while staying unmistakably "amber", not chartreuse.
export const amber = {
  400: '#C7A123', // dark warning
  700: '#7A6410', // light warning
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
  // NOT white in both schemes — see darkColors.onAccent. Defined by its
  // contrast against `accent`, exactly like `onDanger` is against `danger`.
  onAccent: string;
  accentText: string;
  // Primary button fill: the logo's own brand swatch in BOTH schemes, so
  // buttons match the logo. Separate from `accent` because the swatch fails
  // accent's other jobs (text on paper, danger separation on near-black).
  buttonPrimary: string;
  // Pressed LIGHTENS in both schemes: darkening would drop the ink label
  // below 4.5:1.
  buttonPrimaryPressed: string;
  // Ink, not white — white on the swatch measures 3.9:1.
  onButtonPrimary: string;
  // Switch thumb. Its own token because `onAccent` is ink in both schemes
  // now, and the native control's look is a light thumb. Defined by its
  // contrast against the ON track (`accent`) — see palette.test.ts.
  switchThumb: string;
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
  // The logo's own brand swatch (Roy, 2026-11-08: the app's orange matches
  // the logo). It clears paper's danger window (0.117-0.153) at 0.219, but a
  // white label on it measures 3.9:1, so the label is ink (4.8:1). Pressed
  // LIGHTENS to ink.400 (ink 6.2:1); darkening would drop the ink label
  // below 4.5:1. `accentText` stays ink.700: as normal text on paper the
  // swatch is only 3.4:1. Measured: 1.79/1.91:1 from danger under
  // deuteranopia/protanopia.
  accent: ink[500],
  accentPressed: ink[400],
  onAccent: neutral[950],
  accentText: ink[700],
  buttonPrimary: ink[500],
  buttonPrimaryPressed: ink[400],
  onButtonPrimary: neutral[950],
  // Near-white, the native look: 3.6:1 on the ink.500 track.
  switchThumb: paper[50],
  // Same value as `accent` by design (Paper & Ink puts favorite on the brand
  // ramp). §12.4 is satisfied by the icon's own filled/outline shape change,
  // never by colour alone — see DESIGN.md §4.
  favoriteActive: ink[500],
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
  // Brighter than the brand swatch, not darker. On near-black the accent has
  // to clear danger's luminance window (0.201-0.266) to stay distinguishable
  // under dichromat simulation, and the only direction with room is UP — a
  // darker orange would fail 3:1 against the background instead. Measured:
  // 8.1:1 against bg, 1.68/2.05:1 from danger under deuteranopia/protanopia.
  accent: ink[300],
  // Pressed BRIGHTENS here rather than darkening. On a near-black ground that
  // is the direction that reads as "pressed", and darkening would walk the
  // fill straight back into danger's luminance window.
  accentPressed: ink[200],
  // Ink, not white — the same decoupling `onDanger` has always had, for the
  // same reason. An orange loud enough to be the dark-scheme accent is far
  // too light for a white label (white on it measures 3.1:1); ink on it
  // measures 7.5:1. This is why §3 rule 6 keeps onAccent its own token.
  onAccent: neutral[950],
  accentText: ink[400],
  buttonPrimary: ink[500],
  buttonPrimaryPressed: ink[400],
  onButtonPrimary: neutral[950],
  // Ink, NOT a light paper value: a near-white thumb on the brighter ink.300
  // track measures only ~2.4:1, under the 3:1 floor. Ink measures 7.5:1.
  switchThumb: neutral[950],
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
