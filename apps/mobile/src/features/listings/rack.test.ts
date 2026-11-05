import { describe, expect, it } from 'vitest';

import {
  countRackEligible,
  getRackStatusKind,
  groupLowestPositionCoverByListingId,
  selectRackItems,
  type RackEligibleListing,
} from '@/features/listings/rack';

describe('getRackStatusKind', () => {
  it('maps draft to draft', () => {
    expect(getRackStatusKind('draft')).toBe('draft');
  });

  it('maps active and reserved to live', () => {
    expect(getRackStatusKind('active')).toBe('live');
    expect(getRackStatusKind('reserved')).toBe('live');
  });

  it('maps sold to sold', () => {
    expect(getRackStatusKind('sold')).toBe('sold');
  });

  it('excludes removed', () => {
    expect(getRackStatusKind('removed')).toBeNull();
  });
});

describe('selectRackItems', () => {
  const listings: RackEligibleListing[] = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'removed' },
    { id: 'c', status: 'draft' },
    { id: 'd', status: 'sold' },
    { id: 'e', status: 'reserved' },
  ];

  it('excludes removed listings and tags the rest with their pill state', () => {
    expect(selectRackItems(listings, 10)).toEqual([
      { id: 'a', status: 'active', statusKind: 'live' },
      { id: 'c', status: 'draft', statusKind: 'draft' },
      { id: 'd', status: 'sold', statusKind: 'sold' },
      { id: 'e', status: 'reserved', statusKind: 'live' },
    ]);
  });

  it('preserves input order rather than re-sorting', () => {
    const ids = selectRackItems(listings, 10).map((item) => item.id);
    expect(ids).toEqual(['a', 'c', 'd', 'e']);
  });

  it('truncates to limit, counting only eligible listings toward it', () => {
    const ids = selectRackItems(listings, 2).map((item) => item.id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('returns an empty array when every listing is removed', () => {
    expect(selectRackItems([{ id: 'x', status: 'removed' }], 10)).toEqual([]);
  });
});

describe('countRackEligible', () => {
  it('counts every non-removed listing, regardless of the strip limit', () => {
    const listings: RackEligibleListing[] = [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'removed' },
      { id: 'c', status: 'draft' },
      { id: 'd', status: 'sold' },
    ];
    expect(countRackEligible(listings)).toBe(3);
  });

  it('is 0 for an empty list', () => {
    expect(countRackEligible([])).toBe(0);
  });
});

describe('groupLowestPositionCoverByListingId', () => {
  it('picks the first row seen per listing id', () => {
    const result = groupLowestPositionCoverByListingId([
      { listing_id: 'a', storage_path: 'a/0.jpg', position: 0 },
      { listing_id: 'a', storage_path: 'a/1.jpg', position: 1 },
      { listing_id: 'b', storage_path: 'b/0.jpg', position: 0 },
    ]);
    expect(result).toEqual({ a: 'a/0.jpg', b: 'b/0.jpg' });
  });

  it('ignores a later row for the same listing id even out of position order', () => {
    // Defensive: groupLowestPositionCoverByListingId trusts the caller's
    // query to have ordered by position already (see fetchListingCovers), so
    // "first seen" is what determines the cover, not the position value
    // itself.
    const result = groupLowestPositionCoverByListingId([
      { listing_id: 'a', storage_path: 'first-seen.jpg', position: 2 },
      { listing_id: 'a', storage_path: 'second-seen.jpg', position: 0 },
    ]);
    expect(result).toEqual({ a: 'first-seen.jpg' });
  });

  it('returns an empty object for no rows', () => {
    expect(groupLowestPositionCoverByListingId([])).toEqual({});
  });
});
