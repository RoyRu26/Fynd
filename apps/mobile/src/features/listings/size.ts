import { Constants, type Enums } from '@/types/database';

/**
 * Size domain helpers.
 *
 * `listing_size` is a flat, prefixed enum — `system_value`, e.g. `alpha_m`,
 * `eu_shoe_42`, `one_size`. The prefix convention is what keeps one column
 * able to describe both clothing and footwear without a category-dependent
 * taxonomy, and it is also what makes these helpers derivable rather than
 * hand-maintained.
 *
 * Nothing here hardcodes the list of sizes. `LISTING_SIZES` comes from the
 * generated `Constants`, so a value added to the enum and regenerated shows
 * up automatically, and `formatSizeLabel` derives its label from the prefix
 * rather than from a parallel lookup table that could silently fall out of
 * step. `size.test.ts` walks every generated value and asserts each one
 * parses into a known system — so adding a new SYSTEM (waist sizing, say)
 * fails loudly in CI, while adding a new VALUE to an existing system needs
 * no code change at all.
 */

/** Every size the database accepts, straight from the generated enum. */
export const LISTING_SIZES = Constants.public.Enums.listing_size;

export type ListingSize = Enums<'listing_size'>;

/** The sizing systems the prefix convention currently encodes. */
export type SizeSystem = 'one_size' | 'alpha' | 'eu_shoe';

export type ParsedSize =
  | { system: 'one_size' }
  | { system: 'alpha'; value: string }
  | { system: 'eu_shoe'; value: string };

const ALPHA_PATTERN = /^alpha_(.+)$/;
const EU_SHOE_PATTERN = /^eu_shoe_(\d+)$/;

/**
 * Splits a stored size into its system and value, or `null` if the value
 * uses a system this client does not yet know about.
 *
 * `null` is the signal the drift test keys off: it should be unreachable for
 * every value the database currently defines.
 */
export function parseListingSize(size: ListingSize): ParsedSize | null {
  if (size === 'one_size') {
    return { system: 'one_size' };
  }

  const alpha = ALPHA_PATTERN.exec(size);
  if (alpha) {
    return { system: 'alpha', value: alpha[1] };
  }

  const shoe = EU_SHOE_PATTERN.exec(size);
  if (shoe) {
    return { system: 'eu_shoe', value: shoe[1] };
  }

  return null;
}

/**
 * The user-facing label. Raw enum strings must never reach the UI.
 *
 * ```
 * formatSizeLabel('alpha_m')    -> 'M'
 * formatSizeLabel('alpha_xl')   -> 'XL'
 * formatSizeLabel('eu_shoe_42') -> 'EU 42'
 * formatSizeLabel('one_size')   -> 'One size'
 * ```
 *
 * An unrecognised system still produces something readable rather than
 * leaking `waist_30` into a chip — but the drift test is what ensures that
 * branch stays unreachable in practice.
 */
export function formatSizeLabel(size: ListingSize): string {
  const parsed = parseListingSize(size);

  if (parsed === null) {
    return humanizeUnknownSize(size);
  }

  switch (parsed.system) {
    case 'one_size':
      return 'One size';
    case 'alpha':
      return parsed.value.toUpperCase();
    case 'eu_shoe':
      return `EU ${parsed.value}`;
  }
}

/** Last-resort readability for a system added to the DB but not yet here. */
function humanizeUnknownSize(size: string): string {
  const spaced = size.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Sizes bucketed by system, in enum order, for a grouped selector.
 *
 * Phase 3's Sell editor picks a system first and then a value, which is
 * what keeps a 22-option list from becoming an unusable wall of chips.
 * Built from `LISTING_SIZES` so it cannot drift. Values whose system is
 * unrecognised are omitted rather than silently grouped somewhere wrong.
 */
export function listingSizesBySystem(): Record<SizeSystem, ListingSize[]> {
  const grouped: Record<SizeSystem, ListingSize[]> = {
    one_size: [],
    alpha: [],
    eu_shoe: [],
  };

  for (const size of LISTING_SIZES) {
    const parsed = parseListingSize(size);
    if (parsed !== null) {
      grouped[parsed.system].push(size);
    }
  }

  return grouped;
}

/** Display label per system, for the selector's first row. */
export const SIZE_SYSTEM_LABELS: Record<SizeSystem, string> = {
  one_size: 'One size',
  alpha: 'Clothing',
  eu_shoe: 'Shoes',
};
