import type { TextColor } from '@/components/ui/text-variants';
import type { SemanticColors } from '@/design/theme';

// Pure logic for Sticker — no runtime import, so it is directly unit-testable.

export type StickerTone = 'accent' | 'inverse' | 'paper';

/** Tracking, in em. Resolved against the font size by the component, since react-native's `letterSpacing` is in points. */
export const STICKER_TRACKING_EM = 0.1;

/**
 * Font size, in points.
 *
 * Declared here as the handoff's own number rather than read off a `Text`
 * variant. Borrowing `micro`'s size would couple a sticker's tracking to a
 * variant that can change for entirely unrelated reasons, and reading it back
 * needs a cast because `TextStyle.fontSize` is optional.
 */
export const STICKER_FONT_SIZE = 11;

/** Offset of the hard drop shadow, in points. */
export const STICKER_SHADOW_OFFSET = 2;

export type StickerColors = {
  background: keyof SemanticColors;
  label: TextColor;
};

/**
 * Background and label tokens for each tone.
 *
 * Every pair is a FILLED surface with its matching on-colour, never a colour
 * chosen by eye: `accent`/`onAccent` and the `bgInverse`/`textInverse` swap
 * are both contrast-asserted in `palette.test.ts`, and `paper` is the page's
 * own `bg`/`text`. That is what lets a sticker sit over arbitrary product
 * photography without a per-photo legibility check.
 */
export function getStickerColors(tone: StickerTone): StickerColors {
  switch (tone) {
    case 'accent':
      return { background: 'accent', label: 'onAccent' };
    case 'inverse':
      return { background: 'bgInverse', label: 'textInverse' };
    case 'paper':
      return { background: 'bg', label: 'text' };
  }
}

/**
 * Converts the em tracking to the points react-native wants.
 *
 * Split out because it is the one piece of sticker geometry that depends on
 * the font size, and getting it wrong is invisible in review: `letterSpacing`
 * silently accepts an em-scale number and renders near-zero tracking.
 */
export function getStickerLetterSpacing(fontSize: number): number {
  return fontSize * STICKER_TRACKING_EM;
}
