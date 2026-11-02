import { describe, expect, it } from 'vitest';

import type { CategoryGroup } from '@/features/categories/categories';
import { normalizeVocabulary, type AttributeVocabulary } from '@/features/listings/attributes';
import {
  anyKindLabel,
  assertFilterIdsWithinCap,
  associateSearchCoverUrls,
  buildSearchParams,
  categoryScope,
  clearTermKind,
  deriveNextSearchCursor,
  EMPTY_TERM_FILTERS,
  filterableKinds,
  filterableTerms,
  isTermKindFull,
  MAX_FILTER_IDS_PER_KIND,
  normalizeFilterIds,
  normalizeSearchRow,
  pruneTermFiltersForScope,
  toggleBrandFilter,
  toggleTermFilter,
  type AttributeTermFilters,
  type BrandFilterValue,
  type NormalizedSearchListing,
  type SearchFilters,
  type SearchListingRpcRow,
} from '@/features/search/search';

function rpcRow(overrides: Partial<SearchListingRpcRow> = {}): SearchListingRpcRow {
  return {
    listing_id: 'listing-1',
    title: 'Vintage denim jacket',
    price_amount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    category_id: 'category-1',
    created_at: '2026-01-02T10:00:00+00:00',
    cover_storage_path: 'seller-1/listing-1/cover.jpg',
    ...overrides,
  };
}

describe('normalizeSearchRow', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeSearchRow(rpcRow())).toEqual({
      listingId: 'listing-1',
      title: 'Vintage denim jacket',
      priceAmount: 2450,
      currency: 'ILS',
      condition: 'good',
      size: 'alpha_m',
      categoryId: 'category-1',
      createdAt: '2026-01-02T10:00:00+00:00',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
    });
  });
});

function normalized(overrides: Partial<NormalizedSearchListing> = {}): NormalizedSearchListing {
  return {
    listingId: 'listing-1',
    title: 'Vintage denim jacket',
    priceAmount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    categoryId: 'category-1',
    createdAt: '2026-01-02T10:00:00+00:00',
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    ...overrides,
  };
}

describe('associateSearchCoverUrls', () => {
  it('attaches each url by storage path, not by array position', () => {
    const rows = [
      normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' }),
      normalized({ listingId: 'b', coverStoragePath: 'path/b.jpg' }),
    ];
    const urlsByPath = {
      'path/b.jpg': 'https://signed/b',
      'path/a.jpg': 'https://signed/a',
      'path/unrelated.jpg': 'https://signed/unrelated',
    };

    const result = associateSearchCoverUrls(rows, urlsByPath);

    expect(result.find((r) => r.listingId === 'a')?.coverUrl).toBe('https://signed/a');
    expect(result.find((r) => r.listingId === 'b')?.coverUrl).toBe('https://signed/b');
  });

  it('preserves every other field alongside the resolved coverUrl', () => {
    const rows = [normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' })];
    const result = associateSearchCoverUrls(rows, { 'path/a.jpg': 'https://signed/a' });
    expect(result[0]).toEqual({ ...rows[0], coverUrl: 'https://signed/a' });
  });

  it('throws rather than returning a tile with a missing cover, so a broken tile is never rendered', () => {
    const rows = [normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' })];
    expect(() => associateSearchCoverUrls(rows, {})).toThrow(/listing a/);
  });

  it('returns an empty array for an empty page without error', () => {
    expect(associateSearchCoverUrls([], {})).toEqual([]);
  });
});

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    query: null,
    categoryId: null,
    condition: null,
    size: null,
    priceMin: null,
    priceMax: null,
    sort: 'newest',
    brandIds: [],
    termIds: EMPTY_TERM_FILTERS,
    ...overrides,
  };
}

function terms(overrides: Partial<Record<keyof AttributeTermFilters, string[]>>): AttributeTermFilters {
  return { ...EMPTY_TERM_FILTERS, ...overrides };
}

function ids(count: number, prefix = 'id'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index).padStart(2, '0')}`);
}

describe('buildSearchParams', () => {
  it('maps an all-null/empty filter state to a params object with every optional field undefined', () => {
    expect(buildSearchParams(filters(), null, 24)).toEqual({
      p_query: undefined,
      p_category_id: undefined,
      p_condition: undefined,
      p_size: undefined,
      p_price_min: undefined,
      p_price_max: undefined,
      p_sort: 'newest',
      p_limit: 24,
    });
  });

  it('maps a fully-populated filter state and a matching newest cursor', () => {
    const result = buildSearchParams(
      filters({
        query: 'leather jacket',
        categoryId: 'category-1',
        condition: 'good',
        size: 'alpha_m',
        priceMin: 1000,
        priceMax: 5000,
        sort: 'newest',
      }),
      { sort: 'newest', createdAt: '2026-01-02T10:00:00+00:00', id: 'listing-1' },
      24,
    );

    expect(result).toEqual({
      p_query: 'leather jacket',
      p_category_id: 'category-1',
      p_condition: 'good',
      p_size: 'alpha_m',
      p_price_min: 1000,
      p_price_max: 5000,
      p_sort: 'newest',
      p_limit: 24,
      p_cursor_created_at: '2026-01-02T10:00:00+00:00',
      p_cursor_id: 'listing-1',
    });
  });

  it('maps a fully-populated filter state and a matching price cursor', () => {
    const result = buildSearchParams(
      filters({ sort: 'price' }),
      { sort: 'price', price: 2450, id: 'listing-1' },
      24,
    );

    expect(result.p_cursor_price).toBe(2450);
    expect(result.p_cursor_id).toBe('listing-1');
    expect(result).not.toHaveProperty('p_cursor_created_at');
  });

  it('sends no cursor fields at all when the cursor is tagged for a different sort than the filters', () => {
    // The user just switched sort modes; a stale "newest" cursor must never
    // be spread into a "price"-sorted call, mirroring the RPC's own
    // server-side rejection of a cross-mode cursor.
    const result = buildSearchParams(
      filters({ sort: 'price' }),
      { sort: 'newest', createdAt: '2026-01-02T10:00:00+00:00', id: 'listing-1' },
      24,
    );

    expect(result).not.toHaveProperty('p_cursor_created_at');
    expect(result).not.toHaveProperty('p_cursor_price');
    expect(result).not.toHaveProperty('p_cursor_id');
  });

  it('sends no cursor fields when the cursor is null', () => {
    const result = buildSearchParams(filters(), null, 24);
    expect(result).not.toHaveProperty('p_cursor_created_at');
    expect(result).not.toHaveProperty('p_cursor_price');
    expect(result).not.toHaveProperty('p_cursor_id');
  });
});

describe('buildSearchParams: brand and attribute filters', () => {
  it('omits every id argument when the lists are empty', () => {
    const result = buildSearchParams(filters(), null, 24);
    for (const key of [
      'p_brand_ids',
      'p_item_type_ids',
      'p_color_ids',
      'p_style_ids',
      'p_material_ids',
      'p_pattern_ids',
      'p_fit_ids',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('maps brands to p_brand_ids and each kind to its own p_*_ids argument', () => {
    const result = buildSearchParams(
      filters({
        brandIds: ['b1'],
        termIds: terms({
          item_type: ['it'],
          color: ['c1', 'c2'],
          style: ['s'],
          material: ['m'],
          pattern: ['p'],
          fit: ['f'],
        }),
      }),
      null,
      24,
    );
    expect(result).toMatchObject({
      p_brand_ids: ['b1'],
      p_item_type_ids: ['it'],
      p_color_ids: ['c1', 'c2'],
      p_style_ids: ['s'],
      p_material_ids: ['m'],
      p_pattern_ids: ['p'],
      p_fit_ids: ['f'],
    });
  });

  it('accepts exactly the cap and throws past it, never trimming', () => {
    expect(() =>
      buildSearchParams(filters({ termIds: terms({ color: ids(MAX_FILTER_IDS_PER_KIND) }) }), null, 24),
    ).not.toThrow();
    expect(() =>
      buildSearchParams(filters({ termIds: terms({ color: ids(MAX_FILTER_IDS_PER_KIND + 1) }) }), null, 24),
    ).toThrow(/color/);
    expect(() => buildSearchParams(filters({ brandIds: ids(MAX_FILTER_IDS_PER_KIND + 1) }), null, 24)).toThrow(
      /brand/,
    );
  });

  it('leaves the cursor arguments unchanged alongside id filters', () => {
    const result = buildSearchParams(
      filters({ brandIds: ['b1'] }),
      { sort: 'newest', createdAt: '2026-01-02T10:00:00+00:00', id: 'listing-1' },
      24,
    );
    expect(result.p_cursor_created_at).toBe('2026-01-02T10:00:00+00:00');
    expect(result.p_cursor_id).toBe('listing-1');
    expect(result.p_brand_ids).toEqual(['b1']);
  });

  it('assertFilterIdsWithinCap is silent at the cap', () => {
    expect(() => assertFilterIdsWithinCap(ids(MAX_FILTER_IDS_PER_KIND), 'x')).not.toThrow();
  });
});

describe('normalizeFilterIds', () => {
  it('dedupes and sorts', () => {
    expect(normalizeFilterIds(['c', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array for an empty input', () => {
    expect(normalizeFilterIds([])).toEqual([]);
  });
});

// Two groups: Women (tops, shoes) and Home (furniture). Item types and kinds
// only ever reference leaves, as in the real vocabulary tables.
const TOPS = 'cat-women-tops';
const SHOES = 'cat-women-shoes';
const FURNITURE = 'cat-home-furniture';

const GROUPS: CategoryGroup[] = [
  {
    id: 'cat-women',
    name: 'Women',
    subcategories: [
      { id: TOPS, name: 'Tops', parentId: 'cat-women', position: 0 },
      { id: SHOES, name: 'Shoes', parentId: 'cat-women', position: 1 },
    ],
  },
  {
    id: 'cat-home',
    name: 'Home',
    subcategories: [{ id: FURNITURE, name: 'Furniture', parentId: 'cat-home', position: 0 }],
  },
];

function vocab(): AttributeVocabulary {
  return normalizeVocabulary({
    kinds: [
      { kind: 'item_type', label: 'Item type', max_values: 1, position: 0 },
      { kind: 'color', label: 'Color', max_values: 3, position: 1 },
      { kind: 'fit', label: 'Fit', max_values: 1, position: 5 },
    ],
    terms: [
      { id: 'hoodie', kind: 'item_type', slug: 'hoodie', label: 'Hoodie', position: 1, retired_at: null },
      { id: 'tee', kind: 'item_type', slug: 't_shirt', label: 'T-shirt', position: 0, retired_at: null },
      { id: 'sneakers', kind: 'item_type', slug: 'sneakers', label: 'Sneakers', position: 2, retired_at: null },
      { id: 'black', kind: 'color', slug: 'black', label: 'Black', position: 0, retired_at: null },
      { id: 'white', kind: 'color', slug: 'white', label: 'White', position: 1, retired_at: null },
      { id: 'teal', kind: 'color', slug: 'teal', label: 'Teal', position: 4, retired_at: '2026-10-01T00:00:00Z' },
      { id: 'slim', kind: 'fit', slug: 'slim', label: 'Slim', position: 0, retired_at: null },
    ],
    kindCategories: [
      { kind: 'color', category_id: TOPS },
      { kind: 'color', category_id: SHOES },
      { kind: 'fit', category_id: TOPS },
    ],
    itemTypeCategories: [
      { term_id: 'hoodie', category_id: TOPS },
      { term_id: 'tee', category_id: TOPS },
      { term_id: 'sneakers', category_id: SHOES },
    ],
  });
}

describe('categoryScope', () => {
  it('is null for no category', () => {
    expect(categoryScope(GROUPS, null)).toBeNull();
  });

  it('is the leaf itself for a leaf', () => {
    expect(categoryScope(GROUPS, SHOES)).toEqual([SHOES]);
  });

  it('is every leaf of a group', () => {
    expect(categoryScope(GROUPS, 'cat-women')).toEqual([TOPS, SHOES]);
  });

  it('is null for an id that has not resolved (categories still loading)', () => {
    expect(categoryScope([], TOPS)).toBeNull();
    expect(categoryScope(GROUPS, 'cat-unknown')).toBeNull();
  });
});

describe('filterableKinds', () => {
  it('offers every kind with an active term when there is no category', () => {
    expect(filterableKinds(vocab(), null, EMPTY_TERM_FILTERS).map((k) => k.kind)).toEqual(['item_type', 'color', 'fit']);
  });

  it('offers only the kinds that apply to a leaf', () => {
    expect(filterableKinds(vocab(), [SHOES], EMPTY_TERM_FILTERS).map((k) => k.kind)).toEqual(['item_type', 'color']);
  });

  it('offers the union of a group\'s leaves', () => {
    expect(filterableKinds(vocab(), [TOPS, SHOES], EMPTY_TERM_FILTERS).map((k) => k.kind)).toEqual(['item_type', 'color', 'fit']);
  });

  it('offers nothing for a category no kind applies to', () => {
    expect(filterableKinds(vocab(), [FURNITURE], EMPTY_TERM_FILTERS)).toEqual([]);
  });

  it('still offers a kind whose only selection is a retired term, so it can be removed', () => {
    expect(filterableKinds(vocab(), [FURNITURE], terms({ color: ['teal'] })).map((k) => k.kind)).toEqual(['color']);
  });

  it('ignores selected ids the vocabulary does not know', () => {
    expect(filterableKinds(vocab(), [FURNITURE], terms({ color: ['gone'] }))).toEqual([]);
  });
});

describe('filterableTerms', () => {
  it('hides retired terms unless they are selected', () => {
    expect(filterableTerms(vocab(), 'color', null, []).map((t) => t.id)).toEqual(['black', 'white']);
    expect(filterableTerms(vocab(), 'color', null, ['teal']).map((t) => t.id)).toEqual(['black', 'white', 'teal']);
  });

  it('offers the union of item types across a group\'s leaves', () => {
    expect(filterableTerms(vocab(), 'item_type', [TOPS, SHOES], []).map((t) => t.id)).toEqual([
      'tee',
      'hoodie',
      'sneakers',
    ]);
    expect(filterableTerms(vocab(), 'item_type', [SHOES], []).map((t) => t.id)).toEqual(['sneakers']);
  });
});

describe('toggleTermFilter', () => {
  it('selects several item types, unlike the single-value seller rule', () => {
    const v = vocab();
    const once = toggleTermFilter(v, EMPTY_TERM_FILTERS, 'tee');
    const twice = toggleTermFilter(v, once, 'hoodie');
    expect(twice.item_type).toEqual(['tee', 'hoodie']);
  });

  it('deselects a selected term', () => {
    expect(toggleTermFilter(vocab(), terms({ color: ['black', 'white'] }), 'black').color).toEqual(['white']);
  });

  it('lets a retired term be removed but never added', () => {
    const v = vocab();
    expect(toggleTermFilter(v, EMPTY_TERM_FILTERS, 'teal')).toBe(EMPTY_TERM_FILTERS);
    expect(toggleTermFilter(v, terms({ color: ['teal'] }), 'teal').color).toEqual([]);
  });

  it('is a no-op for an unknown term', () => {
    expect(toggleTermFilter(vocab(), EMPTY_TERM_FILTERS, 'nope')).toBe(EMPTY_TERM_FILTERS);
  });

  it('stops adding at the cap', () => {
    const full = terms({ color: ids(MAX_FILTER_IDS_PER_KIND) });
    expect(isTermKindFull(full, 'color')).toBe(true);
    expect(toggleTermFilter(vocab(), full, 'black')).toBe(full);
    expect(isTermKindFull(full, 'fit')).toBe(false);
  });
});

describe('clearTermKind', () => {
  it('empties only that kind', () => {
    expect(clearTermKind(terms({ color: ['black'], fit: ['slim'] }), 'color')).toEqual(terms({ fit: ['slim'] }));
  });
});

describe('pruneTermFiltersForScope', () => {
  const selection = terms({ item_type: ['tee'], color: ['black'], fit: ['slim'] });

  it('drops what stops applying when moving to another leaf', () => {
    const { kept, removed } = pruneTermFiltersForScope(vocab(), selection, [SHOES]);
    expect(kept).toEqual(terms({ color: ['black'] }));
    expect(removed.map((t) => t.id)).toEqual(['tee', 'slim']);
  });

  it('keeps everything when widening from a leaf to its group', () => {
    const result = pruneTermFiltersForScope(vocab(), selection, [TOPS, SHOES]);
    expect(result).toEqual({ kept: selection, removed: [] });
  });

  it('keeps everything for no category', () => {
    expect(pruneTermFiltersForScope(vocab(), selection, null).removed).toEqual([]);
  });

  it('changes nothing before the vocabulary has loaded', () => {
    expect(pruneTermFiltersForScope(undefined, selection, [FURNITURE])).toEqual({ kept: selection, removed: [] });
  });

  it('keeps ids the vocabulary does not know', () => {
    const { kept } = pruneTermFiltersForScope(vocab(), terms({ color: ['gone'] }), [FURNITURE]);
    expect(kept.color).toEqual(['gone']);
  });
});

describe('toggleBrandFilter', () => {
  const nike: BrandFilterValue = { id: 'b1', name: 'Nike' };

  it('adds and removes a brand', () => {
    const added = toggleBrandFilter([], nike);
    expect(added).toEqual([nike]);
    expect(toggleBrandFilter(added, nike)).toEqual([]);
  });

  it('stops adding at the cap', () => {
    const full = ids(MAX_FILTER_IDS_PER_KIND).map((id) => ({ id, name: id }));
    expect(toggleBrandFilter(full, nike)).toBe(full);
  });
});

describe('anyKindLabel', () => {
  it('lowercases the kind label', () => {
    expect(anyKindLabel({ kind: 'item_type', label: 'Item type', maxValues: 1, position: 0 })).toBe('Any item type');
    expect(anyKindLabel({ kind: 'color', label: 'Color', maxValues: 3, position: 1 })).toBe('Any color');
  });
});

describe('deriveNextSearchCursor', () => {
  const page = [
    { createdAt: '2026-01-03T00:00:00+00:00', priceAmount: 3000, listingId: 'c' },
    { createdAt: '2026-01-02T00:00:00+00:00', priceAmount: 2000, listingId: 'b' },
    { createdAt: '2026-01-01T00:00:00+00:00', priceAmount: 1000, listingId: 'a' },
  ];

  it('derives a newest-tagged cursor from the LAST row of a full page, for sort = newest', () => {
    expect(deriveNextSearchCursor(page, 3, 'newest')).toEqual({
      sort: 'newest',
      createdAt: '2026-01-01T00:00:00+00:00',
      id: 'a',
    });
  });

  it('derives a price-tagged cursor from the LAST row of a full page, for sort = price', () => {
    expect(deriveNextSearchCursor(page, 3, 'price')).toEqual({
      sort: 'price',
      price: 1000,
      id: 'a',
    });
  });

  it('returns null for a page shorter than the requested size, for both sort modes — the result set is exhausted', () => {
    expect(deriveNextSearchCursor(page, 10, 'newest')).toBeNull();
    expect(deriveNextSearchCursor(page, 10, 'price')).toBeNull();
  });

  it('returns null for a genuinely empty page', () => {
    expect(deriveNextSearchCursor([], 10, 'newest')).toBeNull();
  });

  it('still derives a cursor at the exact boundary (page length equals page size)', () => {
    expect(deriveNextSearchCursor(page, 3, 'newest')).not.toBeNull();
  });
});
