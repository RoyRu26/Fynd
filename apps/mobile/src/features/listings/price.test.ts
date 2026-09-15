import { describe, expect, it } from 'vitest';

import { formatMinorUnitsForInput, parsePriceToMinorUnits } from '@/features/listings/price';

describe('parsePriceToMinorUnits', () => {
  it('parses whole numbers', () => {
    expect(parsePriceToMinorUnits('24')).toBe(2400);
    expect(parsePriceToMinorUnits('1')).toBe(100);
    expect(parsePriceToMinorUnits('1000')).toBe(100000);
  });

  it('parses one decimal place, padding to minor units', () => {
    expect(parsePriceToMinorUnits('24.5')).toBe(2450);
    expect(parsePriceToMinorUnits('0.1')).toBe(10);
  });

  it('parses two decimal places', () => {
    expect(parsePriceToMinorUnits('24.99')).toBe(2499);
    expect(parsePriceToMinorUnits('0.01')).toBe(1);
  });

  // The case that rules out `Number(input) * 100`, which yields
  // 2450.0000000000005 for exactly this value.
  it('parses 24.50 to exactly 2450', () => {
    expect(parsePriceToMinorUnits('24.50')).toBe(2450);
    expect(Number.isInteger(parsePriceToMinorUnits('24.50'))).toBe(true);
  });

  it('is exact across values that lose precision under float multiplication', () => {
    expect(parsePriceToMinorUnits('1.10')).toBe(110);
    expect(parsePriceToMinorUnits('2.30')).toBe(230);
    expect(parsePriceToMinorUnits('8.20')).toBe(820);
    expect(parsePriceToMinorUnits('16.10')).toBe(1610);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parsePriceToMinorUnits('24,50')).toBe(2450);
  });

  it('trims surrounding whitespace', () => {
    expect(parsePriceToMinorUnits('  24.50  ')).toBe(2450);
  });

  it('ignores leading zeros', () => {
    expect(parsePriceToMinorUnits('0024.50')).toBe(2450);
  });

  it('rejects empty input', () => {
    expect(parsePriceToMinorUnits('')).toBeNull();
    expect(parsePriceToMinorUnits('   ')).toBeNull();
  });

  it('rejects junk', () => {
    expect(parsePriceToMinorUnits('abc')).toBeNull();
    expect(parsePriceToMinorUnits('24.50 EUR')).toBeNull();
    expect(parsePriceToMinorUnits('€24.50')).toBeNull();
    expect(parsePriceToMinorUnits('1e3')).toBeNull();
    expect(parsePriceToMinorUnits('24.')).toBeNull();
    expect(parsePriceToMinorUnits('.50')).toBeNull();
    expect(parsePriceToMinorUnits('1 000')).toBeNull();
    expect(parsePriceToMinorUnits('1,000.50')).toBeNull();
  });

  // Only a single separator with 1-2 trailing digits is accepted, so a
  // thousands group before the decimal, or a decimal-then-thousands swap, has
  // no matching form and is rejected rather than guessed at.
  it('rejects mixed/ambiguous separators and grouping formats', () => {
    expect(parsePriceToMinorUnits('1,234.56')).toBeNull();
    expect(parsePriceToMinorUnits('1.234,56')).toBeNull();
    expect(parsePriceToMinorUnits('1,234')).toBeNull();
    expect(parsePriceToMinorUnits('1.234')).toBeNull();
    expect(parsePriceToMinorUnits('1,2,3')).toBeNull();
    expect(parsePriceToMinorUnits('1.2.3')).toBeNull();
  });

  it('rejects negative values', () => {
    expect(parsePriceToMinorUnits('-5')).toBeNull();
    expect(parsePriceToMinorUnits('-0.01')).toBeNull();
  });

  // listings_positive_price requires price_amount > 0.
  it('rejects zero', () => {
    expect(parsePriceToMinorUnits('0')).toBeNull();
    expect(parsePriceToMinorUnits('0.00')).toBeNull();
  });

  it('rejects more than two decimal places', () => {
    expect(parsePriceToMinorUnits('24.500')).toBeNull();
    expect(parsePriceToMinorUnits('1.234')).toBeNull();
  });

  it('rejects values too large to hold exactly as a JS integer', () => {
    expect(parsePriceToMinorUnits('999999999999999999999')).toBeNull();
  });
});

describe('formatMinorUnitsForInput', () => {
  it('round-trips a parsed price', () => {
    expect(formatMinorUnitsForInput(2450)).toBe('24.50');
    expect(parsePriceToMinorUnits(formatMinorUnitsForInput(2450))).toBe(2450);
  });

  it('pads values under one major unit', () => {
    expect(formatMinorUnitsForInput(5)).toBe('0.05');
    expect(formatMinorUnitsForInput(50)).toBe('0.50');
  });

  it('returns an empty string for a draft with no price yet', () => {
    expect(formatMinorUnitsForInput(null)).toBe('');
    expect(formatMinorUnitsForInput(undefined)).toBe('');
  });

  it('returns an empty string rather than rendering impossible values', () => {
    expect(formatMinorUnitsForInput(-1)).toBe('');
    expect(formatMinorUnitsForInput(1.5)).toBe('');
  });
});
