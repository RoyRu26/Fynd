/**
 * Money parsing and presentation for listings.
 *
 * Money is stored as integer minor units (`listings.price_amount bigint`),
 * never as a decimal, and the currency travels alongside it on every row.
 * `listings.currency` defaults to `'ILS'` and the client holds no privilege
 * to write it at all, so the default is the entire mechanism — but the
 * stored value is still what gets formatted here. Nothing in this file
 * hardcodes a single currency.
 *
 * Two distinct jobs, deliberately separate functions:
 *   * `parsePriceToMinorUnits` / `formatMinorUnitsForInput` — the editor's
 *     `TextInput` round trip. Always two decimals, '' for absent.
 *   * `formatMoney` — display. Currency-aware, drops a zero minor part.
 */

/** Minor units per major unit for the two-decimal currencies we handle. */
export const MINOR_UNITS_PER_MAJOR = 100;

const DECIMAL_PLACES = 2;

// Digits, then optionally a separator and one or two more digits. Both '.' and
// ',' are accepted: Israeli and European keyboards both produce a comma as a
// decimal separator. No sign is accepted, so negatives fail to match rather
// than needing a separate check.
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

// ============================================================
// Display formatting
// ============================================================

/**
 * Symbol per ISO 4217 code. A code absent from this map is not an error —
 * `formatMoney` falls back to prefixing the code itself ("CHF 50"), which
 * is correct, readable, and keeps an unexpected currency from crashing a
 * feed card.
 */
const CURRENCY_SYMBOL: Record<string, string> = {
  ILS: '₪',
  EUR: '€',
  USD: '$',
  GBP: '£',
};

/**
 * Minor-unit digits per code, for the currencies that are not the 2-decimal
 * default. ILS agorot, EUR cents, USD cents and GBP pence are all 2, so
 * they simply inherit `DEFAULT_MINOR_DIGITS`; zero-decimal currencies like
 * JPY would be listed here.
 */
const CURRENCY_MINOR_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
};

const DEFAULT_MINOR_DIGITS = 2;

/**
 * The bare symbol for a currency code, falling back to the code itself.
 *
 * For labelling an input whose value is in major units ("Price (₪)"), where
 * `formatMoney` would be wrong because there is no amount to format yet.
 */
export function currencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOL[currencyCode] ?? currencyCode;
}

/**
 * Formats integer minor units for display, using the listing's own stored
 * currency.
 *
 * ```
 * formatMoney(5000,  'ILS') -> '₪50'
 * formatMoney(5025,  'ILS') -> '₪50.25'
 * formatMoney(5020,  'ILS') -> '₪50.20'
 * formatMoney(0,     'ILS') -> '₪0'
 * formatMoney(1234567,'ILS') -> '₪12,345.67'
 * formatMoney(5000,  'EUR') -> '€50'
 * formatMoney(5000,  'CHF') -> 'CHF 50'
 * ```
 *
 * A zero minor part is dropped, because '₪50' is what a price reads like on
 * a marketplace card and '₪50.00' is what it reads like on an invoice. A
 * non-zero minor part always keeps its full width ('₪50.20', never
 * '₪50.2').
 *
 * Entirely string-based, like the parser above: no division, no
 * multiplication, no `Number` round-tripping through a decimal. That is not
 * stylistic — `5025 / 100` is representable, but the moment a formatter
 * starts doing float arithmetic on money it acquires a class of bug that is
 * very hard to notice and very embarrassing to ship.
 *
 * Deliberately NOT `Intl.NumberFormat`. Hermes does ship Intl, but it
 * delegates to Apple Foundation on iOS and android.icu on Android, while
 * these tests run on Node's full ICU — three implementations, of which a
 * test can only ever assert one. The divergence is real and measurable: for
 * ILS, `he-IL` emits two invisible U+200F directional marks and a
 * non-breaking space around the symbol, where `en-US` emits a clean '₪50'.
 * A hand-rolled formatter is identical everywhere.
 */
export function formatMoney(minorUnits: number, currencyCode: string): string {
  const digitCount = CURRENCY_MINOR_DIGITS[currencyCode] ?? DEFAULT_MINOR_DIGITS;
  const symbol = CURRENCY_SYMBOL[currencyCode];
  // An unknown code prefixes the code plus a space; a known one needs no
  // separator, since currency symbols sit flush against the number.
  const prefix = symbol ?? `${currencyCode} `;

  // Truncated rather than rounded, and the sign handled separately so the
  // digit string below is always unsigned. `price_amount > 0` is a database
  // constraint, so neither a negative nor a fractional input is reachable
  // from a real listing -- this is here so the function is total, not
  // because the case is expected.
  const negative = minorUnits < 0;
  const magnitude = Math.abs(Math.trunc(minorUnits)) || 0;
  const sign = negative && magnitude !== 0 ? '-' : '';

  if (digitCount === 0) {
    return `${sign}${prefix}${groupThousands(String(magnitude))}`;
  }

  const digits = String(magnitude).padStart(digitCount + 1, '0');
  const major = groupThousands(digits.slice(0, -digitCount));
  const minor = digits.slice(-digitCount);

  if (/^0+$/.test(minor)) {
    return `${sign}${prefix}${major}`;
  }
  return `${sign}${prefix}${major}.${minor}`;
}

/** Inserts thousands separators into an unsigned integer digit string. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
