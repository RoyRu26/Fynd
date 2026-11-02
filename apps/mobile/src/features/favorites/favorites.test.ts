import { describe, expect, it } from 'vitest';

import { previousFavoriteState } from '@/features/favorites/favorites';
import type { FeedPages } from '@/features/feed/favorites-cache';
import type { FeedListing } from '@/features/feed/pagination';

function listing(id: string, isFavorited: boolean): FeedListing {
  return {
    listingId: id,
    title: `Listing ${id}`,
    priceAmount: 5000,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    createdAt: '2026-01-01T00:00:00+00:00',
    sellerId: 'seller-1',
    sellerUsername: 'roy',
    sellerDisplayName: 'Roy',
    sellerAvatarPath: null,
    sellerAvatarUrl: null,
    coverStoragePath: `seller-1/${id}/cover.jpg`,
    coverUrl: `https://signed/${id}`,
    isFavorited,
  };
}

function pages(...pageContents: FeedListing[][]): FeedPages<number> {
  return { pages: pageContents, pageParams: pageContents.map((_, index) => index) };
}

describe('previousFavoriteState', () => {
  it('prefers the detail entry', () => {
    expect(previousFavoriteState('a', true, [pages([listing('a', false)])], false)).toBe(true);
  });

  it('falls back to this listing in the feed, not the first listing', () => {
    const feed = pages([listing('b', true)], [listing('a', false)]);
    expect(previousFavoriteState('a', undefined, [feed], true)).toBe(false);
  });

  it('skips feed caches that are not loaded', () => {
    expect(previousFavoriteState('a', undefined, [undefined, pages([listing('a', true)])], false)).toBe(true);
  });

  it('assumes the opposite of the target when nothing is cached', () => {
    expect(previousFavoriteState('a', undefined, [undefined], true)).toBe(false);
    expect(previousFavoriteState('a', undefined, [], false)).toBe(true);
  });
});
