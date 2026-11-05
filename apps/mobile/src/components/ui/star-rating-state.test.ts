import { describe, expect, it } from 'vitest';

import { ratingForStarIndex, starFillForIndex } from '@/components/ui/star-rating-state';

describe('starFillForIndex', () => {
  it('fills every star at or below a whole-number value', () => {
    expect(starFillForIndex(3, 0)).toBe('filled');
    expect(starFillForIndex(3, 1)).toBe('filled');
    expect(starFillForIndex(3, 2)).toBe('filled');
  });

  it('leaves every star above a whole-number value empty', () => {
    expect(starFillForIndex(3, 3)).toBe('empty');
    expect(starFillForIndex(3, 4)).toBe('empty');
  });

  it('renders exactly one half star for a fractional value at or above the 0.5 boundary', () => {
    // 4.6 -> stars 0-3 filled, star 4 (the 5th) half (remaining 0.6 >= 0.5), nothing empty.
    expect(starFillForIndex(4.6, 0)).toBe('filled');
    expect(starFillForIndex(4.6, 1)).toBe('filled');
    expect(starFillForIndex(4.6, 2)).toBe('filled');
    expect(starFillForIndex(4.6, 3)).toBe('filled');
    expect(starFillForIndex(4.6, 4)).toBe('half');
  });

  it('rounds a fractional remainder below 0.5 down to empty, not half', () => {
    // 4.3 -> star 4's remaining is 0.3, below the half threshold.
    expect(starFillForIndex(4.3, 4)).toBe('empty');
  });

  it('renders a half star right at the 0.5 boundary, not filled or empty', () => {
    expect(starFillForIndex(0.5, 0)).toBe('half');
  });

  it('renders five empty stars for a zero value -- a seller with no reviews', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(starFillForIndex(0, index)).toBe('empty');
    }
  });

  it('clamps a value above the 5-star scale rather than rendering a 6th filled star incorrectly', () => {
    expect(starFillForIndex(7, 4)).toBe('filled');
  });

  it('clamps a negative value to empty rather than producing a negative "remaining"', () => {
    expect(starFillForIndex(-1, 0)).toBe('empty');
  });

  it('never returns half for a whole-number interactive pick, at any position', () => {
    for (let value = 0; value <= 5; value += 1) {
      for (let index = 0; index < 5; index += 1) {
        expect(starFillForIndex(value, index)).not.toBe('half');
      }
    }
  });
});

describe('ratingForStarIndex', () => {
  it('maps the 0-based star index to its 1-indexed rating', () => {
    expect(ratingForStarIndex(0)).toBe(1);
    expect(ratingForStarIndex(1)).toBe(2);
    expect(ratingForStarIndex(4)).toBe(5);
  });
});
