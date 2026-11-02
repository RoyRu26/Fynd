import { describe, expect, it } from 'vitest';

import { isolate } from '@/features/brands/brands';
import { normalizeVocabulary, type AttributeVocabulary } from '@/features/listings/attributes';
import {
  deriveActiveFilterChips,
  EMPTY_EXPLORE_FILTERS,
  getExploreEmptyCopy,
  hasActiveFilters,
  parsePriceRangeInput,
  removeFilter,
  toSearchFilters,
  UNKNOWN_FILTER_LABEL,
  type ActiveFilterRemoval,
  type ExploreFilters,
} from '@/features/search/active-filters';
import { EMPTY_TERM_FILTERS, type AttributeTermFilters } from '@/features/search/search';

function filters(overrides: Partial<ExploreFilters> = {}): ExploreFilters {
  return { ...EMPTY_EXPLORE_FILTERS, ...overrides };
}

function terms(overrides: Partial<Record<keyof AttributeTermFilters, string[]>>): AttributeTermFilters {
  return { ...EMPTY_TERM_FILTERS, ...overrides };
}

function vocab(): AttributeVocabulary {
  return normalizeVocabulary({
    kinds: [
      { kind: 'item_type', label: 'Item type', max_values: 1, position: 0 },
      { kind: 'color', label: 'Color', max_values: 3, position: 1 },
      { kind: 'fit', label: 'Fit', max_values: 1, position: 5 },
    ],
    terms: [
      { id: 'hoodie', kind: 'item_type', slug: 'hoodie', label: 'Hoodie', position: 0, retired_at: null },
      { id: 'black', kind: 'color', slug: 'black', label: 'Black', position: 0, retired_at: null },
      { id: 'white', kind: 'color', slug: 'white', label: 'White', position: 1, retired_at: null },
      { id: 'slim', kind: 'fit', slug: 'slim', label: 'Slim', position: 0, retired_at: null },
    ],
    kindCategories: [],
    itemTypeCategories: [],
  });
}

describe('deriveActiveFilterChips', () => {
  it('returns no chips when nothing is active', () => {
    expect(deriveActiveFilterChips(filters(), null, vocab())).toEqual([]);
  });

  it('derives a category chip from the pre-resolved label', () => {
    const chips = deriveActiveFilterChips(filters({ categoryId: 'cat-1' }), 'Women › Shoes', undefined);
    expect(chips).toEqual([
      {
        key: 'categoryId',
        label: 'Women › Shoes',
        accessibilityLabel: 'Remove Category Women › Shoes filter',
        removal: { type: 'categoryId' },
      },
    ]);
  });

  it('omits the category chip when the id is set but the label has not resolved yet', () => {
    expect(deriveActiveFilterChips(filters({ categoryId: 'cat-1' }), null, undefined)).toEqual([]);
  });

  it('derives a condition chip with its user-facing label', () => {
    const [chip] = deriveActiveFilterChips(filters({ condition: 'good' }), null, undefined);
    expect(chip).toMatchObject({ key: 'condition', label: 'Good', removal: { type: 'condition' } });
  });

  it('derives a size chip with its user-facing label', () => {
    const [chip] = deriveActiveFilterChips(filters({ size: 'alpha_m' }), null, undefined);
    expect(chip).toMatchObject({ key: 'size', label: 'M', accessibilityLabel: 'Remove Size M filter' });
  });

  it('collapses priceMin and priceMax into a single price chip', () => {
    const chips = deriveActiveFilterChips(filters({ priceMin: 1000, priceMax: 5000 }), null, undefined);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ key: 'price', label: '₪10–₪50', removal: { type: 'price' } });
  });

  it('labels a min-only price range with a trailing +', () => {
    const [chip] = deriveActiveFilterChips(filters({ priceMin: 1000 }), null, undefined);
    expect(chip.label).toBe('₪10+');
  });

  it('labels a max-only price range as "Up to"', () => {
    const [chip] = deriveActiveFilterChips(filters({ priceMax: 5000 }), null, undefined);
    expect(chip.label).toBe('Up to ₪50');
  });

  it('makes one chip per brand and per term, in the fixed kind order', () => {
    const chips = deriveActiveFilterChips(
      filters({
        priceMin: 1000,
        termIds: terms({ fit: ['slim'], color: ['black', 'white'], item_type: ['hoodie'] }),
        size: 'alpha_m',
        condition: 'good',
        brands: [
          { id: 'b1', name: 'Nike' },
          { id: 'b2', name: 'Zara' },
        ],
        categoryId: 'cat-1',
      }),
      'Women › Tops',
      vocab(),
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      'categoryId',
      'brand:b1',
      'brand:b2',
      'term:item_type:hoodie',
      'condition',
      'size',
      'term:color:black',
      'term:color:white',
      'term:fit:slim',
      'price',
    ]);
  });

  it('names the kind in a term chip\'s accessible label', () => {
    const [chip] = deriveActiveFilterChips(filters({ termIds: terms({ fit: ['slim'] }) }), null, vocab());
    expect(chip).toEqual({
      key: 'term:fit:slim',
      label: 'Slim',
      accessibilityLabel: 'Remove Fit Slim filter',
      removal: { type: 'term', kind: 'fit', id: 'slim' },
    });
  });

  it('isolates brand names for bidi-safe labels', () => {
    const [chip] = deriveActiveFilterChips(filters({ brands: [{ id: 'b1', name: 'נייקי' }] }), null, vocab());
    expect(chip.label).toBe(isolate('נייקי'));
    expect(chip.accessibilityLabel).toBe(`Remove Brand ${isolate('נייקי')} filter`);
    expect(chip.removal).toEqual({ type: 'brand', id: 'b1' });
  });

  it('keeps an unresolved term as an "Unknown filter" chip rather than dropping it', () => {
    const withVocab = deriveActiveFilterChips(filters({ termIds: terms({ color: ['gone'] }) }), null, vocab());
    expect(withVocab).toEqual([
      {
        key: 'term:color:gone',
        label: UNKNOWN_FILTER_LABEL,
        accessibilityLabel: 'Remove unknown Color filter',
        removal: { type: 'term', kind: 'color', id: 'gone' },
      },
    ]);
    const noVocab = deriveActiveFilterChips(filters({ termIds: terms({ color: ['black'] }) }), null, undefined);
    expect(noVocab).toHaveLength(1);
    expect(noVocab[0].label).toBe(UNKNOWN_FILTER_LABEL);
  });
});

describe('removeFilter', () => {
  it('nulls only the targeted field for categoryId/condition/size', () => {
    const base = filters({ categoryId: 'cat-1', condition: 'good', size: 'alpha_m' });
    expect(removeFilter(base, { type: 'categoryId' })).toEqual(filters({ condition: 'good', size: 'alpha_m' }));
    expect(removeFilter(base, { type: 'condition' })).toEqual(filters({ categoryId: 'cat-1', size: 'alpha_m' }));
    expect(removeFilter(base, { type: 'size' })).toEqual(filters({ categoryId: 'cat-1', condition: 'good' }));
  });

  it('nulls both priceMin and priceMax for "price"', () => {
    const base = filters({ priceMin: 1000, priceMax: 5000 });
    expect(removeFilter(base, { type: 'price' })).toEqual(filters());
  });

  it('removes only the one brand', () => {
    const base = filters({
      brands: [
        { id: 'b1', name: 'Nike' },
        { id: 'b2', name: 'Zara' },
      ],
    });
    expect(removeFilter(base, { type: 'brand', id: 'b1' }).brands).toEqual([{ id: 'b2', name: 'Zara' }]);
  });

  it('removes only the one term, leaving its kind and other kinds intact', () => {
    const base = filters({ termIds: terms({ color: ['black', 'white'], fit: ['slim'] }) });
    expect(removeFilter(base, { type: 'term', kind: 'color', id: 'black' }).termIds).toEqual(
      terms({ color: ['white'], fit: ['slim'] }),
    );
  });

  it('returns a new object rather than mutating the input', () => {
    const base = filters({ condition: 'good' });
    const result = removeFilter(base, { type: 'condition' });
    expect(result).not.toBe(base);
    expect(base.condition).toBe('good');
  });

  it.each<ActiveFilterRemoval>([
    { type: 'categoryId' },
    { type: 'condition' },
    { type: 'size' },
    { type: 'price' },
    { type: 'brand', id: 'b1' },
    { type: 'term', kind: 'color', id: 'black' },
  ])('is a no-op shape-wise when the filter is not set (%o)', (removal) => {
    expect(removeFilter(filters(), removal)).toEqual(filters());
  });
});

describe('hasActiveFilters', () => {
  it('is false when every field is empty', () => {
    expect(hasActiveFilters(filters())).toBe(false);
  });

  it.each<[string, Partial<ExploreFilters>]>([
    ['categoryId', { categoryId: 'cat-1' }],
    ['condition', { condition: 'good' }],
    ['size', { size: 'alpha_m' }],
    ['priceMin', { priceMin: 1000 }],
    ['priceMax', { priceMax: 5000 }],
    ['brands', { brands: [{ id: 'b1', name: 'Nike' }] }],
    ['termIds', { termIds: terms({ pattern: ['striped'] }) }],
  ])('is true when %s is set', (_name, overrides) => {
    expect(hasActiveFilters(filters(overrides))).toBe(true);
  });
});

describe('toSearchFilters', () => {
  it('carries query and sort and reduces brands to ids', () => {
    const result = toSearchFilters(filters({ brands: [{ id: 'b1', name: 'Nike' }] }), 'denim', 'price');
    expect(result.query).toBe('denim');
    expect(result.sort).toBe('price');
    expect(result.brandIds).toEqual(['b1']);
  });

  it('is independent of selection order, so the query key is stable', () => {
    const a = toSearchFilters(
      filters({
        brands: [
          { id: 'b2', name: 'Zara' },
          { id: 'b1', name: 'Nike' },
        ],
        termIds: terms({ color: ['white', 'black'] }),
      }),
      null,
      'newest',
    );
    const b = toSearchFilters(
      filters({
        brands: [
          { id: 'b1', name: 'Nike' },
          { id: 'b2', name: 'Zara' },
        ],
        termIds: terms({ color: ['black', 'white', 'black'] }),
      }),
      null,
      'newest',
    );
    expect(a).toEqual(b);
    expect(a.termIds.color).toEqual(['black', 'white']);
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
