import { describe, expect, it } from 'vitest';

import {
  deriveActiveFilterChips,
  formatResultCount,
  getExploreEmptyCopy,
  hasActiveFilters,
  parsePriceRangeInput,
  removeFilter,
  type ActiveFilterKey,
} from '@/features/search/active-filters';
import type { SearchFilters } from '@/features/search/search';

type ExploreFilterFields = Pick<SearchFilters, 'categoryId' | 'condition' | 'size' | 'priceMin' | 'priceMax'>;

function filters(overrides: Partial<ExploreFilterFields> = {}): ExploreFilterFields {
  return {
    categoryId: null,
    condition: null,
    size: null,
    priceMin: null,
    priceMax: null,
    ...overrides,
  };
}

describe('deriveActiveFilterChips', () => {
  it('returns no chips when nothing is active', () => {
    expect(deriveActiveFilterChips(filters(), null)).toEqual([]);
  });

  it('derives a category chip from the pre-resolved label', () => {
    const chips = deriveActiveFilterChips(filters({ categoryId: 'cat-1' }), 'Women › Shoes');
    expect(chips).toEqual([{ key: 'categoryId', label: 'Women › Shoes' }]);
  });

  it('omits the category chip when the id is set but the label has not resolved yet', () => {
    expect(deriveActiveFilterChips(filters({ categoryId: 'cat-1' }), null)).toEqual([]);
  });

  it('derives a condition chip with its user-facing label', () => {
    const chips = deriveActiveFilterChips(filters({ condition: 'good' }), null);
    expect(chips).toEqual([{ key: 'condition', label: 'Good' }]);
  });

  it('derives a size chip with its user-facing label', () => {
    const chips = deriveActiveFilterChips(filters({ size: 'alpha_m' }), null);
    expect(chips).toEqual([{ key: 'size', label: 'M' }]);
  });

  it('collapses priceMin and priceMax into a single price chip', () => {
    const chips = deriveActiveFilterChips(filters({ priceMin: 1000, priceMax: 5000 }), null);
    expect(chips).toEqual([{ key: 'price', label: '₪10–₪50' }]);
  });

  it('labels a min-only price range with a trailing +', () => {
    const chips = deriveActiveFilterChips(filters({ priceMin: 1000 }), null);
    expect(chips).toEqual([{ key: 'price', label: '₪10+' }]);
  });

  it('labels a max-only price range as "Up to"', () => {
    const chips = deriveActiveFilterChips(filters({ priceMax: 5000 }), null);
    expect(chips).toEqual([{ key: 'price', label: 'Up to ₪50' }]);
  });

  it('orders chips as category, condition, size, price regardless of field order', () => {
    const chips = deriveActiveFilterChips(
      filters({ condition: 'good', size: 'alpha_m', categoryId: 'cat-1', priceMin: 1000 }),
      'Women › Shoes',
    );
    expect(chips.map((chip) => chip.key)).toEqual(['categoryId', 'condition', 'size', 'price']);
  });
});

describe('removeFilter', () => {
  it('nulls only the targeted field for categoryId/condition/size', () => {
    const base = filters({ categoryId: 'cat-1', condition: 'good', size: 'alpha_m' });
    expect(removeFilter(base, 'categoryId')).toEqual(filters({ condition: 'good', size: 'alpha_m' }));
    expect(removeFilter(base, 'condition')).toEqual(filters({ categoryId: 'cat-1', size: 'alpha_m' }));
    expect(removeFilter(base, 'size')).toEqual(filters({ categoryId: 'cat-1', condition: 'good' }));
  });

  it('nulls both priceMin and priceMax for key "price"', () => {
    const base = filters({ priceMin: 1000, priceMax: 5000 });
    expect(removeFilter(base, 'price')).toEqual(filters());
  });

  it('returns a new object rather than mutating the input', () => {
    const base = filters({ condition: 'good' });
    const result = removeFilter(base, 'condition');
    expect(result).not.toBe(base);
    expect(base.condition).toBe('good');
  });

  it.each<ActiveFilterKey>(['categoryId', 'condition', 'size', 'price'])(
    'is a no-op shape-wise when the field is already null (%s)',
    (key) => {
      expect(removeFilter(filters(), key)).toEqual(filters());
    },
  );
});

describe('hasActiveFilters', () => {
  it('is false when every field is null', () => {
    expect(hasActiveFilters(filters())).toBe(false);
  });

  it.each<[string, Partial<ExploreFilterFields>]>([
    ['categoryId', { categoryId: 'cat-1' }],
    ['condition', { condition: 'good' }],
    ['size', { size: 'alpha_m' }],
    ['priceMin', { priceMin: 1000 }],
    ['priceMax', { priceMax: 5000 }],
  ])('is true when %s is set', (_name, overrides) => {
    expect(hasActiveFilters(filters(overrides))).toBe(true);
  });
});

describe('parsePriceRangeInput', () => {
  it('returns null/null for two blank inputs', () => {
    expect(parsePriceRangeInput('', '')).toEqual({ priceMin: null, priceMax: null });
  });

  it('parses a min-only input into minor units', () => {
    expect(parsePriceRangeInput('10', '')).toEqual({ priceMin: 1000, priceMax: null });
  });

  it('parses a max-only input into minor units', () => {
    expect(parsePriceRangeInput('', '50.50')).toEqual({ priceMin: null, priceMax: 5050 });
  });

  it('parses both bounds into minor units', () => {
    expect(parsePriceRangeInput('10', '50')).toEqual({ priceMin: 1000, priceMax: 5000 });
  });

  it('allows an equal min and max (a valid single-price search)', () => {
    expect(parsePriceRangeInput('25', '25')).toEqual({ priceMin: 2500, priceMax: 2500 });
  });

  it('errors on an unparseable minimum', () => {
    const result = parsePriceRangeInput('abc', '');
    expect(result.error).toBe('Enter a valid minimum price.');
  });

  it('errors on an unparseable maximum', () => {
    const result = parsePriceRangeInput('', 'abc');
    expect(result.error).toBe('Enter a valid maximum price.');
  });

  it('errors when min is greater than max', () => {
    const result = parsePriceRangeInput('50', '10');
    expect(result.error).toBe('Minimum price must not be greater than the maximum.');
  });

  it('rejects a zero or negative minimum the same way the editor does', () => {
    expect(parsePriceRangeInput('0', '').error).toBeDefined();
    expect(parsePriceRangeInput('-5', '').error).toBeDefined();
  });
});

describe('getExploreEmptyCopy', () => {
  it('returns search/filter-specific copy when a search or filter is active', () => {
    const copy = getExploreEmptyCopy(true);
    expect(copy.title).toBe('No listings match.');
    expect(copy.body.length).toBeGreaterThan(0);
  });

  it('returns catalog-wide copy when nothing is active', () => {
    const copy = getExploreEmptyCopy(false);
    expect(copy.title).toBe('No active listings on Fynd yet.');
    expect(copy.body.length).toBeGreaterThan(0);
  });
});

describe('formatResultCount', () => {
  it('shows nothing when there are no results', () => {
    expect(formatResultCount(0, false)).toBeNull();
    expect(formatResultCount(0, true)).toBeNull();
  });

  it('reports an exact count when every page is loaded', () => {
    expect(formatResultCount(24, false)).toBe('24 results');
    expect(formatResultCount(312, false)).toBe('312 results');
  });

  // The honesty rule: with another page outstanding the loaded count is a
  // floor, not a total, so it must not be printed as if it were one.
  it('marks the count as a floor while more pages exist', () => {
    expect(formatResultCount(24, true)).toBe('24+ results');
  });

  it('singularises only a complete count of one', () => {
    expect(formatResultCount(1, false)).toBe('1 result');
    // "1+ result" would read as though one is the total.
    expect(formatResultCount(1, true)).toBe('1+ results');
  });

  it('returns lower-case copy, leaving the uppercase styling to the caller', () => {
    expect(formatResultCount(12, false)).toBe(formatResultCount(12, false)?.toLowerCase());
  });
});
