import { describe, expect, it } from 'vitest';

import {
  textVariantFace,
  textVariantStyles,
  usesDisplayFace,
  type TextVariant,
} from '@/components/ui/text-variants';

const MANROPE_VARIANTS: TextVariant[] = ['display', 'title', 'heading', 'wordmark', 'price', 'priceSm'];
const SYSTEM_VARIANTS: TextVariant[] = ['body', 'bodyStrong', 'label', 'caption', 'micro'];

describe('Text variant → font face', () => {
  it.each(MANROPE_VARIANTS)('%s uses the Manrope display face', (variant) => {
    expect(usesDisplayFace(variant)).toBe(true);
    expect(['displaySemiBold', 'displayBold']).toContain(textVariantFace[variant]);
  });

  it.each(SYSTEM_VARIANTS)('%s uses the plain system face, not Manrope', (variant) => {
    expect(usesDisplayFace(variant)).toBe(false);
    expect(textVariantFace[variant]).toBe('system');
  });

  it('mono uses the system monospace face — not Manrope, not plain system', () => {
    expect(usesDisplayFace('mono')).toBe(false);
    expect(textVariantFace.mono).toBe('systemMono');
  });

  it('heading uses the semibold weight of the display face, not bold', () => {
    expect(textVariantFace.heading).toBe('displaySemiBold');
  });

  it('display, title, wordmark, price, and priceSm use the bold weight of the display face', () => {
    for (const variant of ['display', 'title', 'wordmark', 'price', 'priceSm'] as const) {
      expect(textVariantFace[variant]).toBe('displayBold');
    }
  });

  it('wordmark is bold like title, but a distinct size so the two never collide', () => {
    expect(textVariantStyles.wordmark.fontWeight).toBe('700');
    expect(textVariantStyles.wordmark.fontSize).not.toBe(textVariantStyles.title.fontSize);
  });

  it('price and priceSm use tabular numerals', () => {
    expect(textVariantStyles.price.fontVariant).toEqual(['tabular-nums']);
    expect(textVariantStyles.priceSm.fontVariant).toEqual(['tabular-nums']);
  });

  it('no other variant sets tabular numerals', () => {
    const nonPriceVariants = [...MANROPE_VARIANTS, ...SYSTEM_VARIANTS, 'mono' as const].filter(
      (v) => v !== 'price' && v !== 'priceSm',
    );
    for (const variant of nonPriceVariants) {
      expect(textVariantStyles[variant].fontVariant).toBeUndefined();
    }
  });
});
