import { describe, expect, it } from 'vitest';

import { setFavoriteInPages, type FeedPages } from '@/features/feed/favorites-cache';
import type { FeedListing } from '@/features/feed/pagination';

function listing(id: string, isFavorited = false): FeedListing {
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
  return {
    pages: pageContents,
    pageParams: pageContents.map((_, index) => index),
  };
}

describe('setFavoriteInPages', () => {
  // The optimistic favorite.
  it('flips the target listing to favorited', () => {
    const data = pages([listing('a'), listing('b')]);
    const next = setFavoriteInPages(data, 'a', true);

    expect(next.pages[0][0].isFavorited).toBe(true);
  });

  // The optimistic unfavorite.
  it('flips the target listing to unfavorited', () => {
    const data = pages([listing('a', true), listing('b', true)]);
    const next = setFavoriteInPages(data, 'a', false);

    expect(next.pages[0][0].isFavorited).toBe(false);
  });

  it('leaves every other listing untouched', () => {
    const data = pages([listing('a'), listing('b', true)]);
    const next = setFavoriteInPages(data, 'a', true);

    expect(next.pages[0][1]).toBe(data.pages[0][1]);
    expect(next.pages[0][1].isFavorited).toBe(true);
  });

  it('reaches a listing on a later page', () => {
    const data = pages([listing('a')], [listing('b')], [listing('c')]);
    const next = setFavoriteInPages(data, 'c', true);

    expect(next.pages[2][0].isFavorited).toBe(true);
    expect(next.pages[0]).toBe(data.pages[0]);
    expect(next.pages[1]).toBe(data.pages[1]);
  });

  /**
   * The duplicate case the keyset cursor makes unlikely but not impossible
   * (an `includeOwn` switch, a refetch that re-slices page boundaries, a
   * `created_at` tie with the cursor row). Flipping only the first match
   * would leave a second card showing a stale heart, which reads to the
   * user as the tap not having worked.
   */
  it('flips EVERY copy when the same listing appears in more than one page', () => {
    const data = pages([listing('a'), listing('b')], [listing('a'), listing('c')]);
    const next = setFavoriteInPages(data, 'a', true);

    expect(next.pages[0][0].isFavorited).toBe(true);
    expect(next.pages[1][0].isFavorited).toBe(true);
    expect(next.pages[0][1].isFavorited).toBe(false);
    expect(next.pages[1][1].isFavorited).toBe(false);
  });

  it('does not mutate the input', () => {
    const data = pages([listing('a')]);
    setFavoriteInPages(data, 'a', true);

    expect(data.pages[0][0].isFavorited).toBe(false);
  });

  it('preserves pageParams, so the infinite query keeps paginating', () => {
    const data = pages([listing('a')], [listing('b')]);
    const next = setFavoriteInPages(data, 'a', true);

    expect(next.pageParams).toEqual(data.pageParams);
  });

  // TanStack compares by reference to decide whether to notify, so a no-op
  // must not cost the whole feed a re-render.
  it('returns the identical object when the listing is absent', () => {
    const data = pages([listing('a')]);
    expect(setFavoriteInPages(data, 'missing', true)).toBe(data);
  });

  it('returns the identical object when the value is already correct', () => {
    const data = pages([listing('a', true)]);
    expect(setFavoriteInPages(data, 'a', true)).toBe(data);
  });

  it('handles an empty cache without error', () => {
    const data = pages();
    expect(setFavoriteInPages(data, 'a', true)).toBe(data);
  });

  /**
   * The rollback path. `onError` restores the pre-mutation snapshot rather
   * than re-toggling, so this asserts the snapshot is a genuinely
   * independent value — if the optimistic update had mutated in place, the
   * "previous" reference would already carry the new value and restoring it
   * would be a no-op.
   */
  it('leaves a captured snapshot valid for rollback after a failed mutation', () => {
    const data = pages([listing('a'), listing('b')]);
    const snapshot = data;

    const optimistic = setFavoriteInPages(data, 'a', true);
    expect(optimistic.pages[0][0].isFavorited).toBe(true);

    // What onError does: hand the snapshot straight back.
    expect(snapshot.pages[0][0].isFavorited).toBe(false);
  });
});
