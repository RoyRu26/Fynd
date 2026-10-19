import { describe, expect, it } from 'vitest';

import {
  associateSellerAvatarUrl,
  associateSellerListingCoverUrls,
  deriveNextSellerListingsOffset,
  normalizeSellerListingRow,
  normalizeSellerProfileRow,
  type NormalizedSellerListing,
  type NormalizedSellerProfile,
  type SellerListingRow,
  type SellerListingsPage,
  type SellerProfileRow,
} from '@/features/seller-profile/profile';

function profileRow(overrides: Partial<SellerProfileRow> = {}): SellerProfileRow {
  return {
    id: 'seller-1',
    username: 'roy',
    display_name: 'Roy',
    avatar_path: 'seller-1/avatar.jpg',
    ...overrides,
  };
}

function listingRow(overrides: Partial<SellerListingRow> = {}): SellerListingRow {
  return {
    id: 'listing-1',
    title: 'Vintage denim jacket',
    price_amount: 2450,
    currency: 'ILS',
    listing_images: [{ storage_path: 'seller-1/listing-1/cover.jpg', position: 0 }],
    ...overrides,
  };
}

function normalizedListing(overrides: Partial<NormalizedSellerListing> = {}): NormalizedSellerListing {
  return {
    listingId: 'listing-1',
    title: 'Vintage denim jacket',
    priceAmount: 2450,
    currency: 'ILS',
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    ...overrides,
  };
}

describe('normalizeSellerProfileRow', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeSellerProfileRow(profileRow())).toEqual({
      sellerId: 'seller-1',
      username: 'roy',
      displayName: 'Roy',
      avatarPath: 'seller-1/avatar.jpg',
    });
  });

  it('returns null when the seller id does not resolve to a row', () => {
    expect(normalizeSellerProfileRow(null)).toBeNull();
  });

  it('passes a genuinely null username and display_name through as null', () => {
    const result = normalizeSellerProfileRow(
      profileRow({ username: null, display_name: null }),
    );
    expect(result?.username).toBeNull();
    expect(result?.displayName).toBeNull();
  });
});

describe('associateSellerAvatarUrl', () => {
  function normalizedProfile(overrides: Partial<NormalizedSellerProfile> = {}): NormalizedSellerProfile {
    return {
      sellerId: 'seller-1',
      username: 'roy',
      displayName: 'Roy',
      avatarPath: 'seller-1/avatar.jpg',
      ...overrides,
    };
  }

  it('resolves avatarUrl when the path has a matching signed url', () => {
    const result = associateSellerAvatarUrl(normalizedProfile(), {
      'seller-1/avatar.jpg': 'https://example.com/avatar.jpg',
    });
    expect(result).toEqual({ ...normalizedProfile(), avatarUrl: 'https://example.com/avatar.jpg' });
  });

  it('resolves avatarUrl to null when avatarPath is null, never throwing', () => {
    const profile = normalizedProfile({ avatarPath: null });
    expect(() => associateSellerAvatarUrl(profile, {})).not.toThrow();
    expect(associateSellerAvatarUrl(profile, {}).avatarUrl).toBeNull();
  });

  it('resolves avatarUrl to null when the path fails to resolve a signed url, never throwing', () => {
    const profile = normalizedProfile({ avatarPath: 'seller-1/avatar.jpg' });
    expect(() => associateSellerAvatarUrl(profile, {})).not.toThrow();
    expect(associateSellerAvatarUrl(profile, {}).avatarUrl).toBeNull();
  });
});

describe('normalizeSellerListingRow', () => {
  it('maps every field and takes the embedded image as the cover', () => {
    expect(normalizeSellerListingRow(listingRow())).toEqual({
      listingId: 'listing-1',
      title: 'Vintage denim jacket',
      priceAmount: 2450,
      currency: 'ILS',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
    });
  });

  // listings_complete_when_not_draft guarantees title/price_amount are
  // non-null on every active row — the query this normalizes already
  // filters to status = 'active', so a null here means that guarantee was
  // violated, not a value to silently default.
  it.each(['title', 'price_amount'] as const)('throws if an active row is missing %s', (field) => {
    expect(() => normalizeSellerListingRow(listingRow({ [field]: null }))).toThrow();
  });

  // publish_listing's own photo requirement guarantees at least one image
  // on every active listing.
  it('throws if an active row has no cover image', () => {
    expect(() => normalizeSellerListingRow(listingRow({ listing_images: [] }))).toThrow();
  });
});

describe('associateSellerListingCoverUrls', () => {
  it("attaches each listing's resolved cover URL", () => {
    const result = associateSellerListingCoverUrls([normalizedListing()], {
      'seller-1/listing-1/cover.jpg': 'https://example.com/cover.jpg',
    });
    expect(result).toEqual([{ ...normalizedListing(), coverUrl: 'https://example.com/cover.jpg' }]);
  });

  it('throws rather than returning a tile with a broken photo', () => {
    expect(() => associateSellerListingCoverUrls([normalizedListing()], {})).toThrow();
  });
});

describe('deriveNextSellerListingsOffset', () => {
  function page(overrides: Partial<SellerListingsPage> = {}): SellerListingsPage {
    return {
      listings: [normalizedListing() as never],
      totalCount: 100,
      ...overrides,
    };
  }

  it('advances by the page length when more remain', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextSellerListingsOffset(0, fullPage, 12)).toBe(12);
  });

  it('returns null when the page came back shorter than the page size', () => {
    const shortPage = { listings: new Array(5).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextSellerListingsOffset(0, shortPage, 12)).toBeNull();
  });

  it('returns null once the running total reaches totalCount, even on a full page', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 12 };
    expect(deriveNextSellerListingsOffset(0, fullPage, 12)).toBeNull();
  });

  it('returns null for a seller with zero active listings', () => {
    expect(deriveNextSellerListingsOffset(0, page({ listings: [], totalCount: 0 }), 12)).toBeNull();
  });
});
