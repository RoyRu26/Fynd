import { isolate } from '@/features/brands/brands';
import type { AttributeKind, AttributeVocabulary } from '@/features/listings/attributes';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { formatMoney, parsePriceToMinorUnits } from '@/features/listings/price';
import { formatSizeLabel } from '@/features/listings/size';
import {
  EMPTY_TERM_FILTERS,
  normalizeFilterIds,
  type AttributeTermFilters,
  type BrandFilterValue,
  type SearchFilters,
  type SearchSort,
} from '@/features/search/search';

/**
 * Pure Explore-screen logic (ROADMAP 2.3, 7.4): the filter state the screen
 * commits/drafts, deriving the active-filter chip row, removing one filter,
 * and the price-range text input's validation -- none of it
 * react-native/`@/lib/supabase`-aware, same split every other feature module
 * in this app uses.
 *
 * Deliberately decoupled from `features/categories/categories.ts`: the
 * category's display label is resolved by the caller (via
 * `findCategoryMatch` + `formatCategoryMatchLabel`) and passed in here
 * already-formatted, so this module never needs the full taxonomy — and
 * never needs to care that a category filter may name a whole group rather
 * than a leaf.
 */

/**
 * The filter fields Explore commits/drafts — everything in `SearchFilters`
 * except query/sort, which the screen manages separately. Brands keep their
 * names (the chip row needs a label and `search_brands` is a typeahead, not
 * a lookup), so they are stored as `{ id, name }` and reduced to ids only in
 * `toSearchFilters`.
 */
export type ExploreFilters = Pick<SearchFilters, 'categoryId' | 'condition' | 'size' | 'priceMin' | 'priceMax'> & {
  brands: readonly BrandFilterValue[];
  termIds: AttributeTermFilters;
};

export const EMPTY_EXPLORE_FILTERS: ExploreFilters = {
  categoryId: null,
  condition: null,
  size: null,
  priceMin: null,
  priceMax: null,
  brands: [],
  termIds: EMPTY_TERM_FILTERS,
};

/**
 * The `useSearch` argument. Every id list is sorted and deduped here, so two
 * selections made in different orders produce the same query key (and so
 * the same cache entry) — see queries.ts.
 */
export function toSearchFilters(filters: ExploreFilters, query: string | null, sort: SearchSort): SearchFilters {
  return {
    query,
    categoryId: filters.categoryId,
    condition: filters.condition,
    size: filters.size,
    priceMin: filters.priceMin,
    priceMax: filters.priceMax,
    sort,
    brandIds: normalizeFilterIds(filters.brands.map((brand) => brand.id)),
    termIds: {
      item_type: normalizeFilterIds(filters.termIds.item_type),
      color: normalizeFilterIds(filters.termIds.color),
      style: normalizeFilterIds(filters.termIds.style),
      material: normalizeFilterIds(filters.termIds.material),
      pattern: normalizeFilterIds(filters.termIds.pattern),
      fit: normalizeFilterIds(filters.termIds.fit),
    },
  };
}

export type ActiveFilterRemoval =
  | { type: 'categoryId' | 'condition' | 'size' | 'price' }
  | { type: 'brand'; id: string }
  | { type: 'term'; kind: AttributeKind; id: string };

export type ActiveFilterChip = {
  /** Stable and unique within the row — usable as a React key. */
  key: string;
  label: string;
  /** Names the kind too ("Remove Fit Slim filter"): a bare value like "Slim" is ambiguous out of context. */
  accessibilityLabel: string;
  removal: ActiveFilterRemoval;
};

// Every price label in this codebase hard-codes ILS (see price.ts's own
// header) -- `search_listings` has no per-row currency filter, so there is
// no other currency a price-range chip (or the Filter Sheet's own price
// inputs, in `explore.tsx`) could legitimately be labelled in. Exported so
// it has exactly one source of truth instead of being redeclared per file.
export const PRICE_CURRENCY = 'ILS';

export const UNKNOWN_FILTER_LABEL = 'Unknown filter';

// Used for the accessible name only when the vocabulary has not loaded (its
// own kind labels win otherwise), so a term chip still says which kind it is.
const FALLBACK_KIND_LABELS: Record<AttributeKind, string> = {
  item_type: 'Item type',
  color: 'Color',
  style: 'Style',
  material: 'Material',
  pattern: 'Pattern',
  fit: 'Fit',
};

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

function removeLabel(kindLabel: string, valueLabel: string): string {
  return `Remove ${kindLabel} ${valueLabel} filter`;
}

/**
 * One chip per active filter VALUE, in a fixed display order (category,
 * brands, item type, condition, size, color, style, material, pattern, fit,
 * price) -- never per-field insertion order, so the row never reshuffles
 * depending on which filter the user touched last. Price min/max collapse
 * into a single chip, since removing "the price filter" should clear both
 * bounds together.
 *
 * A term the vocabulary cannot resolve still gets a chip ("Unknown filter")
 * rather than being dropped: it is still sent to the server, so hiding it
 * would leave a live filter invisible and unremovable. The category chip is
 * the one exception, as before: its label resolves from the same taxonomy
 * the Drops row needs to render at all.
 */
export function deriveActiveFilterChips(
  filters: ExploreFilters,
  categoryLabel: string | null,
  vocab: AttributeVocabulary | undefined,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  const termChips = (kind: AttributeKind) => {
    const kindLabel = vocab?.kinds.find((info) => info.kind === kind)?.label ?? FALLBACK_KIND_LABELS[kind];
    for (const id of filters.termIds[kind]) {
      const term = vocab?.termsById.get(id);
      const label = term ? term.label : UNKNOWN_FILTER_LABEL;
      chips.push({
        key: `term:${kind}:${id}`,
        label,
        accessibilityLabel: term ? removeLabel(kindLabel, label) : `Remove unknown ${kindLabel} filter`,
        removal: { type: 'term', kind, id },
      });
    }
  };

  if (filters.categoryId !== null && categoryLabel !== null) {
    chips.push({
      key: 'categoryId',
      label: categoryLabel,
      accessibilityLabel: removeLabel('Category', categoryLabel),
      removal: { type: 'categoryId' },
    });
  }
  for (const brand of filters.brands) {
    const label = isolate(brand.name);
    chips.push({
      key: `brand:${brand.id}`,
      label,
      accessibilityLabel: removeLabel('Brand', label),
      removal: { type: 'brand', id: brand.id },
    });
  }
  termChips('item_type');
  if (filters.condition !== null) {
    const label = CONDITION_LABELS[filters.condition];
    chips.push({
      key: 'condition',
      label,
      accessibilityLabel: removeLabel('Condition', label),
      removal: { type: 'condition' },
    });
  }
  if (filters.size !== null) {
    const label = formatSizeLabel(filters.size);
    chips.push({ key: 'size', label, accessibilityLabel: removeLabel('Size', label), removal: { type: 'size' } });
  }
  termChips('color');
  termChips('style');
  termChips('material');
  termChips('pattern');
  termChips('fit');
  if (filters.priceMin !== null || filters.priceMax !== null) {
    const label = formatPriceChipLabel(filters.priceMin, filters.priceMax);
    chips.push({ key: 'price', label, accessibilityLabel: removeLabel('Price', label), removal: { type: 'price' } });
  }

  return chips;
}

/**
 * Clears one active filter, returning a new object -- `'price'` nulls BOTH
 * `priceMin` and `priceMax` together, since they are presented (and
 * removed) as the single chip `deriveActiveFilterChips` derives above; a
 * brand or term removes only that one id.
 */
export function removeFilter<T extends ExploreFilters>(filters: T, removal: ActiveFilterRemoval): T {
  switch (removal.type) {
    case 'price':
      return { ...filters, priceMin: null, priceMax: null };
    case 'brand':
      return { ...filters, brands: filters.brands.filter((brand) => brand.id !== removal.id) };
    case 'term':
      return {
        ...filters,
        termIds: { ...filters.termIds, [removal.kind]: filters.termIds[removal.kind].filter((id) => id !== removal.id) },
      };
    default:
      return { ...filters, [removal.type]: null };
  }
}

export function hasActiveFilters(filters: ExploreFilters): boolean {
  return (
    filters.categoryId !== null ||
    filters.condition !== null ||
    filters.size !== null ||
    filters.priceMin !== null ||
    filters.priceMax !== null ||
    filters.brands.length > 0 ||
    Object.values(filters.termIds).some((ids) => ids.length > 0)
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
