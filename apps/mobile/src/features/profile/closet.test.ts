import { describe, expect, it } from 'vitest';

import {
  associateClosetCoverUrls,
  deriveClosetHighlights,
  deriveNextClosetOffset,
  filterClosetListings,
  normalizeClosetListingRow,
  selectCollagePhotos,
  type ClosetListingRow,
  type ClosetPage,
  type NormalizedClosetListing,
} from '@/features/profile/closet';
import type { CategoryGroup } from '@/features/categories/categories';

function listingRow(overrides: Partial<ClosetListingRow> = {}): ClosetListingRow {
  return {
    id: 'listing-1',
    title: 'Wool overcoat',
    status: 'active',
    category_id: 'leaf-outerwear',
    listing_images: [{ storage_path: 'seller-1/listing-1/cover.jpg', position: 0 }],
    ...overrides,
  };
}

function normalizedListing(overrides: Partial<NormalizedClosetListing> = {}): NormalizedClosetListing {
  return {
    listingId: 'listing-1',
    title: 'Wool overcoat',
    status: 'active',
    categoryId: 'leaf-outerwear',
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    ...overrides,
  };
}

const CLOTHING_GROUP: CategoryGroup = {
  id: 'group-clothing',
  name: 'Clothing',
  subcategories: [
    { id: 'leaf-outerwear', name: 'Outerwear', parentId: 'group-clothing', position: 0 },
    { id: 'leaf-denim', name: 'Denim', parentId: 'group-clothing', position: 1 },
  ],
};
const FOOTWEAR_GROUP: CategoryGroup = {
  id: 'group-footwear',
  name: 'Footwear',
  subcategories: [{ id: 'leaf-shoes', name: 'Shoes', parentId: 'group-footwear', position: 0 }],
};
const CATEGORY_GROUPS = [CLOTHING_GROUP, FOOTWEAR_GROUP];

describe('normalizeClosetListingRow', () => {
  it('maps every field and takes the embedded image as the cover', () => {
    expect(normalizeClosetListingRow(listingRow())).toEqual({
      listingId: 'listing-1',
      title: 'Wool overcoat',
      status: 'active',
      categoryId: 'leaf-outerwear',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
    });
  });

  it('passes a null category_id through as null — a listing may have none', () => {
    expect(normalizeClosetListingRow(listingRow({ category_id: null })).categoryId).toBeNull();
  });

  // The query this normalizes already filters to active/reserved/sold,
  // every one of which went through publish_listing's own requirements.
  it('throws if a row is missing a title', () => {
    expect(() => normalizeClosetListingRow(listingRow({ title: null }))).toThrow();
  });

  it('throws if a row has no cover image', () => {
    expect(() => normalizeClosetListingRow(listingRow({ listing_images: [] }))).toThrow();
  });
});

describe('associateClosetCoverUrls', () => {
  it("attaches each listing's resolved cover URL", () => {
    const result = associateClosetCoverUrls([normalizedListing()], {
      'seller-1/listing-1/cover.jpg': 'https://example.com/cover.jpg',
    });
    expect(result).toEqual([{ ...normalizedListing(), coverUrl: 'https://example.com/cover.jpg' }]);
  });

  it('throws rather than returning a tile with a broken photo', () => {
    expect(() => associateClosetCoverUrls([normalizedListing()], {})).toThrow();
  });
});

describe('deriveNextClosetOffset', () => {
  function page(overrides: Partial<ClosetPage> = {}): ClosetPage {
    return { listings: [normalizedListing() as never], totalCount: 100, ...overrides };
  }

  it('advances by the page length when more remain', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextClosetOffset(0, fullPage, 12)).toBe(12);
  });

  it('returns null when the page came back shorter than the page size', () => {
    const shortPage = { listings: new Array(5).fill(normalizedListing()), totalCount: 100 };
    expect(deriveNextClosetOffset(0, shortPage, 12)).toBeNull();
  });

  it('returns null once the running total reaches totalCount, even on a full page', () => {
    const fullPage = { listings: new Array(12).fill(normalizedListing()), totalCount: 12 };
    expect(deriveNextClosetOffset(0, fullPage, 12)).toBeNull();
  });

  it('returns null for a genuinely empty page', () => {
    expect(deriveNextClosetOffset(0, page({ listings: [] }), 12)).toBeNull();
  });
});

describe('deriveClosetHighlights', () => {
  it('derives one highlight per distinct top-level group, in first-seen order', () => {
    const listings = [
      { categoryId: 'leaf-outerwear', status: 'active' as const },
      { categoryId: 'leaf-shoes', status: 'active' as const },
      { categoryId: 'leaf-denim', status: 'active' as const }, // same group as outerwear
    ];
    expect(deriveClosetHighlights(listings, CATEGORY_GROUPS)).toEqual([
      { kind: 'category', id: 'group-clothing', label: 'Clothing' },
      { kind: 'category', id: 'group-footwear', label: 'Footwear' },
    ]);
  });

  it('appends a Sold highlight only when at least one listing is sold', () => {
    const noneSold = [{ categoryId: 'leaf-outerwear', status: 'active' as const }];
    expect(deriveClosetHighlights(noneSold, CATEGORY_GROUPS).some((h) => h.kind === 'sold')).toBe(false);

    const oneSold = [
      { categoryId: 'leaf-outerwear', status: 'active' as const },
      { categoryId: 'leaf-shoes', status: 'sold' as const },
    ];
    const result = deriveClosetHighlights(oneSold, CATEGORY_GROUPS);
    expect(result[result.length - 1]).toEqual({ kind: 'sold', id: 'sold', label: 'Sold' });
  });

  it('skips a listing whose category_id is null or unresolvable', () => {
    const listings = [
      { categoryId: null, status: 'active' as const },
      { categoryId: 'does-not-exist', status: 'active' as const },
    ];
    expect(deriveClosetHighlights(listings, CATEGORY_GROUPS)).toEqual([]);
  });

  it('returns an empty array for no listings', () => {
    expect(deriveClosetHighlights([], CATEGORY_GROUPS)).toEqual([]);
  });

  it('a top-level group id used directly as category_id still resolves', () => {
    const listings = [{ categoryId: 'group-footwear', status: 'active' as const }];
    expect(deriveClosetHighlights(listings, CATEGORY_GROUPS)).toEqual([
      { kind: 'category', id: 'group-footwear', label: 'Footwear' },
    ]);
  });
});

describe('filterClosetListings', () => {
  const listings = [
    { id: 'a', categoryId: 'leaf-outerwear', status: 'active' as const },
    { id: 'b', categoryId: 'leaf-shoes', status: 'sold' as const },
    { id: 'c', categoryId: 'leaf-denim', status: 'active' as const },
  ];

  it('returns everything when nothing is selected', () => {
    expect(filterClosetListings(listings, null, CATEGORY_GROUPS)).toEqual(listings);
  });

  it('filters by a category group, matching any leaf under it', () => {
    const result = filterClosetListings(listings, 'group-clothing', CATEGORY_GROUPS);
    expect(result.map((l) => l.id)).toEqual(['a', 'c']);
  });

  it("filters to sold-only for the 'sold' highlight", () => {
    const result = filterClosetListings(listings, 'sold', CATEGORY_GROUPS);
    expect(result.map((l) => l.id)).toEqual(['b']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterClosetListings(listings, 'group-accessories', CATEGORY_GROUPS)).toEqual([]);
  });
});

describe('selectCollagePhotos', () => {
  it('takes the first N in loaded order', () => {
    expect(selectCollagePhotos([1, 2, 3, 4], 3)).toEqual([1, 2, 3]);
  });

  it('returns fewer than N when there are fewer items', () => {
    expect(selectCollagePhotos([1], 3)).toEqual([1]);
  });

  it('returns an empty array for no items', () => {
    expect(selectCollagePhotos([], 3)).toEqual([]);
  });
});
