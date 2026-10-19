import { describe, expect, it } from 'vitest';

import {
  FILTER_LABELS,
  filterListingsByStatus,
  getMyListingsEmptyCopy,
  MY_LISTINGS_FILTERS,
  STATUS_LABELS,
  type ListingStatus,
} from '@/features/listings/status';

type Fixture = { id: string; status: ListingStatus };

function listing(status: ListingStatus, id = status): Fixture {
  return { id, status };
}

describe('filterListingsByStatus', () => {
  const all: Fixture[] = [
    listing('draft'),
    listing('active'),
    listing('reserved'),
    listing('sold'),
    listing('removed'),
  ];

  it('matches each exact non-all filter value', () => {
    expect(filterListingsByStatus(all, 'draft')).toEqual([listing('draft')]);
    expect(filterListingsByStatus(all, 'active')).toEqual([listing('active')]);
    expect(filterListingsByStatus(all, 'reserved')).toEqual([listing('reserved')]);
    expect(filterListingsByStatus(all, 'sold')).toEqual([listing('sold')]);
  });

  it("'all' includes every non-removed status but excludes removed", () => {
    const result = filterListingsByStatus(all, 'all');
    expect(result).toEqual([listing('draft'), listing('active'), listing('reserved'), listing('sold')]);
    expect(result.some((item) => item.status === 'removed')).toBe(false);
  });

  it('returns an empty array for empty input, for every filter', () => {
    for (const filter of MY_LISTINGS_FILTERS) {
      expect(filterListingsByStatus([], filter)).toEqual([]);
    }
  });

  it('has a label for every filter value', () => {
    for (const filter of MY_LISTINGS_FILTERS) {
      expect(FILTER_LABELS[filter]).toBeTruthy();
    }
  });

  it('has a label for every listing status', () => {
    const statuses: ListingStatus[] = ['draft', 'active', 'reserved', 'sold', 'removed'];
    for (const status of statuses) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe('getMyListingsEmptyCopy', () => {
  it('returns the true-empty copy when the seller has no listings at all', () => {
    for (const filter of MY_LISTINGS_FILTERS) {
      expect(getMyListingsEmptyCopy(filter, 0)).toEqual({ title: "You haven't listed anything yet." });
    }
  });

  it('returns filter-specific copy when the seller has listings but none in this bucket', () => {
    expect(getMyListingsEmptyCopy('draft', 3)).toEqual({ title: 'No drafts right now.' });
    expect(getMyListingsEmptyCopy('active', 3)).toEqual({ title: 'Nothing active right now.' });
    expect(getMyListingsEmptyCopy('reserved', 3)).toEqual({ title: 'No reserved listings.' });
    expect(getMyListingsEmptyCopy('sold', 3)).toEqual({ title: 'No sold listings yet.' });
  });

  it('still returns sensible copy for the all filter when totalCount > 0', () => {
    const copy = getMyListingsEmptyCopy('all', 3);
    expect(copy.title.length).toBeGreaterThan(0);
  });
});
