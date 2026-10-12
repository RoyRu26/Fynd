import { describe, expect, it } from 'vitest';

import {
  formatSizeLabel,
  LISTING_SIZES,
  listingSizesBySystem,
  parseListingSize,
  SIZE_SYSTEM_LABELS,
} from '@/features/listings/size';

describe('formatSizeLabel', () => {
  it('renders alpha clothing sizes as bare uppercase letters', () => {
    expect(formatSizeLabel('alpha_m')).toBe('M');
    expect(formatSizeLabel('alpha_xl')).toBe('XL');
    expect(formatSizeLabel('alpha_xxs')).toBe('XXS');
    expect(formatSizeLabel('alpha_xxxl')).toBe('XXXL');
  });

  it('renders EU shoe sizes with their system prefix', () => {
    expect(formatSizeLabel('eu_shoe_42')).toBe('EU 42');
    expect(formatSizeLabel('eu_shoe_35')).toBe('EU 35');
    expect(formatSizeLabel('eu_shoe_47')).toBe('EU 47');
  });

  it('renders one_size as prose', () => {
    expect(formatSizeLabel('one_size')).toBe('One size');
  });

  // The rule this whole module exists to enforce.
  it('never leaks a raw enum string into a label', () => {
    for (const size of LISTING_SIZES) {
      const label = formatSizeLabel(size);
      expect(label).not.toBe(size);
      expect(label).not.toContain('_');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('parseListingSize', () => {
  it('splits a size into its system and value', () => {
    expect(parseListingSize('alpha_m')).toEqual({ system: 'alpha', value: 'm' });
    expect(parseListingSize('eu_shoe_42')).toEqual({ system: 'eu_shoe', value: '42' });
    expect(parseListingSize('one_size')).toEqual({ system: 'one_size' });
  });

  /**
   * The drift guard, and the reason these helpers derive labels from the
   * prefix convention instead of a hand-written lookup table.
   *
   * Walking the GENERATED enum means adding a value to an existing system
   * (`eu_shoe_48`, say) needs no code change and this still passes — while
   * adding a whole new SYSTEM (`waist_30`) fails here loudly, pointing at
   * exactly the function that needs extending. A parallel label map could
   * silently omit a value and nothing would notice.
   */
  it('recognises the system of every size the database defines', () => {
    const unrecognised = LISTING_SIZES.filter((size) => parseListingSize(size) === null);
    expect(unrecognised).toEqual([]);
  });
});

describe('listingSizesBySystem', () => {
  it('buckets every size into exactly one system, losing none', () => {
    const grouped = listingSizesBySystem();
    const total = Object.values(grouped).reduce((sum, sizes) => sum + sizes.length, 0);
    expect(total).toBe(LISTING_SIZES.length);
  });

  it('groups clothing and footwear separately, so a selector can show one at a time', () => {
    const grouped = listingSizesBySystem();
    expect(grouped.alpha).toContain('alpha_m');
    expect(grouped.alpha).not.toContain('eu_shoe_42');
    expect(grouped.eu_shoe).toContain('eu_shoe_42');
    expect(grouped.eu_shoe).not.toContain('alpha_m');
    expect(grouped.one_size).toEqual(['one_size']);
  });

  it('preserves enum order within a system, so chips read smallest-first', () => {
    const { alpha, eu_shoe } = listingSizesBySystem();
    expect(alpha).toEqual([
      'alpha_xxs',
      'alpha_xs',
      'alpha_s',
      'alpha_m',
      'alpha_l',
      'alpha_xl',
      'alpha_xxl',
      'alpha_xxxl',
    ]);
    expect(eu_shoe[0]).toBe('eu_shoe_35');
    expect(eu_shoe[eu_shoe.length - 1]).toBe('eu_shoe_47');
  });

  it('has a human label for every system it can produce', () => {
    for (const system of Object.keys(listingSizesBySystem())) {
      expect(SIZE_SYSTEM_LABELS[system as keyof typeof SIZE_SYSTEM_LABELS]).toBeTruthy();
    }
  });
});
