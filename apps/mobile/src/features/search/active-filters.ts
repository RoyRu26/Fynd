import { CONDITION_LABELS } from '@/features/listings/condition';
import { formatMoney, parsePriceToMinorUnits } from '@/features/listings/price';
import { formatSizeLabel } from '@/features/listings/size';
import type { SearchFilters } from '@/features/search/search';

/**
 * Pure Explore-screen logic (ROADMAP 2.3): deriving the active-filter chip
 * row, removing one filter, and the price-range text input's validation --
 * none of it react-native/`@/lib/supabase`-aware, same split every other
 * feature module in this app uses.
 *
 * Deliberately decoupled from `features/categories/categories.ts`: the
 * category's display label is resolved by the caller (via
 * `findCategoryMatch` + `formatCategoryMatchLabel`) and passed in here
 * already-formatted, so this module never needs the full taxonomy — and
 * never needs to care that a category filter may name a whole group rather
 * than a leaf.
 */

type ExploreFilterFields = Pick<SearchFilters, 'categoryId' | 'condition' | 'size' | 'priceMin' | 'priceMax'>;

export type ActiveFilterKey = 'categoryId' | 'condition' | 'size' | 'price';

export type ActiveFilterChip = { key: ActiveFilterKey; label: string };

// Every price label in this codebase hard-codes ILS (see price.ts's own
// header) -- `search_listings` has no per-row currency filter, so there is
// no other currency a price-range chip (or the Filter Sheet's own price
// inputs, in `explore.tsx`) could legitimately be labelled in. Exported so
// it has exactly one source of truth instead of being redeclared per file.
export const PRICE_CURRENCY = 'ILS';

function formatPriceChipLabel(priceMin: number | null, priceMax: number | null): string {
  if (priceMin !== null && priceMax !== null) {
    return `${formatMoney(priceMin, PRICE_CURRENCY)}–${formatMoney(priceMax, PRICE_CURRENCY)}`;
  }
  if (priceMin !== null) {
    return `${formatMoney(priceMin, PRICE_CURRENCY)}+`;
  }
  // priceMax !== null is the only remaining case a caller should reach this
  // with -- see hasActiveFilters/deriveActiveFilterChips, which never call
  // this when both bounds are null.
  return `Up to ${formatMoney(priceMax as number, PRICE_CURRENCY)}`;
}

/**
 * One chip per active filter, in a fixed display order (category,
 * condition, size, price) -- never per-field insertion order, so the row
 * never reshuffles depending on which filter the seller touched last. Price
 * min/max collapse into a single chip (`key: 'price'`), since removing
 * "the price filter" should clear both bounds together, not surface two
 * near-duplicate chips for one concept.
 */
export function deriveActiveFilterChips(
  filters: ExploreFilterFields,
  categoryLabel: string | null,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.categoryId !== null && categoryLabel !== null) {
    chips.push({ key: 'categoryId', label: categoryLabel });
  }
  if (filters.condition !== null) {
    chips.push({ key: 'condition', label: CONDITION_LABELS[filters.condition] });
  }
  if (filters.size !== null) {
    chips.push({ key: 'size', label: formatSizeLabel(filters.size) });
  }
  if (filters.priceMin !== null || filters.priceMax !== null) {
    chips.push({ key: 'price', label: formatPriceChipLabel(filters.priceMin, filters.priceMax) });
  }

  return chips;
}

/**
 * Clears one active filter, returning a new object -- `'price'` nulls BOTH
 * `priceMin` and `priceMax` together, since they are presented (and
 * removed) as the single chip `deriveActiveFilterChips` derives above.
 */
export function removeFilter<T extends ExploreFilterFields>(filters: T, key: ActiveFilterKey): T {
  if (key === 'price') {
    return { ...filters, priceMin: null, priceMax: null };
  }
  return { ...filters, [key]: null };
}

export function hasActiveFilters(filters: ExploreFilterFields): boolean {
  return (
    filters.categoryId !== null ||
    filters.condition !== null ||
    filters.size !== null ||
    filters.priceMin !== null ||
    filters.priceMax !== null
  );
}

export type ParsedPriceRange =
  | { priceMin: number | null; priceMax: number | null; error?: undefined }
  | { priceMin?: undefined; priceMax?: undefined; error: string };

/**
 * Parses the Filter Sheet's two price `TextField`s into `SearchFilters`'
 * `priceMin`/`priceMax` shape (integer minor units), via the exact same
 * `parsePriceToMinorUnits` the Sell form's price field uses -- never a raw
 * `Number()` on money.
 *
 * A blank field means "no bound", not an error -- most sellers narrow by
 * only one end. Mirrors `search_listings`'s own server-side rejection
 * (`p_price_min is not null and p_price_max is not null and p_price_min >
 * p_price_max` -- see supabase/migrations/20261018104807_search_listings_rpc.sql)
 * client-side, so an over-eager seller never sees that as a raw RPC
 * failure -- strictly `min > max`, so an equal min/max is a valid
 * single-price search and is deliberately allowed through.
 */
export function parsePriceRangeInput(minInput: string, maxInput: string): ParsedPriceRange {
  const minTrimmed = minInput.trim();
  const maxTrimmed = maxInput.trim();

  let priceMin: number | null = null;
  if (minTrimmed.length > 0) {
    priceMin = parsePriceToMinorUnits(minTrimmed);
    if (priceMin === null) {
      return { error: 'Enter a valid minimum price.' };
    }
  }

  let priceMax: number | null = null;
  if (maxTrimmed.length > 0) {
    priceMax = parsePriceToMinorUnits(maxTrimmed);
    if (priceMax === null) {
      return { error: 'Enter a valid maximum price.' };
    }
  }

  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    return { error: 'Minimum price must not be greater than the maximum.' };
  }

  return { priceMin, priceMax };
}

/**
 * Explore's empty-state copy (ROADMAP 2.3) -- same split
 * `features/listings/status.ts`'s `getMyListingsEmptyCopy` already makes:
 * distinct copy for "this specific search/filter combination has nothing"
 * vs. "there is nothing on Fynd to browse at all yet". Unlike My Listings,
 * Explore's default (no query, no filters) state is a deliberate full-
 * catalog browse, so the `false` branch here means the catalog itself is
 * empty, not "you haven't searched for anything".
 */
export function getExploreEmptyCopy(filtersOrQueryActive: boolean): { title: string; body: string } {
  if (filtersOrQueryActive) {
    return {
      title: 'No listings match.',
      body: 'Try a different search term or adjust your filters.',
    };
  }
  return {
    title: 'No active listings on Fynd yet.',
    body: 'Check back soon, or be the first to list something.',
  };
}
