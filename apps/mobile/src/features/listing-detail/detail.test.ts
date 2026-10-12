import { describe, expect, it } from 'vitest';

import {
  associateListingDetailImageUrls,
  normalizeListingDetailRow,
  setFavoriteInDetail,
  type ListingDetail,
  type ListingDetailRow,
} from '@/features/listing-detail/detail';

function row(overrides: Partial<ListingDetailRow> = {}): ListingDetailRow {
  return {
    id: 'listing-1',
    title: 'Vintage denim jacket',
    description: 'Barely worn, no flaws.',
    price_amount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    status: 'active',
    seller_id: 'seller-1',
    profiles: { username: 'roy', display_name: 'Roy', avatar_path: 'seller-1/avatar.jpg' },
    listing_images: [
      { id: 'image-2', storage_path: 'seller-1/listing-1/2.jpg', position: 1 },
      { id: 'image-1', storage_path: 'seller-1/listing-1/1.jpg', position: 0 },
    ],
    favorites: [],
    ...overrides,
  };
}

function detail(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    listingId: 'listing-1',
    title: 'Vintage denim jacket',
    description: 'Barely worn, no flaws.',
    priceAmount: 2450,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    sellerId: 'seller-1',
    sellerUsername: 'roy',
    sellerDisplayName: 'Roy',
    sellerAvatarPath: 'seller-1/avatar.jpg',
    images: [{ id: 'image-1', storagePath: 'seller-1/listing-1/1.jpg', url: 'https://example.com/1' }],
    isFavorited: false,
    ...overrides,
  };
}

describe('normalizeListingDetailRow', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeListingDetailRow(row())).toEqual({
      listingId: 'listing-1',
      title: 'Vintage denim jacket',
      description: 'Barely worn, no flaws.',
      priceAmount: 2450,
      currency: 'ILS',
      condition: 'good',
      size: 'alpha_m',
      sellerId: 'seller-1',
      sellerUsername: 'roy',
      sellerDisplayName: 'Roy',
      sellerAvatarPath: 'seller-1/avatar.jpg',
      images: [
        { id: 'image-1', storagePath: 'seller-1/listing-1/1.jpg' },
        { id: 'image-2', storagePath: 'seller-1/listing-1/2.jpg' },
      ],
      isFavorited: false,
    });
  });

  it('orders images by position regardless of the row\'s own array order', () => {
    const result = normalizeListingDetailRow(row());
    expect(result?.images.map((image) => image.id)).toEqual(['image-1', 'image-2']);
  });

  it('returns an empty images array for a listing with no photos', () => {
    const result = normalizeListingDetailRow(row({ listing_images: [] }));
    expect(result?.images).toEqual([]);
  });

  it('returns null for a listing that does not exist (no row at all)', () => {
    expect(normalizeListingDetailRow(null)).toBeNull();
  });

  it.each(['draft', 'reserved', 'sold', 'removed'] as const)(
    'returns null for a %s listing, never exposing its data',
    (status) => {
      expect(normalizeListingDetailRow(row({ status }))).toBeNull();
    },
  );

  it('treats a genuinely null seller profile as null fields, not a crash', () => {
    const result = normalizeListingDetailRow(row({ profiles: null }));
    expect(result?.sellerUsername).toBeNull();
    expect(result?.sellerDisplayName).toBeNull();
    expect(result?.sellerAvatarPath).toBeNull();
  });

  it('reports favorited when the RLS-scoped favorites embed has a row', () => {
    const result = normalizeListingDetailRow(row({ favorites: [{ user_id: 'me' }] }));
    expect(result?.isFavorited).toBe(true);
  });

  it('reports not favorited when the favorites embed is empty', () => {
    const result = normalizeListingDetailRow(row({ favorites: [] }));
    expect(result?.isFavorited).toBe(false);
  });

  // listings_complete_when_not_draft guarantees these four are non-null on
  // every non-draft row — an active row violating that is a constraint
  // breach, not a value this function should silently paper over.
  it.each(['title', 'price_amount', 'condition', 'size'] as const)(
    'throws if an active row is somehow missing %s',
    (field) => {
      expect(() => normalizeListingDetailRow(row({ [field]: null }))).toThrow();
    },
  );
});

describe('associateListingDetailImageUrls', () => {
  it('attaches each image\'s resolved URL', () => {
    const normalized = normalizeListingDetailRow(row());
    if (normalized === null) throw new Error('expected a normalized detail');

    const result = associateListingDetailImageUrls(normalized, {
      'seller-1/listing-1/1.jpg': 'https://example.com/1',
      'seller-1/listing-1/2.jpg': 'https://example.com/2',
    });

    expect(result.images).toEqual([
      { id: 'image-1', storagePath: 'seller-1/listing-1/1.jpg', url: 'https://example.com/1' },
      { id: 'image-2', storagePath: 'seller-1/listing-1/2.jpg', url: 'https://example.com/2' },
    ]);
  });

  it('throws rather than returning a listing with a broken photo', () => {
    const normalized = normalizeListingDetailRow(row());
    if (normalized === null) throw new Error('expected a normalized detail');

    expect(() => associateListingDetailImageUrls(normalized, {})).toThrow();
  });
});

describe('setFavoriteInDetail', () => {
  it('flips isFavorited to true', () => {
    const current = detail({ isFavorited: false });
    expect(setFavoriteInDetail(current, true)).toEqual({ ...current, isFavorited: true });
  });

  it('flips isFavorited to false', () => {
    const current = detail({ isFavorited: true });
    expect(setFavoriteInDetail(current, false)).toEqual({ ...current, isFavorited: false });
  });

  it('returns the identical object reference when the value is already correct', () => {
    const current = detail({ isFavorited: true });
    expect(setFavoriteInDetail(current, true)).toBe(current);
  });

  it('does not mutate the input', () => {
    const current = detail({ isFavorited: false });
    const snapshot = { ...current };
    setFavoriteInDetail(current, true);
    expect(current).toEqual(snapshot);
  });
});
