import { describe, expect, it } from 'vitest';

import {
  textVariantFace,
  textVariantStyles,
  usesDisplayFace,
  type TextVariant,
} from '@/components/ui/text-variants';

const MANROPE_VARIANTS: TextVariant[] = ['title', 'heading', 'price', 'priceSm'];
const ARCHIVO_VARIANTS: TextVariant[] = ['display', 'displaySm'];
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

  it('title, price, and priceSm use the bold weight of the Manrope display face', () => {
    for (const variant of ['title', 'price', 'priceSm'] as const) {
      expect(textVariantFace[variant]).toBe('displayBold');
    }
  });

  // The separation that keeps the loud expanded cut off ordinary headings:
  // display/displaySm are their own face, not a heavier Manrope.
  it.each(ARCHIVO_VARIANTS)('%s uses the Archivo Expanded face', (variant) => {
    expect(textVariantFace[variant]).toBe('displayExpanded');
    expect(usesDisplayFace(variant)).toBe(true);
  });

  it('no Manrope variant borrows the expanded face', () => {
    for (const variant of MANROPE_VARIANTS) {
      expect(textVariantFace[variant]).not.toBe('displayExpanded');
    }
  });

  // letterSpacing is points in react-native, not em, so it cannot be left to
  // scale with the size — -0.02em against 34pt.
  it('display carries the handoff tracking resolved to points', () => {
    expect(textVariantStyles.display.fontSize).toBe(34);
    expect(textVariantStyles.display.letterSpacing).toBeCloseTo(34 * -0.02, 5);
  });

  it('displaySm carries no tracking', () => {
    expect(textVariantStyles.displaySm.letterSpacing).toBeUndefined();
  });

  it('price and priceSm use tabular numerals', () => {
    expect(textVariantStyles.price.fontVariant).toEqual(['tabular-nums']);
    expect(textVariantStyles.priceSm.fontVariant).toEqual(['tabular-nums']);
  });

  it('no other variant sets tabular numerals', () => {
    const nonPriceVariants = [
      ...MANROPE_VARIANTS,
      ...ARCHIVO_VARIANTS,
      ...SYSTEM_VARIANTS,
      'mono' as const,
    ].filter(
      (v) => v !== 'price' && v !== 'priceSm',
    );
    for (const variant of nonPriceVariants) {
      expect(textVariantStyles[variant].fontVariant).toBeUndefined();
    }
  });
});

// Measured from the shipped font file: hhea ascender 878 + |descender| 210 at
// 1000 upem = 1.088em natural line box. react-native CLIPS when lineHeight is
// under that (DESIGN.md §12.3 forbids clipping), unlike CSS which just
// overlaps — which is why `display` diverges from the handoff's 34/36.
describe('Archivo Expanded variants clear the face’s natural line box', () => {
  const ARCHIVO_LINE_BOX_EM = (878 + 210) / 1000;

  it.each(['display', 'displaySm'] as const)('%s declares a lineHeight above the natural box', (variant) => {
    const { fontSize, lineHeight } = textVariantStyles[variant];
    expect(fontSize).toBeDefined();
    expect(lineHeight).toBeDefined();
    expect(lineHeight as number).toBeGreaterThanOrEqual((fontSize as number) * ARCHIVO_LINE_BOX_EM);
  });

  it('display specifically is 34/38, not the handoff’s 34/36 which would clip', () => {
    expect(textVariantStyles.display.fontSize).toBe(34);
    expect(textVariantStyles.display.lineHeight).toBe(38);
    expect(34 * ARCHIVO_LINE_BOX_EM).toBeGreaterThan(36);
  });
});
