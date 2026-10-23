import { describe, expect, it } from 'vitest';

import {
  getStickerColors,
  getStickerLetterSpacing,
  STICKER_TRACKING_EM,
  type StickerTone,
} from '@/components/ui/sticker-state';

const TONES: StickerTone[] = ['accent', 'inverse', 'paper'];

describe('getStickerColors', () => {
  it('maps each tone to its filled surface and matching on-colour', () => {
    expect(getStickerColors('accent')).toEqual({ background: 'accent', label: 'onAccent' });
    expect(getStickerColors('inverse')).toEqual({ background: 'bgInverse', label: 'textInverse' });
    expect(getStickerColors('paper')).toEqual({ background: 'bg', label: 'text' });
  });

  // The property that lets a sticker sit over arbitrary photography without a
  // per-photo legibility check: never a bare text colour on a guessed
  // background, always a contrast-asserted pair.
  it('never pairs a label with a background it was not designed against', () => {
    const SAFE_PAIRS: Record<string, string> = {
      accent: 'onAccent',
      bgInverse: 'textInverse',
      bg: 'text',
    };
    for (const tone of TONES) {
      const { background, label } = getStickerColors(tone);
      expect(SAFE_PAIRS[background]).toBe(label);
    }
  });

  it('returns a tone for every member, so the lookup can be exhaustive', () => {
    for (const tone of TONES) {
      expect(getStickerColors(tone).background).toBeTruthy();
      expect(getStickerColors(tone).label).toBeTruthy();
    }
  });
});

describe('getStickerLetterSpacing', () => {
  // react-native's letterSpacing is POINTS. Passing the em value straight
  // through renders near-zero tracking and looks merely "a bit tight" —
  // wrong in a way that survives review.
  it('resolves em tracking against the font size', () => {
    expect(getStickerLetterSpacing(11)).toBeCloseTo(11 * STICKER_TRACKING_EM, 5);
    expect(getStickerLetterSpacing(20)).toBeCloseTo(20 * STICKER_TRACKING_EM, 5);
  });

  it('scales with size rather than being a fixed point value', () => {
    expect(getStickerLetterSpacing(22)).toBeCloseTo(getStickerLetterSpacing(11) * 2, 5);
  });

  it('is positive — stickers track open, never tight', () => {
    expect(getStickerLetterSpacing(11)).toBeGreaterThan(0);
  });
});
