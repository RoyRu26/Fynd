import { describe, expect, it } from 'vitest';

import { addRecentSearch, removeRecentSearch, RECENT_SEARCHES_MAX } from '@/features/search/recent-searches';

describe('addRecentSearch', () => {
  it('is a no-op for an empty query', () => {
    expect(addRecentSearch(['shoes'], '')).toEqual(['shoes']);
  });

  it('is a no-op for a whitespace-only query', () => {
    expect(addRecentSearch(['shoes'], '   ')).toEqual(['shoes']);
  });

  it('trims the query before storing it', () => {
    expect(addRecentSearch([], '  denim jacket  ')).toEqual(['denim jacket']);
  });

  it('adds a new entry to the front', () => {
    expect(addRecentSearch(['shoes'], 'jacket')).toEqual(['jacket', 'shoes']);
  });

  it('caps the list at RECENT_SEARCHES_MAX', () => {
    const full = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `query ${i}`);
    const result = addRecentSearch(full, 'new query');
    expect(result).toHaveLength(RECENT_SEARCHES_MAX);
    expect(result[0]).toBe('new query');
    expect(result).not.toContain(`query ${RECENT_SEARCHES_MAX - 1}`);
  });

  it('dedupes case-insensitively, re-promoting the existing entry with the newest casing', () => {
    const result = addRecentSearch(['Shoes', 'jacket'], 'SHOES');
    expect(result).toEqual(['SHOES', 'jacket']);
  });

  it('dedupes an exact-casing match too, moving it to the front', () => {
    const result = addRecentSearch(['jacket', 'shoes'], 'shoes');
    expect(result).toEqual(['shoes', 'jacket']);
  });
});

describe('removeRecentSearch', () => {
  it('removes an exact match', () => {
    expect(removeRecentSearch(['shoes', 'jacket'], 'shoes')).toEqual(['jacket']);
  });

  it('is a no-op when the query is not present', () => {
    expect(removeRecentSearch(['shoes', 'jacket'], 'boots')).toEqual(['shoes', 'jacket']);
  });

  it('is case-sensitive, unlike addRecentSearch\'s dedupe', () => {
    expect(removeRecentSearch(['Shoes'], 'shoes')).toEqual(['Shoes']);
  });
});
