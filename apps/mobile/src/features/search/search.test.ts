import { describe, expect, it } from 'vitest';

import {
  associateSearchCoverUrls,
  buildSearchParams,
  deriveNextSearchCursor,
  normalizeSearchRow,
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
    ...overrides,
  };
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
