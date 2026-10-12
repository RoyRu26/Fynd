import { describe, expect, it } from 'vitest';

import {
  formatMinorUnitsForInput,
  formatMoney,
  parsePriceToMinorUnits,
} from '@/features/listings/price';

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

describe('formatMoney', () => {
  // The headline case: a marketplace price reads '₪50', not '₪50.00'.
  it('formats a whole ILS amount with the shekel sign and no decimals', () => {
    expect(formatMoney(5000, 'ILS')).toBe('₪50');
  });

  it('formats an ILS amount with agorot', () => {
    expect(formatMoney(5025, 'ILS')).toBe('₪50.25');
  });

  // A non-zero minor part keeps its full width — never '₪50.2'.
  it('keeps both minor digits when the trailing one is zero', () => {
    expect(formatMoney(5020, 'ILS')).toBe('₪50.20');
  });

  it('formats zero', () => {
    expect(formatMoney(0, 'ILS')).toBe('₪0');
  });

  it('formats sub-major amounts', () => {
    expect(formatMoney(5, 'ILS')).toBe('₪0.05');
    expect(formatMoney(50, 'ILS')).toBe('₪0.50');
  });

  it('groups thousands', () => {
    expect(formatMoney(1234567, 'ILS')).toBe('₪12,345.67');
    expect(formatMoney(100000000, 'ILS')).toBe('₪1,000,000');
  });

  // The stored currency is what decides the symbol — nothing hardcodes ₪.
  it('formats other supported currencies from the stored code', () => {
    expect(formatMoney(5000, 'EUR')).toBe('€50');
    expect(formatMoney(5025, 'USD')).toBe('$50.25');
    expect(formatMoney(5000, 'GBP')).toBe('£50');
  });

  // JPY has no minor unit, so 5000 is five thousand yen, not fifty. It has
  // no symbol in the map either, so it also exercises the code-prefix path.
  it('respects zero-decimal currencies', () => {
    expect(formatMoney(5000, 'JPY')).toBe('JPY 5,000');
    expect(formatMoney(0, 'JPY')).toBe('JPY 0');
  });

  // Never throws on an unexpected code: a feed card must still render.
  it('falls back to the ISO code for an unknown currency', () => {
    expect(formatMoney(5000, 'CHF')).toBe('CHF 50');
    expect(formatMoney(5025, 'CHF')).toBe('CHF 50.25');
  });

  // price_amount > 0 is a DB constraint, so these are unreachable from a
  // real listing — asserted only so the function is total rather than
  // crashing a card if one ever appeared.
  it('is total for inputs the database makes unreachable', () => {
    expect(formatMoney(-5000, 'ILS')).toBe('-₪50');
    expect(formatMoney(5000.7, 'ILS')).toBe('₪50');
  });

  it('never performs floating-point arithmetic on the amount', () => {
    // 2450/100 and 1/3-style errors would surface as a wrong minor part.
    // These are the values that break a naive `minor / 100` implementation.
    expect(formatMoney(2450, 'ILS')).toBe('₪24.50');
    expect(formatMoney(110, 'ILS')).toBe('₪1.10');
    expect(formatMoney(70, 'ILS')).toBe('₪0.70');
    expect(formatMoney(1, 'ILS')).toBe('₪0.01');
  });
});
