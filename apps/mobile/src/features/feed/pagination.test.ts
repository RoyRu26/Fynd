import { describe, expect, it } from 'vitest';

import {
  associateAvatarUrls,
  associateCoverUrls,
  deriveNextCursor,
  normalizeFeedRow,
  type FeedListingRpcRow,
  type FeedListingWithCover,
  type NormalizedFeedRow,
} from '@/features/feed/pagination';

function rpcRow(overrides: Partial<FeedListingRpcRow> = {}): FeedListingRpcRow {
  return {
    listing_id: 'listing-1',
    title: 'Vintage denim jacket',
    price_amount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    created_at: '2026-01-02T10:00:00+00:00',
    seller_id: 'seller-1',
    seller_username: 'roy',
    seller_display_name: 'Roy',
    seller_avatar_path: 'seller-1/avatar.jpg',
    cover_storage_path: 'seller-1/listing-1/cover.jpg',
    is_favorited: false,
    ...overrides,
  };
}

describe('normalizeFeedRow', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeFeedRow(rpcRow())).toEqual({
      listingId: 'listing-1',
      title: 'Vintage denim jacket',
      priceAmount: 2450,
      currency: 'ILS',
      condition: 'good',
      size: 'alpha_m',
      createdAt: '2026-01-02T10:00:00+00:00',
      sellerId: 'seller-1',
      sellerUsername: 'roy',
      sellerDisplayName: 'Roy',
      sellerAvatarPath: 'seller-1/avatar.jpg',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
      isFavorited: false,
    });
  });

  // The whole reason this function exists: the generated RPC row type claims
  // these three are non-null strings, but their source (profiles) is
  // genuinely nullable at runtime — a seller who hasn't finished onboarding.
  // The cast below simulates exactly that mismatch: a real row whose runtime
  // value is null despite what the generated type promises.
  it('passes a genuinely null seller_username through as null, not a crash or a coerced value', () => {
    const row = rpcRow({ seller_username: null as unknown as string });
    expect(normalizeFeedRow(row).sellerUsername).toBeNull();
  });

  it('passes a genuinely null seller_display_name through as null', () => {
    const row = rpcRow({ seller_display_name: null as unknown as string });
    expect(normalizeFeedRow(row).sellerDisplayName).toBeNull();
  });

  it('passes a genuinely null seller_avatar_path through as null', () => {
    const row = rpcRow({ seller_avatar_path: null as unknown as string });
    expect(normalizeFeedRow(row).sellerAvatarPath).toBeNull();
  });

  it('handles all three nullable seller fields being null at once', () => {
    const row = rpcRow({
      seller_username: null as unknown as string,
      seller_display_name: null as unknown as string,
      seller_avatar_path: null as unknown as string,
    });
    const normalized = normalizeFeedRow(row);
    expect(normalized.sellerUsername).toBeNull();
    expect(normalized.sellerDisplayName).toBeNull();
    expect(normalized.sellerAvatarPath).toBeNull();
    // title/price/condition are guaranteed non-null by
    // listings_complete_when_not_draft and must be untouched by this.
    expect(normalized.title).toBe('Vintage denim jacket');
    expect(normalized.priceAmount).toBe(2450);
    expect(normalized.condition).toBe('good');
  });
});

function normalized(overrides: Partial<NormalizedFeedRow> = {}): NormalizedFeedRow {
  return {
    listingId: 'listing-1',
    title: 'Vintage denim jacket',
    priceAmount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    createdAt: '2026-01-02T10:00:00+00:00',
    sellerId: 'seller-1',
    sellerUsername: 'roy',
    sellerDisplayName: 'Roy',
    sellerAvatarPath: null,
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    isFavorited: false,
    ...overrides,
  };
}

describe('associateCoverUrls', () => {
  it('attaches each url by storage path, not by array position', () => {
    const rows = [
      normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' }),
      normalized({ listingId: 'b', coverStoragePath: 'path/b.jpg' }),
    ];
    // Deliberately out of order and with an unrelated extra key, to prove
    // this is a keyed lookup, not a positional zip.
    const urlsByPath = {
      'path/b.jpg': 'https://signed/b',
      'path/a.jpg': 'https://signed/a',
      'path/unrelated.jpg': 'https://signed/unrelated',
    };

    const result = associateCoverUrls(rows, urlsByPath);

    expect(result.find((r) => r.listingId === 'a')?.coverUrl).toBe('https://signed/a');
    expect(result.find((r) => r.listingId === 'b')?.coverUrl).toBe('https://signed/b');
  });

  it('preserves every other field alongside the resolved coverUrl', () => {
    const rows = [normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' })];
    const result = associateCoverUrls(rows, { 'path/a.jpg': 'https://signed/a' });
    expect(result[0]).toEqual({ ...rows[0], coverUrl: 'https://signed/a' });
  });

  it('throws rather than returning a listing with a missing cover, so a broken card is never rendered', () => {
    const rows = [normalized({ listingId: 'a', coverStoragePath: 'path/a.jpg' })];
    expect(() => associateCoverUrls(rows, {})).toThrow(/listing a/);
  });

  it('returns an empty array for an empty page without error', () => {
    expect(associateCoverUrls([], {})).toEqual([]);
  });
});

describe('associateAvatarUrls', () => {
  function withCover(overrides: Partial<FeedListingWithCover> = {}): FeedListingWithCover {
    return { ...normalized(), coverUrl: 'https://signed/cover.jpg', ...overrides };
  }

  it('attaches each url by storage path, not by array position', () => {
    const rows = [
      withCover({ listingId: 'a', sellerAvatarPath: 'avatar/a.jpg' }),
      withCover({ listingId: 'b', sellerAvatarPath: 'avatar/b.jpg' }),
    ];
    const urlsByPath = {
      'avatar/b.jpg': 'https://signed/b',
      'avatar/a.jpg': 'https://signed/a',
    };

    const result = associateAvatarUrls(rows, urlsByPath);

    expect(result.find((r) => r.listingId === 'a')?.sellerAvatarUrl).toBe('https://signed/a');
    expect(result.find((r) => r.listingId === 'b')?.sellerAvatarUrl).toBe('https://signed/b');
  });

  it('does not throw when sellerAvatarPath is null — resolves sellerAvatarUrl to null', () => {
    const rows = [withCover({ listingId: 'a', sellerAvatarPath: null })];
    expect(() => associateAvatarUrls(rows, {})).not.toThrow();
    expect(associateAvatarUrls(rows, {})[0].sellerAvatarUrl).toBeNull();
  });

  it('does not throw when the path fails to resolve a signed url — resolves sellerAvatarUrl to null', () => {
    const rows = [withCover({ listingId: 'a', sellerAvatarPath: 'avatar/a.jpg' })];
    expect(() => associateAvatarUrls(rows, {})).not.toThrow();
    expect(associateAvatarUrls(rows, {})[0].sellerAvatarUrl).toBeNull();
  });

  it('returns an empty array for an empty page without error', () => {
    expect(associateAvatarUrls([], {})).toEqual([]);
  });
});

describe('deriveNextCursor', () => {
  const page = [
    { createdAt: '2026-01-03T00:00:00+00:00', listingId: 'c' },
    { createdAt: '2026-01-02T00:00:00+00:00', listingId: 'b' },
    { createdAt: '2026-01-01T00:00:00+00:00', listingId: 'a' },
  ];

  it('derives the cursor from the LAST row of a full page', () => {
    expect(deriveNextCursor(page, 3)).toEqual({
      createdAt: '2026-01-01T00:00:00+00:00',
      id: 'a',
    });
  });

  it('returns null for a page shorter than the requested size — the feed is exhausted', () => {
    expect(deriveNextCursor(page, 10)).toBeNull();
  });

  it('returns null for a genuinely empty page', () => {
    expect(deriveNextCursor([], 10)).toBeNull();
  });

  it('still derives a cursor at the exact boundary (page length equals page size)', () => {
    expect(deriveNextCursor(page, 3)).not.toBeNull();
  });
});
