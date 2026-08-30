import { Platform, StyleSheet } from 'react-native';

// Primitive design tokens. Transcribed verbatim from DESIGN.md — no values
// here are invented; every number/hex traces back to a specific DESIGN.md
// section. Screens must never import from this file directly — only
// src/design/theme.ts (the semantic layer) and src/design/theme-provider.tsx
// consume it. See DESIGN.md §15, rule 1.

// DESIGN.md §3 — warm neutral ramp.
export const neutral = {
  0: '#FFFFFF',
  25: '#FAF9F8',
  50: '#F5F3F1',
  100: '#EDEAE7',
  200: '#E0DCD8',
  300: '#CAC4BF',
  400: '#A8A19B',
  500: '#857E78',
  600: '#655F5A',
  700: '#4A4541',
  800: '#2E2A28',
  900: '#1A1716',
  950: '#0C0A0B',
} as const;

// DESIGN.md §3 — violet / electric orchid brand ramp.
export const violet = {
  300: '#C89BF5',
  400: '#B478F0',
  500: '#9B4DEA',
  600: '#7C2FD4',
  700: '#6620B0',
  800: '#4F1889',
} as const;

// DESIGN.md §3 — favorite-active + functional colors.
export const magenta = {
  500: '#E8478F',
  600: '#D62E7A',
} as const;

export const functional = {
  // #D93A3A, not the originally-specified #DC3A3A: the minimum adjustment
  // needed to bring white-foreground contrast above WCAG AA 4.5:1 (verified
  // 4.55:1) — see DESIGN.md §3.
  danger: '#D93A3A',
  success: '#2E9E63',
  warning: '#C87A16',
} as const;

// DESIGN.md §4 — signature gradient. Data only: no expo-linear-gradient
// consumer exists yet, so this is unused until a later phase renders it.
// Do not rebalance toward coral or add a warm terminus (§4).
export const gradientBrand = {
  angle: 135,
  stops: [
    { offset: 0, color: '#F2648F' },
    { offset: 0.28, color: '#C93FA8' },
    { offset: 0.62, color: '#8B34DC' },
    { offset: 1, color: '#5B1FB0' },
  ],
} as const;

// Vertical scrim for media (feed, gallery) — transparent to near-black,
// distinct from the flat overlayScrim semantic token used on sheets/dimming.
// Data only — no expo-linear-gradient consumer exists yet; see Dependencies.
export const gradientScrim = {
  angle: 180,
  stops: [
    { offset: 0, color: 'rgba(12,10,11,0)' },
    { offset: 1, color: 'rgba(12,10,11,0.75)' },
  ],
} as const;

// DESIGN.md §6 — 4pt spacing scale.
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// DESIGN.md §7 — radii. Crisp; no pill shapes.
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// DESIGN.md §8 — borders. Elevation is intentionally omitted: DESIGN.md §16.4
// leaves the exact shadow values open, so no placeholder numbers are invented
// here.
export const border = {
  hairline: StyleSheet.hairlineWidth,
  thin: 1,
  thick: 2,
} as const;

// DESIGN.md §9 — icon sizes.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

// DESIGN.md §12 — minimum touch target.
export const minTouchTarget = 44;

// DESIGN.md §10 — motion. Snappy: fast, near-linear, minimal overshoot.
export const duration = {
  instant: 100,
  fast: 160,
  normal: 240,
  slow: 320,
} as const;

export const spring = {
  stiffness: 400,
  damping: 35,
  mass: 1,
} as const;

// DESIGN.md §5 — font-family strings matching the @expo-google-fonts/manrope
// import binding names (see use-app-fonts.ts). Only the two weights the type
// scale actually uses are loaded: heading=600, display/title/price=700.
export const fontFamily = {
  displaySemiBold: 'Manrope_600SemiBold',
  displayBold: 'Manrope_700Bold',
  mono: Platform.select({ ios: 'ui-monospace', android: 'monospace', default: 'monospace' }),
} as const;
