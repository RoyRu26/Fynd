/**
 * Price parsing for the listing editor.
 *
 * Money is stored as integer minor units (`listings.price_amount bigint`),
 * never as a decimal. This slice is EUR-only: the `currency` column relies on
 * its `'EUR'` database default and the client holds no privilege to write it.
 */

/** Cents per euro. EUR has two-decimal minor units. */
export const MINOR_UNITS_PER_MAJOR = 100;

const DECIMAL_PLACES = 2;

// Digits, then optionally a separator and one or two more digits. Both '.' and
// ',' are accepted because this is a euro-market app and European keyboards
// produce a comma. No sign is accepted, so negatives fail to match rather than
// needing a separate check.
const PRICE_PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Parses user input into integer minor units, or `null` if it is not a valid
 * price. `null` covers every rejection: junk, empty, negative, zero, and more
 * than two decimal places.
 *
 * Deliberately string-based. `Number('24.50') * 100` evaluates to
 * 2450.0000000000005 in IEEE-754 doubles, so the digits are concatenated and
 * parsed once instead of being multiplied.
 */
export function parsePriceToMinorUnits(input: string): number | null {
  const match = PRICE_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  const [, whole, fraction = ''] = match;
  const minorUnits = Number(`${whole}${fraction.padEnd(DECIMAL_PLACES, '0')}`);

  // Rejects both 0 (the DB requires price_amount > 0) and inputs long enough
  // to lose precision as a JS number.
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    return null;
  }

  return minorUnits;
}

/**
 * The inverse, for seeding the editor from a saved draft. Returns '' for a
 * draft that has no price yet, which is the correct initial value for a text
 * input.
 */
export function formatMinorUnitsForInput(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) {
    return '';
  }
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    return '';
  }

  const digits = String(minorUnits).padStart(DECIMAL_PLACES + 1, '0');
  return `${digits.slice(0, -DECIMAL_PLACES)}.${digits.slice(-DECIMAL_PLACES)}`;
}
