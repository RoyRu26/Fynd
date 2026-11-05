import type { TextStyle } from 'react-native';

import type { SemanticColors } from '@/design/theme';

// Pure data — no runtime react-native import (only `TextStyle` as a type,
// which is erased entirely, never executed) and no runtime import from
// @/design/tokens either: that module imports Platform/StyleSheet from
// react-native at the top level, and since ES modules execute their whole
// body on import, even importing a single string constant from it would
// transitively pull in react-native's own source — which the test runner's
// transform can't parse (Flow syntax). So this file expresses *which face*
// each variant uses as a label, not the resolved font-family string; text.tsx
// (untested, free to import tokens.ts) does that final mapping.

export type TextVariant =
  | 'display'
  | 'displaySm'
  | 'title'
  | 'heading'
  | 'price'
  | 'priceSm'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'micro'
  | 'mono';

// Curated subset of SemanticColors — not the full palette (which includes
// non-text-appropriate tokens like `bg`/`border`/`overlayScrim`) and not
// `string`. This is what makes an arbitrary raw color structurally
// unavailable on Text, not just discouraged.
export type TextColor = Extract<
  keyof SemanticColors,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'textInverse'
  | 'textOnMedia'
  | 'accentText'
  | 'onAccent'
  | 'danger'
  | 'onDanger'
  | 'success'
  | 'warning'
  | 'favoriteActive'
>;

export type TextFace = 'displayExpanded' | 'displaySemiBold' | 'displayBold' | 'system' | 'systemMono';

// DESIGN.md §5 rule 1: title/heading/price/priceSm use the Manrope display
// face; everything else is system. Mono is its own system-monospace face,
// distinct from body's plain system face.
//
// `display`/`displaySm` are the exception — Archivo Expanded Black, a second
// display face reserved for screen titles and section headers. Keeping them
// on their own face (rather than widening Manrope) is what stops the loud
// expanded cut leaking into ordinary headings.
export const textVariantFace: Record<TextVariant, TextFace> = {
  display: 'displayExpanded',
  displaySm: 'displayExpanded',
  title: 'displayBold',
  heading: 'displaySemiBold',
  price: 'displayBold',
  priceSm: 'displayBold',
  body: 'system',
  bodyStrong: 'system',
  label: 'system',
  caption: 'system',
  micro: 'system',
  mono: 'systemMono',
};

export function usesDisplayFace(variant: TextVariant): boolean {
  const face = textVariantFace[variant];
  return face === 'displaySemiBold' || face === 'displayBold' || face === 'displayExpanded';
}

// DESIGN.md §5's type scale, transcribed verbatim (size/lineHeight/weight).
// fontFamily is applied separately in text.tsx via textVariantFace, since
// the actual font-family strings live in @/design/tokens.
export const textVariantStyles: Record<TextVariant, Omit<TextStyle, 'fontFamily'>> = {
  // Archivo Expanded Black. `letterSpacing` is in POINTS in react-native, not
  // em — this is the handoff's −0.02em resolved against the 34pt size
  // (34 x −0.02 = −0.68). It does not scale with the text, so a size change
  // here means recomputing it.
  //
  // lineHeight is 38, NOT the handoff's 36. Measured from the shipped file:
  // hhea ascender 878 + |descender| 210 at 1000 upem = 1.088em, so the natural
  // line box at 34pt is 36.99pt. CSS would simply overlap a 36pt line and spill
  // visibly; react-native CLIPS ascenders and descenders instead, Android
  // especially, which §12.3 forbids. 38 clears the box with a little room.
  //
  // `displaySm` carries no tracking: the handoff specifies it only for
  // `display`, and negative tracking that reads as tight at 34pt starts to
  // close up counters at 20pt. Its 20/24 does clear 21.76pt natural, so it
  // needed no adjustment.
  display: { fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -0.68 },
  displaySm: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  price: { fontSize: 22, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  priceSm: { fontSize: 15, lineHeight: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  mono: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
};
