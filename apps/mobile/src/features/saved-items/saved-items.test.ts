import { describe, expect, it } from 'vitest';

import {
  associateSavedListingCoverUrls,
  deriveNextSavedListingsOffset,
  normalizeSavedListingRow,
  type NormalizedSavedListing,
  type SavedListingRow,
  type SavedListingsPage,
} from '@/features/saved-items/saved-items';

function listingRow(overrides: Partial<SavedListingRow> = {}): SavedListingRow {
  return {
    id: 'listing-1',
    title: 'Vintage denim jacket',
    price_amount: 2450,
    currency: 'ILS',
    listing_images: [{ storage_path: 'seller-1/listing-1/cover.jpg', position: 0 }],
    ...overrides,
  };
}

function normalizedListing(overrides: Partial<NormalizedSavedListing> = {}): NormalizedSavedListing {
  return {
    listingId: 'listing-1',
    title: 'Vintage denim jacket',
    priceAmount: 2450,
    currency: 'ILS',
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    ...overrides,
  };
}

describe('normalizeSavedListingRow', () => {
  it('maps every field and takes the embedded image as the cover', () => {
    expect(normalizeSavedListingRow(listingRow())).toEqual({
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
    expect(() => normalizeSavedListingRow(listingRow({ [field]: null }))).toThrow();
  });

  // publish_listing's own photo requirement guarantees at least one image
  // on every active listing.
  it('throws if an active row has no cover image', () => {
    expect(() => normalizeSavedListingRow(listingRow({ listing_images: [] }))).toThrow();
  });
});

describe('associateSavedListingCoverUrls', () => {
  it("attaches each listing's resolved cover URL", () => {
    const result = associateSavedListingCoverUrls([normalizedListing()], {
      'seller-1/listing-1/cover.jpg': 'https://example.com/cover.jpg',
    });
    expect(result).toEqual([{ ...normalizedListing(), coverUrl: 'https://example.com/cover.jpg' }]);
  });

  it('throws rather than returning a tile with a broken photo', () => {
    expect(() => associateSavedListingCoverUrls([normalizedListing()], {})).toThrow();
  });
});

describe('deriveNextSavedListingsOffset', () => {
  function page(overrides: Partial<SavedListingsPage> = {}): SavedListingsPage {
    return {
      listings: [normalizedListing() as never],
      totalCount: 100,
      ...overrides,
    };
  }

  it('advances by the page length when more remain', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextSavedListingsOffset(0, fullPage, 12)).toBe(12);
  });

  it('returns null when the page came back shorter than the page size', () => {
    const shortPage = { listings: new Array(5).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextSavedListingsOffset(0, shortPage, 12)).toBeNull();
  });

  it('returns null once the running total reaches totalCount, even on a full page', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 12 };
    expect(deriveNextSavedListingsOffset(0, fullPage, 12)).toBeNull();
  });

  it('returns null for a user with zero saved active listings', () => {
    expect(deriveNextSavedListingsOffset(0, page({ listings: [], totalCount: 0 }), 12)).toBeNull();
  });
});
