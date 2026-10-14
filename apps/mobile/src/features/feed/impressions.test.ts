import { describe, expect, it, vi } from 'vitest';

import {
  createOpaqueToken,
  EMPTY_IMPRESSION_TRACKER,
  flattenFeedPages,
  getFeedSessionId,
  markImpressionConfirmed,
  markImpressionFailed,
  markImpressionsPending,
  selectNewlyViewableImpressions,
  type ImpressionTrackerState,
} from '@/features/feed/impressions';
import type { FeedListing } from '@/features/feed/pagination';

describe('createOpaqueToken', () => {
  it('produces a token within the session_id length the DB constraint allows (8-64 chars)', () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(8);
    expect(token.length).toBeLessThanOrEqual(64);
  });

  it('does not collide across many successive calls', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => createOpaqueToken()));
    expect(tokens.size).toBe(500);
  });
});

describe('getFeedSessionId', () => {
  it('returns the same token across repeated calls in one process — switching tabs must not create a new session', () => {
    const first = getFeedSessionId();
    const second = getFeedSessionId();
    expect(second).toBe(first);
  });

  it('returns a fresh token after a simulated relaunch (module reload)', async () => {
    const before = getFeedSessionId();

    vi.resetModules();
    const reloaded = await import('@/features/feed/impressions');
    const after = reloaded.getFeedSessionId();

    expect(after).not.toBe(before);
  });
});

function tracker(overrides: Partial<ImpressionTrackerState> = {}): ImpressionTrackerState {
  return { ...EMPTY_IMPRESSION_TRACKER, ...overrides };
}

describe('selectNewlyViewableImpressions', () => {
  it('selects listings that are neither confirmed nor pending', () => {
    expect(selectNewlyViewableImpressions(['a', 'b'], EMPTY_IMPRESSION_TRACKER)).toEqual([
      'a',
      'b',
    ]);
  });

  it('excludes a listing that was already confirmed this session — duplicate successful impressions are suppressed', () => {
    const state = tracker({ confirmed: new Set(['a']) });
    expect(selectNewlyViewableImpressions(['a', 'b'], state)).toEqual(['b']);
  });

  it('excludes a listing that is currently pending — concurrent duplicate sends are avoided', () => {
    const state = tracker({ pending: new Set(['a']) });
    expect(selectNewlyViewableImpressions(['a', 'b'], state)).toEqual(['b']);
  });

  it('returns an empty array when everything viewable is already confirmed or pending', () => {
    const state = tracker({ confirmed: new Set(['a']), pending: new Set(['b']) });
    expect(selectNewlyViewableImpressions(['a', 'b'], state)).toEqual([]);
  });
});

describe('markImpressionsPending', () => {
  it('adds the given ids to pending without touching confirmed', () => {
    const next = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a', 'b']);
    expect(next.pending.has('a')).toBe(true);
    expect(next.pending.has('b')).toBe(true);
    expect(next.confirmed.size).toBe(0);
  });

  it('does not mutate the input state', () => {
    const before = EMPTY_IMPRESSION_TRACKER;
    markImpressionsPending(before, ['a']);
    expect(before.pending.size).toBe(0);
  });

  it('closes the concurrent-duplicate window: once pending, the same id is no longer selected', () => {
    const afterFirstFire = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a']);
    // A second viewability-changed event for the same still-in-flight item
    // must not select it again.
    expect(selectNewlyViewableImpressions(['a'], afterFirstFire)).toEqual([]);
  });
});

describe('markImpressionConfirmed', () => {
  it('moves the id from pending to confirmed', () => {
    const pending = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a']);
    const confirmed = markImpressionConfirmed(pending, 'a');
    expect(confirmed.pending.has('a')).toBe(false);
    expect(confirmed.confirmed.has('a')).toBe(true);
  });

  it('a confirmed impression stays permanently excluded, even if offered again as viewable', () => {
    let state = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a']);
    state = markImpressionConfirmed(state, 'a');
    expect(selectNewlyViewableImpressions(['a'], state)).toEqual([]);
  });
});

describe('markImpressionFailed', () => {
  it('clears the pending mark without adding to confirmed', () => {
    const pending = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a']);
    const failed = markImpressionFailed(pending, 'a');
    expect(failed.pending.has('a')).toBe(false);
    expect(failed.confirmed.has('a')).toBe(false);
  });

  // The retry contract, end to end: a transient RPC failure must not
  // permanently suppress a listing the way a real success does.
  it('a failed impression becomes eligible again — it is retryable, not permanently suppressed', () => {
    let state = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a']);
    state = markImpressionFailed(state, 'a');
    expect(selectNewlyViewableImpressions(['a'], state)).toEqual(['a']);
  });

  it('does not affect other in-flight or confirmed listings', () => {
    let state = markImpressionsPending(EMPTY_IMPRESSION_TRACKER, ['a', 'b']);
    state = markImpressionConfirmed(state, 'b');
    state = markImpressionFailed(state, 'a');
    expect(state.confirmed.has('b')).toBe(true);
    expect(state.pending.has('b')).toBe(false);
  });
});

function listing(id: string, createdAt: string): FeedListing {
  return {
    listingId: id,
    title: `Listing ${id}`,
    priceAmount: 1000,
    currency: 'ILS',
    condition: 'good',
    size: 'alpha_m',
    createdAt,
    sellerId: 'seller-1',
    sellerUsername: 'roy',
    sellerDisplayName: 'Roy',
    sellerAvatarPath: null,
    sellerAvatarUrl: null,
    coverStoragePath: `seller-1/${id}/cover.jpg`,
    coverUrl: `https://signed/${id}`,
    isFavorited: false,
  };
}

describe('flattenFeedPages', () => {
  it('preserves order within and across pages', () => {
    const page1 = [listing('a', '2026-01-03T00:00:00Z'), listing('b', '2026-01-02T00:00:00Z')];
    const page2 = [listing('c', '2026-01-01T00:00:00Z')];

    expect(flattenFeedPages([page1, page2]).map((l) => l.listingId)).toEqual(['a', 'b', 'c']);
  });

  // The entire point of this helper: the array INDEX is the absolute feed
  // position record_listing_impression expects — item 0 of page 2 must NOT
  // read as position 0.
  it('the flattened array index is the absolute feed position across page boundaries', () => {
    const page1 = [listing('a', '3'), listing('b', '2'), listing('c', '1')];
    const page2 = [listing('d', '0')];

    const flat = flattenFeedPages([page1, page2]);

    expect(flat.indexOf(flat.find((l) => l.listingId === 'd')!)).toBe(3);
  });

  it('returns an empty array for zero pages', () => {
    expect(flattenFeedPages([])).toEqual([]);
  });
});
